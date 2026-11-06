import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentEvent } from '../shared/types'

/**
 * agy（Antigravity CLI）状态上报插件。
 *
 * agy 没有「只对本次会话加载 hooks」的参数（没有类似 claude `--settings` / codex `-c` 的选项），
 * 只能放在全局插件目录 `~/.gemini/config/plugins/<名称>/`，agy 启动时加载。依据 agy 1.4.2 自带文档
 * （`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`、plugins.md）：
 * - hook 命令在 Windows 上用 `cmd /c` 执行，工作目录是 hooks.json 所在目录（即插件目录）；
 * - stdin 为事件 JSON（camelCase），stdout 必须输出 JSON 对象；
 * - hooks **同步执行并阻塞 agent 循环**，所以只挂状态必需的事件：每次调用模型一次（PreInvocation），
 *   不再挂 `PostToolUse: *`（每个工具调用都要多起一个 cmd + curl）；
 * - 没有「等待用户」事件：用 matcher 只拦截向用户提问 / 申请权限的两个工具，表示「等待确认」。
 *
 * 插件对所有 agy 会话生效，但上报脚本只在设置了 AGENT_DESK_AGY_URL 时才发请求，
 * 这个变量只由「启动 AGY」按钮在 agy 运行期间设置，手动输入的 agy 不上报。
 */
export const AGY_PLUGIN_NAME = 'agentmanager'

/** 会让 agy 停下来等用户回答 / 批准的工具 */
export const AGY_WAITING_TOOLS = ['ask_question', 'ask_permission'] as const
const WAITING_MATCHER = AGY_WAITING_TOOLS.join('|')

/** 插件 hooks 上报的事件（URL 最后一段）；SessionEnd 由启动命令在 agy 退出后上报 */
export const AGY_REPORTED_EVENTS = ['SessionStart', 'PreInvocation', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'] as const
type AgyReportedEvent = (typeof AGY_REPORTED_EVENTS)[number]

const HOOK_TIMEOUT_SECONDS = 5
const SCRIPT_NAME = 'report.cmd'

/**
 * 上报脚本。放进文件而不是写在 hooks.json 的 command 里：command 经 Go 转义后交给 `cmd /c`，
 * 含双引号时解析不可靠；脚本里可以正常输出 PreToolUse 需要的 `{"decision":"allow"}`。
 * 只用 ASCII（cmd 按当前代码页读 .cmd，中文注释会被拆坏），换行用 CRLF。
 * - `--data-binary @-` 把 agy 写来的事件 JSON 原样转发；
 * - PreToolUse 必须给出 decision，`allow` 表示交给后续 hook / 默认权限策略处理（不改变原有行为）；
 * - 其他事件输出 `{}`（不注入、不阻止停止）。
 */
const REPORT_SCRIPT = [
  '@echo off',
  'rem AgentManager status hook for agy. Reports only when AGENT_DESK_AGY_URL is set',
  'rem (agy launched from the AgentManager button); otherwise it just answers agy.',
  'if defined AGENT_DESK_AGY_URL curl.exe -s -m 2 -X POST --data-binary @- "%AGENT_DESK_AGY_URL%/%~1" >nul 2>&1',
  'if /i "%~1"=="PreToolUse" (echo {"decision":"allow"}) else (echo {})',
  ''
].join('\r\n')

const handler = (event: AgyReportedEvent): Record<string, unknown> => ({
  type: 'command',
  // 相对路径：工作目录就是插件目录；用户目录含空格也不需要引号
  command: `.\\${SCRIPT_NAME} ${event}`,
  timeout: HOOK_TIMEOUT_SECONDS
})

const HOOKS_JSON = JSON.stringify(
  {
    [AGY_PLUGIN_NAME]: {
      SessionStart: [handler('SessionStart')],
      PreInvocation: [handler('PreInvocation')],
      PreToolUse: [{ matcher: WAITING_MATCHER, hooks: [handler('PreToolUse')] }],
      PostToolUse: [{ matcher: WAITING_MATCHER, hooks: [handler('PostToolUse')] }],
      Stop: [handler('Stop')]
    }
  },
  null,
  2
)

const MANIFEST = JSON.stringify(
  {
    name: AGY_PLUGIN_NAME,
    description: 'AgentManager 工作状态上报（仅对通过 AgentManager「启动 AGY」按钮启动的会话生效）'
  },
  null,
  2
)

/** 插件目录下的文件（文件名 → 内容） */
export const AGY_PLUGIN_FILES: Readonly<Record<string, string>> = {
  'plugin.json': MANIFEST,
  'hooks.json': HOOKS_JSON,
  [SCRIPT_NAME]: REPORT_SCRIPT
}

/** 写入插件；内容没变的文件不重写（agy 会监听配置文件变化） */
export async function writeAgyPlugin(pluginDir: string): Promise<void> {
  await fs.mkdir(pluginDir, { recursive: true })
  await Promise.all(
    Object.entries(AGY_PLUGIN_FILES).map(async ([name, content]) => {
      const file = path.join(pluginDir, name)
      const existing = await fs.readFile(file, 'utf8').catch(() => null)
      if (existing !== content) await fs.writeFile(file, content, 'utf8')
    })
  )
}

/** 把插件上报的请求（URL 中的事件名 + 请求体）换算成统一的助手事件；无关请求返回 null */
export function agyEvent(name: string, body: string): AgentEvent | null {
  if (!(AGY_REPORTED_EVENTS as readonly string[]).includes(name)) return null
  const payload = parseObject(body)
  switch (name as AgyReportedEvent) {
    case 'PreToolUse':
    case 'PostToolUse': {
      // matcher 已经只放行这两个工具；这里再核对一次，matcher 语义变化时不会误报「等待确认」
      const tool = toolNameOf(payload)
      if (!tool || !(AGY_WAITING_TOOLS as readonly string[]).includes(tool)) return null
      return { agent: 'agy', name: name === 'PreToolUse' ? 'PermissionRequest' : 'PostToolUse' }
    }
    case 'Stop':
      // 用户按 Esc 取消本轮：terminationReason 为 USER_CANCELED，回到就绪而不是「已完成」
      return { agent: 'agy', name: payload?.terminationReason === 'USER_CANCELED' ? 'Interrupt' : 'Stop' }
    default:
      return { agent: 'agy', name: name as AgyReportedEvent }
  }
}

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function toolNameOf(payload: Record<string, unknown> | null): string | undefined {
  const call = payload?.toolCall
  if (typeof call !== 'object' || call === null) return undefined
  const name = (call as Record<string, unknown>).name
  return typeof name === 'string' ? name : undefined
}
