import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { CLAUDE_HOOK_EVENTS, type ClaudeEvent, type ClaudeHookEvent } from '../shared/types'
import log from './log'

const MAX_BODY_BYTES = 64 * 1024
const HOOK_TIMEOUT_SECONDS = 5
const URL_PATTERN = /^\/hook\/([0-9a-f]{32})\/([A-Za-z0-9-]{1,64})\/([A-Za-z]+)$/

/**
 * 接收 claude hooks 上报的本地 HTTP 服务（只监听 127.0.0.1，随机端口 + 随机 token）。
 *
 * 通过「启动 Claude」按钮启动的 claude 会带上 `--settings <会话 hooks 文件>`，
 * 文件里每个事件的 hook 都是一条 curl.exe 命令，把 hook 的 stdin（事件 JSON）POST 到这里。
 * 端口、token、sessionId 直接写在命令里，不依赖环境变量展开，bash / cmd / PowerShell 下都成立。
 */
export class ClaudeHookServer {
  private server: http.Server | null = null
  private port = 0
  private readonly token = randomBytes(16).toString('hex')

  constructor(
    private readonly dir: string,
    private readonly onEvent: (sessionId: string, event: ClaudeEvent) => void
  ) {}

  async start(): Promise<void> {
    // 上次运行留下的文件里是旧端口 / 旧 token，已经无效
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => undefined)
    const server = http.createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    log.info(`[claude] hooks 服务已启动 127.0.0.1:${this.port}`)
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** 为会话生成 hooks 设置文件，返回文件路径 */
  async writeSessionSettings(sessionId: string): Promise<string> {
    if (!this.server) throw new Error('状态服务未启动')
    const hooks: Record<string, unknown> = {}
    for (const event of CLAUDE_HOOK_EVENTS) {
      hooks[event] = [
        { hooks: [{ type: 'command', command: this.command(sessionId, event), timeout: HOOK_TIMEOUT_SECONDS }] }
      ]
    }
    await fs.mkdir(this.dir, { recursive: true })
    const file = path.join(this.dir, `${sessionId}.json`)
    await fs.writeFile(file, JSON.stringify({ hooks }, null, 2), 'utf8')
    return file
  }

  private command(sessionId: string, event: ClaudeHookEvent): string {
    const url = `http://127.0.0.1:${this.port}/hook/${this.token}/${sessionId}/${event}`
    return `curl.exe -s -m 2 -X POST --data-binary "@-" ${url}`
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
      // 必须没有响应体：SessionStart / UserPromptSubmit 的 hook 输出会被加进 claude 的上下文
      res.writeHead(204)
      res.end()
      try {
        const m = URL_PATTERN.exec(req.url ?? '')
        if (req.method !== 'POST' || !m || !this.tokenMatches(m[1]) || !isHookEvent(m[3])) return
        const event: ClaudeEvent = { name: m[3] }
        if (event.name === 'Notification' && size <= MAX_BODY_BYTES) {
          event.notificationType = notificationTypeOf(Buffer.concat(chunks).toString('utf8'))
        }
        if (event.name === 'PostToolUse') log.debug(`[claude] ${event.name} session=${m[2]}`)
        else log.info(`[claude] ${event.name}${event.notificationType ? `(${event.notificationType})` : ''} session=${m[2]}`)
        this.onEvent(m[2], event)
      } catch (err) {
        log.warn('[claude] 处理 hook 请求失败', err)
      }
    })
  }

  private tokenMatches(token: string): boolean {
    const a = Buffer.from(token)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}

function isHookEvent(name: string): name is ClaudeHookEvent {
  return (CLAUDE_HOOK_EVENTS as readonly string[]).includes(name)
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
