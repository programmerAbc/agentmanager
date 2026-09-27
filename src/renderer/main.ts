import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { FONT_SIZE, type AppSettings, type Project, type SettingsPatch } from '../shared/types'
import { confirmDialog, iconButton, button } from './dialog'
import { ensureFontLoaded, fontStack } from './fonts'
import { icon, type IconName } from './icons'
import { openSettingsDialog } from './settingsDialog'
import { shapeSvg, type ShapeName } from './shapes'
import { Sidebar } from './sidebar'
import { TerminalManager, isSettingsShortcut, zoomActionOf, type ZoomAction } from './terminalView'
import { applyTheme } from './theme'
import { toast } from './toast'

const api = window.api
const SETTINGS_SAVE_DELAY_MS = 400

/** 渲染进程的总控：持有项目列表、当前选中项和设置，协调侧栏、顶部栏与终端区域。 */
class App {
  private projects: Project[]
  private selectedId: string | null = null
  private settings: AppSettings
  private readonly sidebar: Sidebar
  private readonly terminals: TerminalManager
  private readonly emptyState: HTMLElement
  /** 选中了项目但终端还没启动时显示（启动时恢复上次选中的项目，不自动启动 PTY） */
  private readonly idlePanel: HTMLElement
  private readonly topbar: {
    title: HTMLElement
    subtitle: HTMLElement
    actions: HTMLElement
  }
  private pendingPatch: SettingsPatch = {}
  private saveTimer: number | undefined

