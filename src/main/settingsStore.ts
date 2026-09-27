import {
  FONT_SIZE,
  SIDEBAR_WIDTH,
  type AppSettings,
  type SettingsFile,
  type SettingsPatch,
  type WindowState
} from '../shared/types'
import { JsonFileWriter, readJsonFile } from './jsonFile'
import log from './log'

const DEFAULTS: AppSettings = {
  sidebarWidth: SIDEBAR_WIDTH.default,
  fontSize: FONT_SIZE.default,
  lastProjectId: null,
  window: null
}

/** settings.json：侧栏宽度、字号、最后选中的项目、窗口状态。与 projects.json 同样原子写入。 */
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
    return { ...this.settings, window: this.settings.window ? { ...this.settings.window } : null }
  }

  async update(patch: SettingsPatch): Promise<void> {
    const next = { ...this.settings }
    if (patch.sidebarWidth !== undefined) {
      next.sidebarWidth = clamp(patch.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
    }
    if (patch.fontSize !== undefined) {
      next.fontSize = clamp(patch.fontSize, FONT_SIZE.min, FONT_SIZE.max)
    }
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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function parseSettingsFile(raw: unknown): AppSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return null
  // 单个字段不合法时回退到默认值，设置文件不值得整体备份
  return {
    sidebarWidth:
      typeof r.sidebarWidth === 'number'
        ? clamp(r.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
        : DEFAULTS.sidebarWidth,
    fontSize:
      typeof r.fontSize === 'number'
        ? clamp(r.fontSize, FONT_SIZE.min, FONT_SIZE.max)
        : DEFAULTS.fontSize,
    lastProjectId: typeof r.lastProjectId === 'string' ? r.lastProjectId : null,
    window: parseWindowState(r.window)
  }
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
