import '@xterm/xterm/css/xterm.css'
import './styles.css'
import {
  AGENT_LABEL,
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CODEX_COMMAND,
  FONT_SIZE,
  type AgentKind,
  type AgentDashboard,
  type AppSettings,
  type Project,
  type SettingsPatch
} from '../shared/types'
import { AgentStatusTracker } from './agentStatus'
import { Dashboard } from './dashboard'
import { confirmDialog, button } from './dialog'
import { ensureFontLoaded, fontStack } from './fonts'
import { icon, type IconName } from './icons'
import { openAboutDialog, openSettingsDialog, row, sectionEl } from './settingsDialog'
import { shapeSvg, type ShapeName } from './shapes'
import { Sidebar } from './sidebar'
import { TerminalManager, isSearchShortcut, isSettingsShortcut, zoomActionOf, type ZoomAction } from './terminalView'
import { applyTheme } from './theme'
import { toast } from './toast'

const api = window.api
const SETTINGS_SAVE_DELAY_MS = 400
const AGENT_ICON: Record<AgentKind, IconName> = { claude: 'rocketLaunch', codex: 'codeBlocks' }

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
  private readonly dashboard: Dashboard
  private readonly dashboardValues = new Map<string, AgentDashboard>()
  private readonly dashboardRevisions = new Map<string, number>()
  private readonly agents: AgentStatusTracker
  private pendingPatch: SettingsPatch = {}
  private saveTimer: number | undefined

  constructor(settings: AppSettings, projects: Project[]) {
    this.projects = projects
    this.settings = settings
    const terminalColors = applyTheme(settings.themeSeed)

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

    this.dashboard = new Dashboard(mustGet('dashboard'), settings.dashboardCollapsed,
      collapsed => this.changeSettings({ dashboardCollapsed: collapsed }))
    this.buildTopbar(mustGet('topbar'))
    api.dashboard.onUpdate((id, value) => {
      this.dashboardRevisions.set(id, (this.dashboardRevisions.get(id) ?? 0) + 1)
      if (value) this.dashboardValues.set(id, value)
      else this.dashboardValues.delete(id)
      if (id === this.selectedId) this.render()
    })

    this.agents = new AgentStatusTracker((id, state) => {
      this.sidebar.setAgentState(id, state)
      if (id === this.selectedId) this.render()
    })
    api.agents.onEvent((id, event) => this.agents.handleEvent(id, event))

    this.terminals = new TerminalManager(
      host,
      {
        fontFamily: fontStack(settings.fontFamily),
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        cursorStyle: settings.cursorStyle,
        ...terminalColors
      },
      {
        onRunningChange: (id, running) => {
          this.sidebar.setRunning(id, running)
          // 终端退出 / 被结束，里面的助手也就没了
          if (!running) this.agents.reset(id)
        },
        onInput: (id, data) => this.agents.markInput(id, data),
        onError: (message) => toast(message)
      }
    )

    this.sidebar = new Sidebar(mustGet('sidebar'), mustGet('resizer'), {
      onAdd: () => void this.addProject(),
      onOpenSettings: () => this.openSettings(),
      onOpenAbout: () => openAboutDialog(() => this.openSettings()),
      // 点击项目只选中，不启动终端（用户要求）；已有终端则显示
      onSelect: (id) => this.select(id, false),
      onLaunchAgent: (id, agent) => void this.launchAgent(id, agent),
      onRename: (id, name) => void this.renameProject(id, name),
      onSetStarred: (id, starred) => void this.setStarred(id, starred),
      onCollapsedChange: (groups) => this.changeSettings({ collapsedGroups: groups }),
      onRemove: (id) => void this.removeProject(id),
      onOpenInExplorer: (id) => void this.openInExplorer(id),
      onEndTerminal: (id) => this.endTerminal(id),
      hasTerminal: (id) => this.terminals.has(id),
      onSearchDone: () => {
        if (this.selectedId) this.terminals.focus(this.selectedId)
      },
      onWidthChange: (width, done) => {
        if (done) this.changeSettings({ sidebarWidth: width })
      }
    })
    this.sidebar.setWidth(settings.sidebarWidth)
    this.sidebar.setCollapsedGroups(settings.collapsedGroups)
    this.sidebar.setProjects(this.projects)

    // 应用级快捷键：字号（Ctrl+= / - / 0）、设置（Ctrl+,）、搜索项目（Ctrl+Shift+F）。焦点在侧栏时也可用
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
        } else if (isSearchShortcut(e)) {
          e.preventDefault()
          // 对话框打开时不把焦点移到它后面的侧栏
          if (!document.querySelector('.dialog-scrim, dialog[open]')) this.sidebar.focusSearch()
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
      if (id) {
        const revision = this.dashboardRevisions.get(id) ?? 0
        void api.dashboard.get(id).then(value => {
          if ((this.dashboardRevisions.get(id) ?? 0) !== revision) return
          if (value) this.dashboardValues.set(id, value)
          else this.dashboardValues.delete(id)
          if (id === this.selectedId) this.render()
        }).catch(() => undefined)
        void api.projects.touch(id)
        this.agents.markSeen(id)
      }
    }
  }

  // ---------------- AI 助手 ----------------

  /** 在项目终端里执行设置中的助手启动命令；终端未启动 / 已退出时先启动 */
  private async launchAgent(id: string, agent: AgentKind): Promise<void> {
    if (this.selectedId !== id) this.select(id, true)
    const current = this.agents.get(id)
    if (current) {
      toast(`${AGENT_LABEL[current.agent]} 已经在这个终端里运行`, 'info')
      this.terminals.focus(id)
      return
    }
    const running = await this.terminals.ensureRunning(id)
    this.render()
    if (!running) return
    this.agents.markLaunched(id, agent)
    const result = await api.agents.launch(id, agent)
    if (!result.ok) {
      this.agents.reset(id)
      toast(result.error)
    }
    this.terminals.focus(id)
  }

  private agentsSection(): HTMLElement {
    const section = sectionEl('AI 助手', 'rocketLaunch')
    section.append(
      ...this.commandField(
        'claudeCommand',
        'Claude 启动命令',
        '「启动 Claude」按钮执行的命令',
        DEFAULT_CLAUDE_COMMAND,
        '命令以 claude 开头时会自动追加 --settings，用于显示工作状态（不修改 ~/.claude/settings.json）。'
      ),
      ...this.commandField(
        'codexCommand',
        'Codex 启动命令',
        '「启动 Codex」按钮执行的命令',
        DEFAULT_CODEX_COMMAND,
        '命令以 codex 开头时会自动追加 -c 注入 hooks 以显示工作状态（不修改 ~/.codex/config.toml）。' +
          '首次启动时 codex 会提示「Hooks need review」，选择「Trust all and continue」后不再提示。'
      )
    )
    const note = document.createElement('div')
    note.className = 'field-help'
    note.textContent = '只有通过按钮启动的助手才会显示状态；在终端里手动输入的 claude / codex 没有状态。'
    section.appendChild(note)
    return section
  }

  private commandField(
    key: 'claudeCommand' | 'codexCommand',
    name: string,
    desc: string,
    defaultValue: string,
    helpText: string
  ): HTMLElement[] {
    const input = document.createElement('input')
    input.className = 'text-field'
    input.spellcheck = false
    input.value = this.settings[key]
    const commit = (): void => {
      const value = input.value.trim()
      if (!value) {
        input.value = this.settings[key]
        return
      }
      if (value !== this.settings[key]) this.changeSettings({ [key]: value })
    }
    input.addEventListener('change', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
    })
    const reset = button('恢复默认', 'text')
    reset.addEventListener('click', () => {
      input.value = defaultValue
      commit()
    })
    const field = document.createElement('div')
    field.className = 'field-row'
    field.append(input, reset)
    const help = document.createElement('div')
    help.className = 'field-help'
    help.textContent = helpText
    return [row(name, desc), field, help]
  }

  // ---------------- 设置 ----------------

  private openSettings(): void {
    openSettingsDialog({
      get: () => this.settings,
      change: (patch) => this.changeSettings(patch),
      extraSections: [() => this.agentsSection()]
    })
  }

  /** 立即应用到界面，合并后延迟写盘 */
  private changeSettings(patch: SettingsPatch): void {
    const prev = this.settings
    this.settings = { ...this.settings, ...patch }
    const s = this.settings

    if (patch.themeSeed !== undefined && patch.themeSeed !== prev.themeSeed) {
      this.terminals.setAppearance(applyTheme(s.themeSeed))
      this.dashboard.refreshTheme()
    }
    if (patch.fontFamily !== undefined && patch.fontFamily !== prev.fontFamily) {
      void ensureFontLoaded(s.fontFamily, s.fontSize).then(() =>
        this.terminals.setAppearance({ fontFamily: fontStack(s.fontFamily) })
      )
    }
    if (patch.fontSize !== undefined || patch.lineHeight !== undefined) {
      this.terminals.setAppearance({ fontSize: s.fontSize, lineHeight: s.lineHeight })
    }
    if (patch.cursorStyle !== undefined && patch.cursorStyle !== prev.cursorStyle) {
      this.terminals.setAppearance({ cursorStyle: s.cursorStyle })
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
    this.select(project.id, false)
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

  /** 加星标的项目移到侧栏「收藏」分组，取消后回到「项目」分组原来的位置 */
  private async setStarred(id: string, starred: boolean): Promise<void> {
    const result = await api.projects.setStarred(id, starred)
    if (!result.ok) {
      toast(result.error)
      return
    }
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, starred } : p))
    this.sidebar.setProjects(this.projects)
    this.sidebar.highlight(id)
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

  /** 结束项目的终端（PTY 及其进程树），项目回到「未启动」面板 */
  private endTerminal(id: string): void {
    this.terminals.end(id)
    this.render()
  }

  private async openInExplorer(id: string): Promise<void> {
    const result = await api.projects.openInExplorer(id)
    if (!result.ok) toast(result.error)
  }

  // ---------------- 渲染 ----------------

  private buildTopbar(root: HTMLElement): void {
    const heading = document.createElement('div')
    heading.className = 'terminal-heading'
    heading.append(icon('terminal'), document.createTextNode('项目终端'))
    root.append(heading, this.dashboard.toggleButton)
  }

  private render(): void {
    const project = this.projects.find((p) => p.id === this.selectedId) ?? null
    document.title = project ? `AgentManager — ${project.name}` : 'AgentManager'

    this.dashboard.render(project, project ? this.dashboardValues.get(project.id) ?? null : null)

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
        buttons: [
          { label: '启动终端', variant: 'tonal', icon: 'playArrowFill' },
          ...(['claude', 'codex'] as const).map((agent) => ({
            label: `启动 ${AGENT_LABEL[agent]}`,
            variant: 'filled' as const,
            icon: AGENT_ICON[agent],
            action: (e: MouseEvent) => {
              // 不冒泡给面板（面板点击只启动终端）
              e.stopPropagation()
              void this.launchAgent(project.id, agent)
            }
          }))
        ]
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
  buttons?: { label: string; variant: 'filled' | 'tonal'; icon: IconName; action?: (e: MouseEvent) => void }[]
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
  document.documentElement.classList.remove('booting')
}

bootstrap().catch((err: unknown) => {
  document.documentElement.classList.remove('booting')
  console.error(err)
  toast(`启动失败：${err instanceof Error ? err.message : String(err)}`)
})