  constructor(settings: AppSettings, projects: Project[]) {
    this.projects = projects
    this.settings = settings
    const terminalTheme = applyTheme(settings.themeSeed)

    const host = mustGet('terminal-host')
    this.emptyState = document.createElement('div')
    this.emptyState.className = 'center-panel'
    this.idlePanel = document.createElement('div')
    this.idlePanel.className = 'center-panel clickable'
    this.idlePanel.tabIndex = 0
    // 用户第一次点击或聚焦时才启动 PTY
    const startSelected = (): void => {
      if (this.selectedId) this.select(this.selectedId, true)
    }
    this.idlePanel.addEventListener('click', startSelected)
    this.idlePanel.addEventListener('focus', startSelected)
    this.idlePanel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        startSelected()
      }
    })
    host.append(this.emptyState, this.idlePanel)

    this.topbar = this.buildTopbar(mustGet('topbar'))

    this.terminals = new TerminalManager(
      host,
      {
        fontFamily: fontStack(settings.fontFamily),
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        theme: terminalTheme
      },
      {
        onRunningChange: (id, running) => this.sidebar.setRunning(id, running),
        onError: (message) => toast(message)
      }
    )

    this.sidebar = new Sidebar(mustGet('sidebar'), mustGet('resizer'), {
      onAdd: () => void this.addProject(),
      onOpenSettings: () => this.openSettings(),
      onSelect: (id) => this.select(id, true),
      onRename: (id, name) => void this.renameProject(id, name),
      onRemove: (id) => void this.removeProject(id),
      onOpenInExplorer: (id) => void this.openInExplorer(id),
      onRestartTerminal: (id) => void this.restartTerminal(id),
      onWidthChange: (width, done) => {
        if (done) this.changeSettings({ sidebarWidth: width })
      }
    })
    this.sidebar.setWidth(settings.sidebarWidth)
    this.sidebar.setProjects(this.projects)

    // 应用级快捷键：字号（Ctrl+= / - / 0）、设置（Ctrl+,）。焦点在侧栏时也可用
    document.addEventListener(
      'keydown',
      (e) => {
        const action = zoomActionOf(e)
        if (action) {
          e.preventDefault()
          this.zoom(action)
        } else if (isSettingsShortcut(e)) {
          e.preventDefault()
          this.openSettings()
        }
      },
      true
    )

    const last = settings.lastProjectId
    this.select(last && this.projects.some((p) => p.id === last) ? last : null, false)

    if (import.meta.env.DEV) {
      // 开发期自测钩子：通过 DevTools / CDP 读取终端缓冲区
      window.__agentDesk = { terminals: () => this.terminals.debugSnapshot() }
    }
  }

  /**
   * 选中项目。start=true 时打开（必要时创建并启动）它的终端；
   * start=false 时只选中，已有终端则显示，没有则显示「点击启动」面板。
   */
  select(id: string | null, start: boolean): void {
    if (id !== null && !this.projects.some((p) => p.id === id)) id = null
    const changed = this.selectedId !== id
    this.selectedId = id
    this.sidebar.setSelected(id)

    if (id && (start || this.terminals.has(id))) this.terminals.show(id)
    else this.terminals.hideActive()
    this.render()

    if (changed) {
      this.changeSettings({ lastProjectId: id })
      if (id) void api.projects.touch(id)
    }
  }

  // ---------------- 设置 ----------------

  private openSettings(): void {
    openSettingsDialog({
      get: () => this.settings,
      change: (patch) => this.changeSettings(patch)
    })
  }

  /** 立即应用到界面，合并后延迟写盘 */
  private changeSettings(patch: SettingsPatch): void {
    const prev = this.settings
    this.settings = { ...this.settings, ...patch }
    const s = this.settings

    if (patch.themeSeed !== undefined && patch.themeSeed !== prev.themeSeed) {
      this.terminals.setAppearance({ theme: applyTheme(s.themeSeed) })
    }
    if (patch.fontFamily !== undefined && patch.fontFamily !== prev.fontFamily) {
      void ensureFontLoaded(s.fontFamily, s.fontSize).then(() =>
        this.terminals.setAppearance({ fontFamily: fontStack(s.fontFamily) })
      )
    }
    if (patch.fontSize !== undefined || patch.lineHeight !== undefined) {
      this.terminals.setAppearance({ fontSize: s.fontSize, lineHeight: s.lineHeight })
    }

    this.pendingPatch = { ...this.pendingPatch, ...patch }
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => void this.flushSettings(), SETTINGS_SAVE_DELAY_MS)
  }

  private async flushSettings(): Promise<void> {
    const patch = this.pendingPatch
    this.pendingPatch = {}
    const result = await api.settings.update(patch)
    if (!result.ok) toast(result.error)
  }

  private zoom(action: ZoomAction): void {
    const current = this.settings.fontSize
    const next =
      action === 'reset'
        ? FONT_SIZE.default
        : Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, current + (action === 'in' ? 1 : -1)))
    if (next !== current) this.changeSettings({ fontSize: next })
  }

  // ---------------- 项目 ----------------

  private async addProject(): Promise<void> {
    const result = await api.projects.add()
    if (!result.ok) {
      toast(result.error)
      return
    }
    const project = result.data
    if (!project) return // 用户取消
    if (!this.projects.some((p) => p.id === project.id)) {
      this.projects = [...this.projects, project]
      this.sidebar.setProjects(this.projects)
    }
    this.select(project.id, true)
  }

  private async renameProject(id: string, name: string): Promise<void> {
    const result = await api.projects.rename(id, name)
    if (!result.ok) {
      toast(result.error)
      return
    }
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, name } : p))
    this.sidebar.setProjects(this.projects)
    this.render()
  }

  private async removeProject(id: string): Promise<void> {
    const project = this.projects.find((p) => p.id === id)
    if (!project) return
    const confirmed = await confirmDialog({
      title: '移除项目',
      icon: 'delete',
      message: `确定移除「${project.name}」？`,
      detail: `${project.path}\n\n只会从列表中移除，不会删除磁盘上的文件。如果终端正在运行，会被结束。`,
      confirmLabel: '移除',
      danger: true
    })
    if (!confirmed) return
    const result = await api.projects.remove(id)
    if (!result.ok) {
      toast(result.error)
      return
    }
    this.terminals.dispose(id)
    this.sidebar.setRunning(id, false)
    this.projects = this.projects.filter((p) => p.id !== id)
    this.sidebar.setProjects(this.projects)
    if (this.selectedId === id) this.select(null, false)
    else this.render()
  }

  private async restartTerminal(id: string): Promise<void> {
    if (this.terminals.has(id)) await this.terminals.restart(id)
    else this.select(id, true)
  }

  private async openInExplorer(id: string): Promise<void> {
    const result = await api.projects.openInExplorer(id)
    if (!result.ok) toast(result.error)
  }

  // ---------------- 渲染 ----------------

  private buildTopbar(root: HTMLElement): App['topbar'] {
    const titles = document.createElement('div')
    titles.className = 'topbar-titles'
    const title = document.createElement('div')
    title.className = 'topbar-title'
    const subtitle = document.createElement('div')
    subtitle.className = 'topbar-subtitle'
    titles.append(title, subtitle)

    const actions = document.createElement('div')
    actions.className = 'topbar-actions'
    actions.append(
      iconButton('restartAlt', '重启终端', () => {
        if (this.selectedId) void this.restartTerminal(this.selectedId)
      }),
      iconButton('folderOpen', '在资源管理器中打开', () => {
        if (this.selectedId) void this.openInExplorer(this.selectedId)
      })
    )
    root.append(titles, actions)
    return { title, subtitle, actions }
  }

  private render(): void {
    const project = this.projects.find((p) => p.id === this.selectedId) ?? null
    document.title = project ? `Agent Desk — ${project.name}` : 'Agent Desk'

    this.topbar.title.textContent = project ? project.name : 'Agent Desk'
    this.topbar.subtitle.textContent = project ? project.path : '项目终端管理器'
    this.topbar.subtitle.title = project?.path ?? ''
    this.topbar.actions.hidden = project === null

    const terminalShown = project !== null && this.terminals.has(project.id)
    this.emptyState.hidden = project !== null
    this.idlePanel.hidden = project === null || terminalShown

    if (project && !terminalShown) {
      renderPanel(this.idlePanel, {
        shape: 'cookie12',
        icon: 'terminal',
        title: project.name,
        path: project.path,
        hint: '终端尚未启动，点击此处或按 Enter 启动。',
        buttons: [{ label: '启动终端', variant: 'filled', icon: 'playArrowFill' }]
      })
    } else if (!project && this.projects.length === 0) {
      renderPanel(this.emptyState, {
        shape: 'softBurst',
        icon: 'rocketLaunch',
        title: '还没有项目',
        hint: '添加一个本地目录作为项目，然后在终端里运行 claude 等命令。',
        buttons: [{ label: '添加项目', variant: 'filled', icon: 'add', action: () => void this.addProject() }]
      })
    } else if (!project) {
      renderPanel(this.emptyState, {
        shape: 'cookie9',
        icon: 'terminal',
        title: '选择一个项目',
        hint: '从左侧列表中选择一个项目以打开它的终端。'
      })
    }
  }
}

