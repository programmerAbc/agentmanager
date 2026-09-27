import { SIDEBAR_WIDTH, type AgentKind, type Project } from '../shared/types'
import { ALL_STATUSES, statusIndicator, statusText, type AgentState } from './agentStatus'
import { showContextMenu } from './contextMenu'
import { icon } from './icons'
import { shapeSvg } from './shapes'

export interface SidebarCallbacks {
  onAdd(): void
  onOpenSettings(): void
  onOpenAbout(): void
  onSelect(id: string): void
  onLaunchAgent(id: string, agent: AgentKind): void
  onRename(id: string, name: string): void
  onRemove(id: string): void
  onOpenInExplorer(id: string): void
  onRestartTerminal(id: string): void
  /** 拖动过程中 done=false，松开鼠标时 done=true（此时再持久化） */
  onWidthChange(width: number, done: boolean): void
}

/** 左侧项目列表：添加、选中、行内重命名、右键菜单、宽度拖拽。 */
export class Sidebar {
  private projects: Project[] = []
  private selectedId: string | null = null
  private readonly running = new Set<string>()
  private readonly agents = new Map<string, AgentState>()
  private readonly list: HTMLUListElement
  private width: number = SIDEBAR_WIDTH.default

  constructor(
    private readonly root: HTMLElement,
    private readonly resizer: HTMLElement,
    private readonly cb: SidebarCallbacks
  ) {
    // 抽屉头部：应用名 + 扩展 FAB
    const header = document.createElement('div')
    header.className = 'drawer-header'
    const title = document.createElement('button')
    title.type = 'button'
    title.className = 'app-title'
    title.title = '关于 Agent Desk'
    title.append(shapeSvg('cookie9', 'app-logo'), document.createTextNode('Agent Desk'))
    title.addEventListener('click', () => cb.onOpenAbout())
    const addButton = document.createElement('button')
    addButton.type = 'button'
    addButton.className = 'fab add-project'
    addButton.append(icon('add'), document.createTextNode('添加项目'))
    addButton.addEventListener('click', () => cb.onAdd())
    header.append(title, addButton)

    const label = document.createElement('div')
    label.className = 'list-label'
    label.textContent = '项目'

    // 抽屉底部：设置
    const footer = document.createElement('div')
    footer.className = 'drawer-footer'
    const settingsButton = document.createElement('button')
    settingsButton.type = 'button'
    settingsButton.className = 'nav-footer-btn'
    settingsButton.title = '设置（Ctrl+,）'
    settingsButton.append(icon('settings'), document.createTextNode('设置'))
    settingsButton.addEventListener('click', () => cb.onOpenSettings())
    footer.appendChild(settingsButton)

    this.list = document.createElement('ul')
    this.list.className = 'project-list'
    this.list.addEventListener('click', (e) => {
      const id = this.itemIdFromEvent(e)
      if (id) cb.onSelect(id)
    })
    this.list.addEventListener('keydown', (e) => this.onListKeyDown(e))
    this.list.addEventListener('contextmenu', (e) => {
      const id = this.itemIdFromEvent(e)
      if (!id) return
      e.preventDefault()
      this.openItemMenu(id, e.clientX, e.clientY)
    })

    root.append(header, label, this.list, footer)
    this.setupResizer()
  }

  setProjects(projects: Project[]): void {
    this.projects = projects
    this.render()
  }

  setSelected(id: string | null): void {
    this.selectedId = id
    for (const li of this.items()) li.classList.toggle('selected', li.dataset.id === id)
  }

  setRunning(id: string, running: boolean): void {
    if (running) this.running.add(id)
    else this.running.delete(id)
    this.itemById(id)?.classList.toggle('running', running)
  }

  setAgentState(id: string, state: AgentState | null): void {
    if (state) this.agents.set(id, state)
    else this.agents.delete(id)
    const li = this.itemById(id)
    const project = this.projects.find((p) => p.id === id)
    if (li && project) this.applyAgentState(li, project)
  }

  /** 状态图形放在名称前；有助手在运行时第二行显示状态文字，否则显示路径 */
  private applyAgentState(li: HTMLLIElement, project: Project): void {
    const state = this.agents.get(project.id) ?? null
    const status = state?.status ?? 'none'
    for (const s of ALL_STATUSES) li.classList.toggle(`agent-${s}`, s === status)
    li.querySelector('.status-slot')?.replaceChildren(statusIndicator(status))
    const pathEl = li.querySelector('.project-path')
    if (pathEl) pathEl.textContent = state ? statusText(state) : shortenPath(project.path)
  }

  setWidth(width: number): void {
    this.width = clampWidth(width)
    document.documentElement.style.setProperty('--sidebar-width', `${this.width}px`)
  }

