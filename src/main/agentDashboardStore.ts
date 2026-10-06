import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentDashboard, AgentKind } from '../shared/types'
import { applyClaudeStatus, applyCodexLine, emptyDashboard, object, permissionMode, text } from './dashboardData'
import { JsonlTail } from './jsonlTail'

interface Entry {
  value: AgentDashboard
  transcript: string | null
  home: string
  tail: JsonlTail
  validated: boolean
  busy: boolean
  lastGit: number
  lastTitle: number
  sent: string
  metadataCwd: string | null
  metadataModel: string | null
  metadataAt: number
}

/** 只接受该实例启动的助手；元数据给出确切ID，不扫描“最新会话”猜测。 */
export class AgentDashboardStore {
  private entries = new Map<string, Entry>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly emit: (id: string, data: AgentDashboard | null) => void) {}

  start(): void {
    this.timer = setInterval(() => { void this.poll() }, 1000)
    this.timer.unref()
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.entries.clear()
  }
  begin(id: string, agent: AgentKind): void {
    this.entries.set(id, this.entry(agent))
    this.publish(id, this.entries.get(id)!)
  }
  clear(id: string): void {
    if (this.entries.delete(id)) this.emit(id, null)
  }
  clearAll(): void {
    for (const id of this.entries.keys()) this.clear(id)
  }
  get(id: string): AgentDashboard | null {
    const value = this.entries.get(id)?.value
    return value ? structuredClone(value) : null
  }
  private entry(agent: AgentKind): Entry {
    return { value: emptyDashboard(agent), transcript: null, home: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
      tail: new JsonlTail(), validated: false, busy: false, lastGit: 0, lastTitle: 0, sent: '',
      metadataCwd: null, metadataModel: null, metadataAt: 0 }
  }

  accept(id: string, agent: AgentKind, source: 'metadata' | 'statusline', raw: unknown): void {
    let e = this.entries.get(id)
    if (!e || e.value.agent !== agent) return
    const r = object(raw), sessionId = text(r.session_id)
    // 只有明确上报的会话ID才绑定；换会话时所有旧用量 / 文件游标 / 异步结果失效。
    if (sessionId && sessionId !== e.value.sessionId) {
      e = this.entry(agent)
      e.value.sessionId = sessionId
      this.entries.set(id, e)
    }
    const d = e.value
    const previousCwd = d.cwd
    e.metadataCwd = localPath(r.cwd) ?? e.metadataCwd
    e.metadataModel = text(r.model) ?? e.metadataModel
    e.metadataAt = Date.now()
    d.cwd = localPath(r.cwd) ?? d.cwd
    d.model = text(r.model) ?? d.model
    d.title = text(r.session_name) ?? text(r.session_title) ?? d.title
    const mode = permissionMode(r.permission_mode)
    if (mode) {
      d.permission = mode
      d.permissionDetail = text(r.permission_mode)
    }
    if (agent === 'codex') {
      const transcript = localPath(r.transcript_path)
      if (transcript && path.extname(transcript).toLowerCase() === '.jsonl' && transcript !== e.transcript) {
        e.transcript = transcript
        e.tail = new JsonlTail()
        e.validated = false
      }
      e.home = localPath(r.codex_home) ?? e.home
    }
    if (source === 'statusline' && agent === 'claude') applyClaudeStatus(d, r)
    if (previousCwd !== d.cwd) { d.git = null; e.lastGit = 0 }
    d.updatedAt = Date.now()
    this.publish(id, e)
    void this.refresh(id, e)
  }

  async poll(): Promise<void> {
    await Promise.all([...this.entries].map(([id, e]) => this.refresh(id, e)))
  }

  private async refresh(id: string, e: Entry): Promise<void> {
    if (e.busy || !e.value.sessionId) return
    e.busy = true
    try {
      const d = e.value
      if (d.agent === 'codex' && e.transcript) {
        try {
          if (!await this.readCodex(e)) { this.publish(id, e); return }
        } catch { /* 元数据先到、日志未创建时仍可显示目录 / Git / 名称。 */ }
      }
      if (!this.current(id, e)) return
      if (d.agent === 'codex' && Date.now() - e.lastTitle >= 4000) {
        e.lastTitle = Date.now()
        const title = await readTitle(e.home, d.sessionId!)
        if (title && this.current(id, e)) d.title = title
      }
      if (d.cwd && Date.now() - e.lastGit >= 5000) {
        e.lastGit = Date.now()
        const cwd = d.cwd
        const git = await readGit(cwd)
        if (this.current(id, e) && d.cwd === cwd) d.git = git
      }
      if (this.current(id, e)) this.publish(id, e)
    } catch { /* 日志可能尚未建立 / 被归档 / 临时忙，后续轮询重试；不影响终端。 */ }
    finally { e.busy = false }
  }
  private async readCodex(e: Entry): Promise<boolean> {
    const d = e.value
    const file = e.transcript
    if (!file) return true
    {
      const handle = await fs.open(file, 'r')
      try {
        const bytes = Buffer.alloc(64 * 1024)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        const head = bytes.subarray(0, bytesRead).toString('utf8').split('\n')[0]
        const meta = object(JSON.parse(head))
        if (meta.type !== 'session_meta' || object(meta.payload).id !== d.sessionId) {
          e.validated = false
          d.context = null
          d.limits = { primary: null, secondary: null }
          d.usageUpdatedAt = null
          return false
        }
        e.validated = true
      } finally { await handle.close() }
    }
    await e.tail.read(file, r => {
      const value = object(r)
      // 同一文件被替换成另一会话时，不消费任何后续字段。
      if (value.type === 'session_meta' && object(value.payload).id !== d.sessionId) {
        e.validated = false
        d.context = null
        d.limits = { primary: null, secondary: null }
        d.usageUpdatedAt = null
        return
      }
      if (e.validated) {
        const previousCwd = d.cwd
        applyCodexLine(d, r)
        const timestamp = typeof value.timestamp === 'string' ? Date.parse(value.timestamp) : NaN
        // 初次tail可能重放旧轮次；实时hook已报告的目录 / 模型不能被历史记录覆盖。
        const settings = value.type === 'turn_context' || value.type === 'event_msg' && object(value.payload).type === 'thread_settings_applied'
        if (settings && (!Number.isFinite(timestamp) || timestamp <= e.metadataAt)) {
          if (e.metadataCwd) d.cwd = e.metadataCwd
          if (e.metadataModel) d.model = e.metadataModel
        }
        if (settings && timestamp > e.metadataAt) {
          e.metadataCwd = d.cwd
          e.metadataModel = d.model
          e.metadataAt = timestamp
          d.updatedAt = Math.max(d.updatedAt ?? 0, timestamp)
        }
        if (d.cwd !== previousCwd) { d.git = null; e.lastGit = 0 }
      }
    })
    return e.validated
  }

  private current(id: string, e: Entry): boolean { return this.entries.get(id) === e }
  private publish(id: string, e: Entry): void {
    if (!this.current(id, e)) return
    const serialized = JSON.stringify(e.value)
    if (serialized !== e.sent) {
      e.sent = serialized
      this.emit(id, structuredClone(e.value))
    }
  }
}

