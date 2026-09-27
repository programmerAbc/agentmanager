import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import {
  CLAUDE_HOOK_EVENTS,
  CODEX_HOOK_EVENTS,
  type AgentEvent,
  type AgentHookEvent
} from '../shared/types'
import log from './log'
import type { ShellFamily } from './shells'

const MAX_BODY_BYTES = 64 * 1024
const HOOK_TIMEOUT_SECONDS = 5
/** /hook/<token>/<sessionId>/<Event>（claude）或 /hook/<token>/<sessionId>/codex（codex，事件名在请求体里） */
const URL_PATTERN = /^\/hook\/([0-9a-f]{32})\/([A-Za-z0-9-]{1,64})\/([A-Za-z]+)$/

/**
 * codex 的 hook 命令。codex 在 Windows 上用 PowerShell 执行 hook（实测）。
 * 文本必须固定：codex 对新增 / 变化的 hook 会要求用户重新信任，所以端口、token、会话 id
 * 都通过终端环境变量 AGENT_DESK_HOOK_URL 传入；不含引号；先读完 stdin 再上报。
 */
const codexHookCommand = (event: AgentHookEvent): string =>
  `$null = @($input); curl.exe -s -m 2 -d ${event} $env:AGENT_DESK_HOOK_URL`

/** 通过 `codex -c $env:AGENT_DESK_CODEX_HOOKS` 注入的配置（TOML，字符串用单引号字面量） */
const CODEX_HOOKS_TOML = `hooks={${CODEX_HOOK_EVENTS.map(
  (event) => `${event}=[{hooks=[{type='command',command='${codexHookCommand(event)}'}]}]`
).join(',')}}`

/**
 * 接收 claude / codex hooks 上报的本地 HTTP 服务（只监听 127.0.0.1，随机端口 + 随机 token）。
 *
 * - claude：「启动 Claude」时生成会话 hooks 文件并追加 `--settings <文件>`，hook 为 curl.exe 命令，
 *   把 stdin（事件 JSON）POST 到 /hook/<token>/<sessionId>/<Event>。
 * - codex：终端启动时注入环境变量 AGENT_DESK_HOOK_URL / AGENT_DESK_CODEX_HOOKS，
 *   「启动 Codex」时追加 `-c $env:AGENT_DESK_CODEX_HOOKS`，并用 try/finally 在 codex 退出时上报 SessionEnd。
 * 响应一律为 204 无正文：hook 的标准输出会进入助手的上下文（claude），或被当作 hook 结果解析（codex）。
 */
export class AgentHookServer {
  private server: http.Server | null = null
  private port = 0
  private readonly token = randomBytes(16).toString('hex')

  constructor(
    private readonly dir: string,
    private readonly onEvent: (sessionId: string, event: AgentEvent) => void
  ) {}

  async start(): Promise<void> {
    // 上次运行留下的 claude hooks 文件里是旧端口 / 旧 token，已经无效
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => undefined)
    const server = http.createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    log.info(`[agents] hooks 服务已启动 127.0.0.1:${this.port}`)
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  get ready(): boolean {
    return this.server !== null
  }

  /** 终端启动时注入的环境变量（服务未启动时为空，不影响终端） */
  envFor(sessionId: string): Record<string, string> {
    if (!this.server) return {}
    return {
      AGENT_DESK_HOOK_URL: `http://127.0.0.1:${this.port}/hook/${this.token}/${sessionId}/codex`,
      AGENT_DESK_CODEX_HOOKS: CODEX_HOOKS_TOML
    }
  }

  /** claude：为会话生成 hooks 设置文件，返回文件路径 */
  async writeClaudeSettings(sessionId: string): Promise<string> {
    if (!this.server) throw new Error('状态服务未启动')
    const hooks: Record<string, unknown> = {}
    for (const event of CLAUDE_HOOK_EVENTS) {
      const url = `http://127.0.0.1:${this.port}/hook/${this.token}/${sessionId}/${event}`
      hooks[event] = [
        {
          hooks: [
            {
              type: 'command',
              command: `curl.exe -s -m 2 -X POST --data-binary "@-" ${url}`,
              timeout: HOOK_TIMEOUT_SECONDS
            }
          ]
        }
      ]
    }
    await fs.mkdir(this.dir, { recursive: true })
    const file = path.join(this.dir, `${sessionId}.json`)
    await fs.writeFile(file, JSON.stringify({ hooks }, null, 2), 'utf8')
    return file
  }

  /**
   * codex：在用户命令后追加 hooks，codex 退出（包括 Ctrl+C）后上报 SessionEnd（codex 自身没有这个事件）。
   * 按终端的 shell 写法不同，hooks 配置都从环境变量 AGENT_DESK_CODEX_HOOKS 取（其中没有双引号，可安全放进双引号）：
   * - PowerShell：try/finally
   * - cmd：`&` 串联（codex 以原始模式读 Ctrl+C，不会中断 cmd 的这一行）
   * - bash：`;` 串联
   */
  codexLaunchLine(command: string, family: ShellFamily): string {
    if (family === 'cmd') {
      return `${command} -c "%AGENT_DESK_CODEX_HOOKS%" & curl.exe -s -m 2 -d SessionEnd %AGENT_DESK_HOOK_URL% >nul`
    }
    if (family === 'bash') {
      return `${command} -c "$AGENT_DESK_CODEX_HOOKS"; curl.exe -s -m 2 -d SessionEnd "$AGENT_DESK_HOOK_URL" >/dev/null`
    }
    return (
      `try { ${command} -c $env:AGENT_DESK_CODEX_HOOKS } ` +
      'finally { curl.exe -s -m 2 -d SessionEnd $env:AGENT_DESK_HOOK_URL | Out-Null }'
    )
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('error', () => undefined)
    req.on('end', () => {
      res.writeHead(204)
      res.end()
      try {
        const m = URL_PATTERN.exec(req.url ?? '')
        if (req.method !== 'POST' || !m || !this.tokenMatches(m[1])) return
        const sessionId = m[2]
        const body = size <= MAX_BODY_BYTES ? Buffer.concat(chunks).toString('utf8') : ''
        const event = m[3] === 'codex' ? codexEvent(body) : claudeEvent(m[3], body)
        if (!event) return
        const detail = event.notificationType ? `(${event.notificationType})` : ''
        const text = `[agents] ${event.agent} ${event.name}${detail} session=${sessionId}`
        if (event.name === 'PostToolUse') log.debug(text)
        else log.info(text)
        this.onEvent(sessionId, event)
      } catch (err) {
        log.warn('[agents] 处理 hook 请求失败', err)
      }
    })
  }

  private tokenMatches(token: string): boolean {
    const a = Buffer.from(token)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}

function claudeEvent(name: string, body: string): AgentEvent | null {
  if (!(CLAUDE_HOOK_EVENTS as readonly string[]).includes(name)) return null
  const event: AgentEvent = { agent: 'claude', name: name as AgentHookEvent }
  if (event.name === 'Notification') event.notificationType = notificationTypeOf(body)
  return event
}

function codexEvent(body: string): AgentEvent | null {
  const name = body.trim()
  const known: readonly string[] = [...CODEX_HOOK_EVENTS, 'SessionEnd']
  return known.includes(name) ? { agent: 'codex', name: name as AgentHookEvent } : null
}

function notificationTypeOf(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      const type = (parsed as Record<string, unknown>).notification_type
      if (typeof type === 'string') return type
    }
  } catch {
    // 忽略无法解析的请求体
  }
  return undefined
}
