// 主进程、preload、渲染进程共享的类型与常量。
// 这里只能放纯类型和纯数据常量，不能引入 electron / node 模块（渲染进程也会编译它）。

export interface Project {
  id: string // crypto.randomUUID()
  name: string // 默认取目录名，可以重命名
  path: string // 绝对路径
  createdAt: number
  lastOpenedAt?: number
}

/** 操作结果。主进程不抛异常给渲染进程，错误通过返回值传递。 */
export type OpResult = { ok: true } | { ok: false; error: string }
export type DataResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface AppSettings {
  sidebarWidth: number
  fontSize: number
  /** 终端首选字体族；渲染进程会在后面接上回退字体 */
  fontFamily: string
  lineHeight: number
  /** 终端光标样式 */
  cursorStyle: CursorStyle
  /** MD3 动态配色的种子色，#RRGGBB */
  themeSeed: string
  /** 「启动 Claude」按钮执行的命令 */
  claudeCommand: string
  /** 「启动 Codex」按钮执行的命令 */
  codexCommand: string
  lastProjectId: string | null
  window: WindowState | null
}

export interface SettingsFile extends AppSettings {
  version: 1
}

/** 渲染进程允许修改的设置项；窗口状态由主进程自己维护。 */
export type SettingsPatch = Partial<Omit<AppSettings, 'window'>>

export const SIDEBAR_WIDTH = { default: 240, min: 180, max: 400 } as const
export const FONT_SIZE = { default: 14, min: 8, max: 32 } as const
export const LINE_HEIGHT = { default: 1.0, min: 1.0, max: 1.6 } as const
export const DEFAULT_FONT_FAMILY = 'Maple Mono NF CN'
/** 竖线（默认）/ 下划线 / 方块 */
export type CursorStyle = 'bar' | 'underline' | 'block'
export const CURSOR_STYLES: readonly CursorStyle[] = ['bar', 'underline', 'block']
export const DEFAULT_CURSOR_STYLE: CursorStyle = 'bar'
export const DEFAULT_THEME_SEED = '#D97757'
/** 这两个种子色表示白色（浅色界面）/ 黑色（纯黑界面）主题；其余种子色为动态配色的深色界面 */
export const THEME_SEED_WHITE = '#FFFFFF'
export const THEME_SEED_BLACK = '#000000'

export type ThemeMode = 'light' | 'black' | 'dark'

export function themeModeOf(seed: string): ThemeMode {
  const s = seed.toUpperCase()
  if (s === THEME_SEED_WHITE) return 'light'
  if (s === THEME_SEED_BLACK) return 'black'
  return 'dark'
}

/** 窗口底色：页面画出来之前、以及拖大窗口时露出的颜色，与主题一致避免闪烁 */
export const WINDOW_BACKGROUND: Record<ThemeMode, string> = { light: '#FFFFFF', black: '#000000', dark: '#181818' }
export const DEFAULT_CLAUDE_COMMAND = 'claude --permission-mode bypassPermissions'
export const DEFAULT_CODEX_COMMAND = 'codex --dangerously-bypass-approvals-and-sandbox'
/** 字体族名只允许常见字符，避免拼进 CSS font-family 时出问题 */
export const FONT_FAMILY_PATTERN = /^[^"'\\;{}<>\r\n]{1,100}$/
export const THEME_SEED_PATTERN = /^#[0-9a-fA-F]{6}$/

export interface AppInfo {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  v8: string
  os: string
  userDataDir: string
  logsDir: string
}

/** IPC 通道名，全部集中在这里。 */
export const IPC = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRename: 'projects:rename',
  projectsRemove: 'projects:remove',
  projectsTouch: 'projects:touch',
  projectsOpenInExplorer: 'projects:open-in-explorer',
  ptyOpen: 'pty:open',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  clipboardReadText: 'clipboard:read-text',
  clipboardWriteText: 'clipboard:write-text',
  shellOpenExternal: 'shell:open-external',
  appInfo: 'app:info',
  appOpenDir: 'app:open-dir',
  agentLaunch: 'agent:launch',
  agentEvent: 'agent:event'
} as const

/** 可以从按钮启动、并跟踪工作状态的 AI 助手 */
export type AgentKind = 'claude' | 'codex'

export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }

/** 各助手的 hooks 会上报的事件（codex 没有 SessionEnd，由启动命令的 finally 上报） */
export type AgentHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'Notification'
  | 'Stop'
  | 'SessionEnd'

export const CLAUDE_HOOK_EVENTS: readonly AgentHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd'
]

/** 注入 codex 的 hooks（顺序与内容一旦改变，用户需要在 codex 里重新信任） */
export const CODEX_HOOK_EVENTS: readonly AgentHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
]

export interface AgentEvent {
  agent: AgentKind
  name: AgentHookEvent
  /** 仅 claude 的 Notification：permission_prompt / idle_prompt / elicitation_dialog / auth_success … */
  notificationType?: string
}

/**
 * preload 通过 contextBridge 暴露的 window.api。
 *
 * pty.* 的 id 是 sessionId。目前一个项目只有一个会话，sessionId === projectId；
 * 以后一个项目支持多个会话时，只需要改 ipc 层的 sessionId → 项目 映射。
 */
export interface Api {
  system: {
    /** Windows 内部版本号（例如 26200），用于 xterm 的 windowsPty 配置 */
    windowsBuild: number
  }
  projects: {
    list(): Promise<Project[]>
    /** 用户取消时 data 为 null；同一路径已存在时返回已有项目 */
    add(): Promise<DataResult<Project | null>>
    rename(id: string, name: string): Promise<OpResult>
    remove(id: string): Promise<OpResult>
    touch(id: string): Promise<OpResult>
    openInExplorer(id: string): Promise<OpResult>
  }
  pty: {
    open(id: string, cols: number, rows: number): Promise<OpResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<OpResult>
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: SettingsPatch): Promise<OpResult>
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  shell: {
    openExternal(url: string): Promise<OpResult>
  }
  app: {
    info(): Promise<AppInfo>
    openDir(kind: 'userData' | 'logs'): Promise<OpResult>
  }
  agents: {
    /** 在该会话的终端里执行设置中的助手启动命令（并注入 AgentManager 的 hooks 以跟踪状态） */
    launch(sessionId: string, agent: AgentKind): Promise<OpResult>
    onEvent(cb: (sessionId: string, event: AgentEvent) => void): () => void
  }
}