function localPath(value: unknown): string | null {
  const p = text(value)
  return p && path.isAbsolute(p) && !p.startsWith('\\\\') && !p.startsWith('//') && !p.includes('\0') ? p : null
}

async function readTitle(home: string, sessionId: string): Promise<string | null> {
  try {
    const handle = await fs.open(path.join(home, 'session_index.jsonl'), 'r')
    try {
      const stat = await handle.stat(), offset = Math.max(0, stat.size - 1024 * 1024)
      const bytes = Buffer.alloc(Math.min(stat.size, 1024 * 1024))
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset)
      const lines = bytes.subarray(0, bytesRead).toString('utf8').split('\n')
      for (let i = lines.length - 1; i >= (offset ? 1 : 0); i--) {
        try {
          const r = object(JSON.parse(lines[i]))
          if (r.id === sessionId) return text(r.thread_name)
        } catch { /* 半行忽略 */ }
      }
    } finally { await handle.close() }
  } catch { /* 没有索引时使用只读数据库 */ }
  try {
    const files = (await fs.readdir(home)).filter(f => /^state_\d+\.sqlite$/.test(f))
      .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))
    if (!files.length) return null
    const db = new DatabaseSync(path.join(home, files[0]), { readOnly: true })
    try { return text(db.prepare('SELECT title FROM threads WHERE id = ?').get(sessionId)?.title) }
    finally { db.close() }
  } catch { return null }
}

function gitCommand(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile('git', ['-C', cwd, ...args],
    { windowsHide: true, timeout: 2000, maxBuffer: 8192, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    (err, stdout) => err ? reject(err) : resolve(stdout.trim())))
}
async function readGit(cwd: string): Promise<AgentDashboard['git']> {
  if (!localPath(cwd)) return null
  try {
    const root = await gitCommand(cwd, ['rev-parse', '--show-toplevel'])
    try { return { root, branch: await gitCommand(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']), detached: false } }
    catch { return { root, branch: await gitCommand(cwd, ['rev-parse', '--short', 'HEAD']), detached: true } }
  } catch { return null }
}
