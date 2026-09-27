import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { FONT_SIZE, type AppSettings, type Project, type SettingsPatch } from '../shared/types'
import { Sidebar } from './sidebar'
import { TerminalManager, zoomActionOf, type ZoomAction } from './terminalView'
import { toast } from './toast'

const api = window.api
const FONT_SIZE_SAVE_DELAY_MS = 400

/** 渲染进程的总控：持有项目列表和当前选中项，协调侧栏与终端区域。 */
class App {
  private projects: Project[]
  private selectedId: string | null = null
  private readonly sidebar: Sidebar
  private readonly terminals: TerminalManager
  private readonly emptyState: HTMLElement
  /** 选中了项目但终端还没启动时显示（启动时恢复上次选中的项目，不自动启动 PTY） */
  private readonly idlePanel: HTMLElement
  private fontSize: number
  private fontSizeSaveTimer: number | undefined

  constructor(settings: AppSettings, projects: Project[]) {
    this.projects = projects
    this.fontSize = settings.fontSize

    const sidebarEl = mustGet('sidebar')
    const resizer = mustGet('resizer')
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

    this.terminals = new TerminalManager(host, settings.fontSize, {
      onRunningChange: (id, running) => this.sidebar.setRunning(id, running),
      onError: (message) => toast(message)
    })

    this.sidebar = new Sidebar(sidebarEl, resizer, {
      onAdd: () => void this.addProject(),
      onSelect: (id) => this.select(id, true),
      onRename: (id, name) => void this.renameProject(id, name),
      onRemove: (id) => void this.removeProject(id),
      onOpenInExplorer: (id) => void this.openInExplorer(id),
      onRestartTerminal: (id) => void this.restartTerminal(id),
      onWidthChange: (width, done) => {
        if (done) void this.saveSettings({ sidebarWidth: width })
      }
    })
    this.sidebar.setWidth(settings.sidebarWidth)
    this.sidebar.setProjects(this.projects)

    // 字号快捷键全局生效（焦点在侧栏时也可用）；终端内的同一组合键不会发给 PTY
    document.addEventListener(
      'keydown',
      (e) => {
        const action = zoomActionOf(e)
        if (!action) return
        e.preventDefault()
        this.zoom(action)
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
      void this.saveSettings({ lastProjectId: id })
      if (id) void api.projects.touch(id)
    }
  }

  private zoom(action: ZoomAction): void {
    const next =
      action === 'reset'
        ? FONT_SIZE.default
        : Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, this.fontSize + (action === 'in' ? 1 : -1)))
    if (next === this.fontSize) return
    this.fontSize = next
    this.terminals.setFontSize(next)
    window.clearTimeout(this.fontSizeSaveTimer)
    this.fontSizeSaveTimer = window.setTimeout(
      () => void this.saveSettings({ fontSize: this.fontSize }),
      FONT_SIZE_SAVE_DELAY_MS
    )
  }

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
    const confirmed = await api.dialog.confirm({
      message: `确定移除项目「${project.name}」？`,
      detail: `${project.path}\n\n只会从列表中移除，不会删除磁盘上的文件。如果终端正在运行，会被结束。`,
      okLabel: '移除'
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

  private async saveSettings(patch: SettingsPatch): Promise<void> {
    const result = await api.settings.update(patch)
    if (!result.ok) toast(result.error)
  }

  private render(): void {
    const project = this.projects.find((p) => p.id === this.selectedId) ?? null
    document.title = project ? `Agent Desk — ${project.name}` : 'Agent Desk'

    const terminalShown = project !== null && this.terminals.has(project.id)
    this.emptyState.hidden = project !== null
    this.idlePanel.hidden = project === null || terminalShown

    if (project && !terminalShown) {
      renderPanel(this.idlePanel, project.name, project.path, '终端尚未启动，点击此处或按 Enter 启动。', {
        label: '启动终端'
      })
    } else if (!project && this.projects.length === 0) {
      renderPanel(this.emptyState, '还没有项目', null, '添加一个本地目录作为项目，然后在终端里运行 claude 等命令。', {
        label: '＋ 添加项目',
        action: () => void this.addProject()
      })
    } else if (!project) {
      renderPanel(this.emptyState, '选择一个项目', null, '从左侧列表中选择一个项目以打开它的终端。')
    }
  }
}

function renderPanel(
  panel: HTMLElement,
  title: string,
  path: string | null,
  hint?: string,
  button?: { label: string; action?: () => void }
): void {
  const children: HTMLElement[] = []
  const titleEl = document.createElement('div')
  titleEl.className = 'title'
  titleEl.textContent = title
  children.push(titleEl)
  if (path) {
    const pathEl = document.createElement('div')
    pathEl.className = 'path'
    pathEl.textContent = path
    pathEl.title = path
    children.push(pathEl)
  }
  if (hint) {
    const hintEl = document.createElement('div')
    hintEl.className = 'hint'
    hintEl.textContent = hint
    children.push(hintEl)
  }
  if (button) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'primary'
    btn.textContent = button.label
    // 没有 action 时点击冒泡给面板处理
    if (button.action) btn.addEventListener('click', button.action)
    else btn.tabIndex = -1
    children.push(btn)
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
  // 先加载终端字体再创建 xterm，否则 xterm 会按回退字体测量字符宽度
  try {
    await document.fonts.load(`${settings.fontSize}px "Sarasa Term SC"`)
  } catch (err) {
    console.warn('终端字体加载失败，使用回退字体', err)
  }
  new App(settings, projects)
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  toast(`启动失败：${err instanceof Error ? err.message : String(err)}`)
})
