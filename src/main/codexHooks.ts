import { CODEX_HOOK_EVENTS, type AgentHookEvent } from '../shared/types'

/**
 * codex 的 hook 命令，上报 marker（事件名，压缩事件为「事件:触发方式」）。codex 在 Windows 上用 PowerShell 执行 hook（实测）。
 * 文本必须固定：codex 对新增 / 变化的 hook 会要求用户重新信任，所以端口、token、会话 id
 * 都通过终端环境变量 AGENT_DESK_HOOK_URL 传入；不含引号和空格；先读完 stdin 再上报（不转发 stdin：
 * PostToolUse 的 tool_response 可能很大，且 Windows PowerShell 管道给原生程序会破坏非 ASCII 字符）。
 */
const codexHookCommand = (marker: string): string =>
  `$null = @($input); curl.exe -s -m 2 -d ${marker} $env:AGENT_DESK_HOOK_URL`

/** 这两个事件同步执行，codex 默认只等 1 秒（上限 3 秒），PowerShell 冷启动 + curl 可能不够 */
const SYNC_CODEX_EVENTS: readonly AgentHookEvent[] = ['SessionEnd', 'Interrupt']
/** 压缩事件按触发方式分组（matcher）上报：手动 /compact 结束后没有 Stop，要据此回到就绪 */
const COMPACT_CODEX_EVENTS: readonly AgentHookEvent[] = ['PreCompact', 'PostCompact']
const COMPACT_TRIGGERS = ['manual', 'auto'] as const

/** 不改变原有handler；新增两条元数据handler。无引号，三种shell的环境变量展开都安全。 */
export const CODEX_METADATA_COMMAND = '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); $d = $input | Out-String | ConvertFrom-Json; '
  + '$d | Add-Member -NotePropertyName codex_home -NotePropertyValue $env:CODEX_HOME -Force; '
  + '$b = $d | Select-Object session_id,transcript_path,cwd,model,permission_mode,codex_home | ConvertTo-Json -Compress; '
  + '$null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Method Post -Uri $env:AGENT_DESK_HOOK_URL -Body ([Text.Encoding]::UTF8.GetBytes($b))'

const metadataHook = `{type='command',command='${CODEX_METADATA_COMMAND}'}`

const codexHook = (event: AgentHookEvent, marker: string): string =>
  `{type='command',command='${codexHookCommand(marker)}'${SYNC_CODEX_EVENTS.includes(event) ? ',timeout=3' : ''}}`

/** 一个事件的分组；原有handler文本与下标不变，新handler只追加 */
const codexHookGroups = (event: AgentHookEvent): string =>
  COMPACT_CODEX_EVENTS.includes(event)
    ? COMPACT_TRIGGERS.map((t) => `{matcher='${t}',hooks=[${codexHook(event, `${event}:${t}`)}]}`).join(',')
    : `{hooks=[${codexHook(event, event)}${event === 'SessionStart' || event === 'UserPromptSubmit' ? `,${metadataHook}` : ''}]}`

/** 通过 `codex -c $env:AGENT_DESK_CODEX_HOOKS` 注入的配置（TOML，字符串用单引号字面量） */
export const CODEX_HOOKS_TOML = `hooks={${CODEX_HOOK_EVENTS.map((event) => `${event}=[${codexHookGroups(event)}]`).join(',')}}`
