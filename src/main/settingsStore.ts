import {
  CURSOR_STYLES,
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CODEX_COMMAND,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_SHELL,
  DEFAULT_THEME_SEED,
  SHELL_IDS,
  SIDEBAR_GROUPS,
  FONT_FAMILY_PATTERN,
  FONT_SIZE,
  LINE_HEIGHT,
  SIDEBAR_WIDTH,
  THEME_SEED_PATTERN,
  type AppSettings,
  type CursorStyle,
  type SettingsFile,
  type SettingsPatch,
  type ShellId,
  type SidebarGroup,
  type WindowState
} from '../shared/types'
import { JsonFileWriter, readJsonFile } from './jsonFile'
import log from './log'

const DEFAULTS: AppSettings = {
  sidebarWidth: SIDEBAR_WIDTH.default,
  fontSize: FONT_SIZE.default,
  fontFamily: DEFAULT_FONT_FAMILY,
  lineHeight: LINE_HEIGHT.default,
  cursorStyle: DEFAULT_CURSOR_STYLE,
  shell: DEFAULT_SHELL,
  themeSeed: DEFAULT_THEME_SEED,
  claudeCommand: DEFAULT_CLAUDE_COMMAND,
  codexCommand: DEFAULT_CODEX_COMMAND,
  collapsedGroups: [],
  lastProjectId: null,
  window: null
}

/** settings.json：界面与终端偏好、最后选中的项目、窗口状态。先写临时文件再 rename，保证原子写入。 */
export class SettingsStore {
  private settings: AppSettings = { ...DEFAULTS }
  private readonly writer: JsonFileWriter

  constructor(private readonly file: string) {
    this.writer = new JsonFileWriter(file)
  }

  async load(): Promise<void> {
    const result = await readJsonFile(this.file, parseSettingsFile)
    this.settings = result.kind === 'ok' ? result.value : { ...DEFAULTS }
  }

  get(): AppSettings {
    return {
      ...this.settings,
      collapsedGroups: [...this.settings.collapsedGroups],
      window: this.settings.window ? { ...this.settings.window } : null
    }
  }

  /** 非法值抛错（由 IPC 层转成错误返回值）；数值自动限幅 */
  async update(patch: SettingsPatch): Promise<void> {
    const next = { ...this.settings }
    if (patch.sidebarWidth !== undefined) {
      next.sidebarWidth = clampInt(patch.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
    }
    if (patch.fontSize !== undefined) {
      next.fontSize = clampInt(patch.fontSize, FONT_SIZE.min, FONT_SIZE.max)
    }
    if (patch.lineHeight !== undefined) next.lineHeight = clampLineHeight(patch.lineHeight)
    if (patch.cursorStyle !== undefined) {
      if (!isCursorStyle(patch.cursorStyle)) throw new Error('光标样式不合法')
      next.cursorStyle = patch.cursorStyle
    }
    if (patch.shell !== undefined) {
      if (!isShellId(patch.shell)) throw new Error('终端类型不合法')
      next.shell = patch.shell
    }
    if (patch.fontFamily !== undefined) {
      const family = patch.fontFamily.trim()
      if (!FONT_FAMILY_PATTERN.test(family)) throw new Error('字体名称不合法')
      next.fontFamily = family
    }
    if (patch.themeSeed !== undefined) {
      if (!THEME_SEED_PATTERN.test(patch.themeSeed)) throw new Error('主题色格式应为 #RRGGBB')
      next.themeSeed = patch.themeSeed.toUpperCase()
    }
    if (patch.claudeCommand !== undefined) next.claudeCommand = checkCommand(patch.claudeCommand)
    if (patch.codexCommand !== undefined) next.codexCommand = checkCommand(patch.codexCommand)
    if (patch.collapsedGroups !== undefined) next.collapsedGroups = parseGroups(patch.collapsedGroups)
    if (patch.lastProjectId !== undefined) next.lastProjectId = patch.lastProjectId
    this.settings = next
    await this.save()
  }

  async setWindowState(state: WindowState): Promise<void> {
    this.settings = { ...this.settings, window: state }
    await this.save()
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private save(): Promise<void> {
    const data: SettingsFile = { version: 1, ...this.settings }
    return this.writer.write(data).catch((err: unknown) => {
      log.error('[settings] 保存失败', err)
      throw err
    })
  }
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampLineHeight(n: number): number {
  return Math.round(Math.min(LINE_HEIGHT.max, Math.max(LINE_HEIGHT.min, n)) * 100) / 100
}

/** 命令会被原样写进终端并回车执行，不允许换行（否则等于执行多条命令） */
function checkCommand(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) throw new Error('启动命令不能为空')
  if (/[\r\n]/.test(trimmed)) throw new Error('启动命令不能包含换行')
  if (trimmed.length > 500) throw new Error('启动命令太长')
  return trimmed
}

function parseSettingsFile(raw: unknown): AppSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return null
  // 单个字段不合法时回退到默认值，设置文件不值得整体备份
  return {
    sidebarWidth:
      typeof r.sidebarWidth === 'number'
        ? clampInt(r.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
        : DEFAULTS.sidebarWidth,
    fontSize:
      typeof r.fontSize === 'number' ? clampInt(r.fontSize, FONT_SIZE.min, FONT_SIZE.max) : DEFAULTS.fontSize,
    fontFamily:
      typeof r.fontFamily === 'string' && FONT_FAMILY_PATTERN.test(r.fontFamily)
        ? r.fontFamily
        : DEFAULTS.fontFamily,
    lineHeight: typeof r.lineHeight === 'number' ? clampLineHeight(r.lineHeight) : DEFAULTS.lineHeight,
    cursorStyle: isCursorStyle(r.cursorStyle) ? r.cursorStyle : DEFAULTS.cursorStyle,
    shell: isShellId(r.shell) ? r.shell : DEFAULTS.shell,
    themeSeed:
      typeof r.themeSeed === 'string' && THEME_SEED_PATTERN.test(r.themeSeed)
        ? r.themeSeed.toUpperCase()
        : DEFAULTS.themeSeed,
    claudeCommand: parseCommand(r.claudeCommand, DEFAULTS.claudeCommand),
    codexCommand: parseCommand(r.codexCommand, DEFAULTS.codexCommand),
    collapsedGroups: parseGroups(r.collapsedGroups),
    lastProjectId: typeof r.lastProjectId === 'string' ? r.lastProjectId : null,
    window: parseWindowState(r.window)
  }
}

function isCursorStyle(v: unknown): v is CursorStyle {
  return typeof v === 'string' && (CURSOR_STYLES as readonly string[]).includes(v)
}

function isShellId(v: unknown): v is ShellId {
  return typeof v === 'string' && (SHELL_IDS as readonly string[]).includes(v)
}

/** 只保留已知的分组，去重并按固定顺序 */
function parseGroups(raw: unknown): SidebarGroup[] {
  return Array.isArray(raw) ? SIDEBAR_GROUPS.filter((g) => raw.includes(g)) : []
}

function parseCommand(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() && !/[\r\n]/.test(raw) ? raw.trim() : fallback
}

function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.width !== 'number' || typeof r.height !== 'number') return null
  const state: WindowState = {
    width: r.width,
    height: r.height,
    maximized: r.maximized === true
  }
  if (typeof r.x === 'number' && typeof r.y === 'number') {
    state.x = r.x
    state.y = r.y
  }
  return state
}
