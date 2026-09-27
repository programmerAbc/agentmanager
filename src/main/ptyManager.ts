import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as pty from 'node-pty'
import type { OpResult } from '../shared/types'
import log from './log'

export interface PtyOpenOptions {
  cwd: string
  cols: number
  rows: number
}

interface Session {
  id: string
  proc: pty.IPty
  pid: number
  /** 攒一小段时间的输出再发给渲染进程，减少 IPC 消息数 */
  pending: string
  flushTimer: NodeJS.Timeout | null
  disposables: pty.IDisposable[]
}

type DataListener = (sessionId: string, data: string) => void
type ExitListener = (sessionId: string, exitCode: number) => void

const FLUSH_INTERVAL_MS = 4
const TASKKILL_TIMEOUT_MS = 5000
const DEV_INJECTED_ENV = new Set([
  'ELECTRON_RENDERER_URL',
  'ELECTRON_CLI_ARGS',
  'ELECTRON_EXEC_PATH',
  'ELECTRON_MAJOR_VER',
  'NODE_ENV_ELECTRON_VITE',
  'REMOTE_DEBUGGING_PORT'
])

/**
 * 管理所有 PTY 会话，以 sessionId 为键（目前 sessionId === projectId，以后可一对多）。
 *
 * 被 kill 的会话会先从表中摘除并解绑监听，所以不会再向渲染进程推送 data/exit，
 * 渲染进程可以放心地在 kill 之后用同一个 sessionId 立即重新 open。
 */
export class PtyManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly onData: DataListener,
    private readonly onExit: ExitListener
  ) {}

  get size(): number {
    return this.sessions.size
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  open(sessionId: string, { cwd, cols, rows }: PtyOpenOptions): OpResult {
    if (this.sessions.has(sessionId)) return { ok: true }

    const dirError = checkDirectory(cwd)
    if (dirError) return { ok: false, error: dirError }

    const shell = resolveShell()
    try {
      const proc = pty.spawn(shell, ['-NoLogo'], {
        name: 'xterm-256color',
        cols: sanitizeDim(cols, 80),
        rows: sanitizeDim(rows, 24),
        cwd,
        env: buildEnv()
      })
      const session: Session = {
        id: sessionId,
        proc,
        pid: proc.pid,
        pending: '',
        flushTimer: null,
        disposables: []
      }
      session.disposables.push(
        proc.onData((data) => this.handleData(session, data)),
        proc.onExit(({ exitCode }) => this.handleExit(session, exitCode))
      )
      this.sessions.set(sessionId, session)
      log.info(`[pty] 创建 session=${sessionId} pid=${proc.pid} shell=${shell} cwd=${cwd} size=${cols}x${rows}`)
      return { ok: true }
    } catch (err) {
      log.error(`[pty] 创建失败 session=${sessionId} shell=${shell} cwd=${cwd}`, err)
      return { ok: false, error: `启动终端失败：${errorMessage(err)}` }
    }
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try {
      session.proc.write(data)
    } catch (err) {
      log.error(`[pty] 写入失败 session=${sessionId}`, err)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try {
      session.proc.resize(sanitizeDim(cols, session.proc.cols), sanitizeDim(rows, session.proc.rows))
    } catch (err) {
      log.warn(`[pty] resize 失败 session=${sessionId}`, err)
    }
  }

  /** 结束会话及其整棵进程树。 */
  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.detach(session)
    log.info(`[pty] kill session=${sessionId} pid=${session.pid}`)
    // 先 taskkill 整棵树：如果先 pty.kill()，shell 死掉后子进程（claude/node）会变成孤儿，/T 就找不到它们了
    await killProcessTree(session.pid)
    killPty(session)
  }

  /** 退出时清理所有会话，最多等待 timeoutMs。 */
  async killAll(timeoutMs: number): Promise<void> {
    const sessions = [...this.sessions.values()]
    if (sessions.length === 0) return
    log.info(`[pty] 清理全部会话 count=${sessions.length}`)
    sessions.forEach((s) => this.detach(s))
    const trees = Promise.all(sessions.map((s) => killProcessTree(s.pid)))
    await Promise.race([trees, delay(timeoutMs)])
    sessions.forEach(killPty)
  }

  private handleData(session: Session, data: string): void {
    if (this.sessions.get(session.id) !== session) return
    session.pending += data
    if (session.flushTimer === null) {
      session.flushTimer = setTimeout(() => this.flush(session), FLUSH_INTERVAL_MS)
    }
  }

  private flush(session: Session): void {
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    if (!session.pending) return
    const data = session.pending
    session.pending = ''
    this.onData(session.id, data)
  }

  private handleExit(session: Session, exitCode: number): void {
    if (this.sessions.get(session.id) !== session) return
    // 先把剩余输出发出去，保证"进程已退出"提示出现在最后
    this.flush(session)
    this.detach(session)
    log.info(`[pty] 退出 session=${session.id} pid=${session.pid} code=${exitCode}`)
    this.onExit(session.id, exitCode)
  }

  private detach(session: Session): void {
    if (this.sessions.get(session.id) === session) this.sessions.delete(session.id)
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    session.pending = ''
    for (const d of session.disposables) {
      try {
        d.dispose()
      } catch {
        // 忽略
      }
    }
    session.disposables = []
  }
}

function killPty(session: Session): void {
  try {
    session.proc.kill()
  } catch (err) {
    // 进程已经退出时 kill 可能抛错，忽略
    log.debug(`[pty] pty.kill 忽略错误 session=${session.id}`, err)
  }
}

/** taskkill /PID <pid> /T /F，忽略报错（进程可能已经退出） */
function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
      (err) => {
        if (err) log.debug(`[pty] taskkill pid=${pid} 返回错误（通常是进程已退出）: ${err.message.split('\n')[0]}`)
        else log.info(`[pty] taskkill 已结束进程树 pid=${pid}`)
        resolve()
      }
    )
  })
}

/** 默认 shell：PATH 中有 pwsh.exe 就用它，否则用 powershell.exe */
function resolveShell(): string {
  return findInPath('pwsh.exe') ?? 'powershell.exe'
}

function findInPath(exe: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter)
  for (const raw of dirs) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const candidate = path.join(dir, exe)
    // 应用执行别名（WindowsApps 下的 pwsh.exe）对 stat/existsSync 会报 EACCES，只能用 lstat 判断存在
    try {
      fs.lstatSync(candidate)
      return candidate
    } catch {
      // 不存在，继续找
    }
  }
  return null
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  if (!app.isPackaged) {
    // 开发模式下由 npm / electron-vite 注入的变量不应泄漏到用户终端（否则在终端里跑 npm、构建工具会被干扰）
    const injectedByElectronVite = env.NODE_ENV_ELECTRON_VITE !== undefined
    for (const key of Object.keys(env)) {
      if (key.startsWith('npm_') || DEV_INJECTED_ENV.has(key.toUpperCase())) delete env[key]
    }
    if (injectedByElectronVite) delete env.NODE_ENV
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

function checkDirectory(dir: string): string | null {
  try {
    if (!fs.statSync(dir).isDirectory()) return `不是目录：${dir}`
    return null
  } catch {
    return `目录不存在：${dir}`
  }
}

function sanitizeDim(n: number, fallback: number): number {
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : fallback
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