  /** 行内重命名：Enter 确认，Esc 取消，失焦视为确认 */
  beginRename(id: string): void {
    const project = this.projects.find((p) => p.id === id)
    const li = this.itemById(id)
    const nameEl = li?.querySelector<HTMLElement>('.project-name')
    if (!project || !li || !nameEl) return

    const input = document.createElement('input')
    input.className = 'rename-input'
    input.value = project.name
    input.spellcheck = false
    nameEl.replaceWith(input)
    input.focus()
    input.select()

    let finished = false
    const finish = (commit: boolean): void => {
      if (finished) return
      finished = true
      const value = input.value.trim()
      input.replaceWith(nameEl)
      if (commit && value && value !== project.name) this.cb.onRename(id, value)
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing) return // 输入法选词时的 Enter/Esc 不算
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
  }

  private render(): void {
    const fragment = document.createDocumentFragment()
    for (const project of this.projects) {
      const li = document.createElement('li')
      li.className = 'project-item'
      li.dataset.id = project.id
      li.tabIndex = 0
      li.title = project.path
      li.classList.toggle('selected', project.id === this.selectedId)
      li.classList.toggle('running', this.running.has(project.id))

      const slot = document.createElement('span')
      slot.className = 'status-slot'
      const text = document.createElement('div')
      text.className = 'project-text'
      const name = document.createElement('div')
      name.className = 'project-name'
      name.textContent = project.name
      const pathEl = document.createElement('div')
      pathEl.className = 'project-path'
      pathEl.textContent = shortenPath(project.path)
      text.append(name, pathEl)
      li.append(slot, text)
      this.applyAgentState(li, project)
      fragment.appendChild(li)
    }
    this.list.replaceChildren(fragment)
  }

  private openItemMenu(id: string, x: number, y: number): void {
    showContextMenu(x, y, [
      {
        label: '启动 Claude',
        icon: 'rocketLaunch',
        disabled: this.agents.has(id),
        action: () => this.cb.onLaunchAgent(id, 'claude')
      },
      {
        label: '启动 Codex',
        icon: 'codeBlocks',
        disabled: this.agents.has(id),
        action: () => this.cb.onLaunchAgent(id, 'codex')
      },
      { separator: true },
      { label: '重命名', icon: 'edit', action: () => this.beginRename(id) },
      { label: '在资源管理器中打开', icon: 'folderOpen', action: () => this.cb.onOpenInExplorer(id) },
      { label: '重启终端', icon: 'restartAlt', action: () => this.cb.onRestartTerminal(id) },
      { separator: true },
      { label: '移除项目', icon: 'delete', danger: true, action: () => this.cb.onRemove(id) }
    ])
  }

  private onListKeyDown(e: KeyboardEvent): void {
    const id = this.itemIdFromEvent(e)
    if (!id) return
    if (e.key === 'Enter') {
      e.preventDefault()
      this.cb.onSelect(id)
    } else if (e.key === 'F2') {
      e.preventDefault()
      this.beginRename(id)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const li = (e.target as HTMLElement).closest('li')
      const next = e.key === 'ArrowDown' ? li?.nextElementSibling : li?.previousElementSibling
      if (next instanceof HTMLElement) next.focus()
    }
  }

  private setupResizer(): void {
    this.resizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      this.resizer.setPointerCapture(e.pointerId)
      this.resizer.classList.add('dragging')
      document.body.classList.add('resizing')

      const onMove = (ev: PointerEvent): void => {
        const rootLeft = this.root.getBoundingClientRect().left
        this.setWidth(ev.clientX - rootLeft)
        this.cb.onWidthChange(this.width, false)
      }
      const onUp = (ev: PointerEvent): void => {
        this.resizer.releasePointerCapture(ev.pointerId)
        this.resizer.classList.remove('dragging')
        document.body.classList.remove('resizing')
        this.resizer.removeEventListener('pointermove', onMove)
        this.resizer.removeEventListener('pointerup', onUp)
        this.resizer.removeEventListener('pointercancel', onUp)
        this.cb.onWidthChange(this.width, true)
      }
      this.resizer.addEventListener('pointermove', onMove)
      this.resizer.addEventListener('pointerup', onUp)
      this.resizer.addEventListener('pointercancel', onUp)
    })
    // 双击拖拽条恢复默认宽度
    this.resizer.addEventListener('dblclick', () => {
      this.setWidth(SIDEBAR_WIDTH.default)
      this.cb.onWidthChange(this.width, true)
    })
  }

  private items(): HTMLLIElement[] {
    return [...this.list.querySelectorAll<HTMLLIElement>('li.project-item')]
  }

  private itemById(id: string): HTMLLIElement | undefined {
    return this.items().find((li) => li.dataset.id === id)
  }

  private itemIdFromEvent(e: Event): string | null {
    const li = (e.target as HTMLElement | null)?.closest<HTMLLIElement>('li.project-item')
    return li?.dataset.id ?? null
  }
}

function clampWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))
}

/** D:\develop\workspace\foo\bar → D:\…\foo\bar */
export function shortenPath(p: string): string {
  const prefix = p.startsWith('\\\\') ? '\\\\' : ''
  const parts = p.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 3) return p
  return `${prefix}${parts[0]}\\…\\${parts.slice(-2).join('\\')}`
}