interface PanelOptions {
  shape: ShapeName
  icon: IconName
  title: string
  path?: string
  hint?: string
  /** 没有 action 的按钮点击会冒泡给面板处理 */
  buttons?: { label: string; variant: 'filled' | 'tonal'; icon: IconName; action?: () => void }[]
}

function renderPanel(panel: HTMLElement, o: PanelOptions): void {
  const hero = document.createElement('div')
  hero.className = 'hero-shape'
  hero.append(shapeSvg(o.shape, 'shape'), icon(o.icon))
  const children: HTMLElement[] = [hero]
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = o.title
  children.push(title)
  if (o.path) {
    const pathEl = document.createElement('div')
    pathEl.className = 'path'
    pathEl.textContent = o.path
    pathEl.title = o.path
    children.push(pathEl)
  }
  if (o.hint) {
    const hintEl = document.createElement('div')
    hintEl.className = 'hint'
    hintEl.textContent = o.hint
    children.push(hintEl)
  }
  if (o.buttons?.length) {
    const actions = document.createElement('div')
    actions.className = 'actions'
    for (const b of o.buttons) {
      const btn = button(b.label, b.variant, b.icon)
      if (b.action) btn.addEventListener('click', b.action)
      else btn.tabIndex = -1
      actions.appendChild(btn)
    }
    children.push(actions)
  }
  panel.replaceChildren(...children)
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`缺少 #${id}`)
  return el
}

async function bootstrap(): Promise<void> {
  const [settings, projects] = await Promise.all([api.settings.get(), api.projects.list()])
  // 选的是内置字体时先加载，否则 xterm 会按回退字体测量字符宽度
  await ensureFontLoaded(settings.fontFamily, settings.fontSize)
  new App(settings, projects)
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  toast(`启动失败：${err instanceof Error ? err.message : String(err)}`)
})
