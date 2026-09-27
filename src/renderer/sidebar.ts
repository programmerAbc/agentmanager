import { SIDEBAR_WIDTH, type AgentKind, type Project } from '../shared/types'
import { ALL_STATUSES, statusIndicator, statusText, type AgentState } from './agentStatus'
import { showContextMenu } from './contextMenu'
import { matchProject, searchTokens, type ProjectMatch } from './fuzzy'
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
  /** 搜索框按 Esc 且搜索词已为空：把焦点还给终端 */
  onSearchDone(): void
  /** 拖动过程中 done=false，松开鼠标时 done=true（此时再持久化） */
  onWidthChange(width: number, done: boolean): void
}

/** 左侧项目列表：添加、搜索、选中、行内重命名、右键菜单、宽度拖拽。 */
export class Sidebar {
  private projects: Project[] = []
  private selectedId: string | null = null
  private readonly running = new Set<string>()
  private readonly agents = new Map<string, AgentState>()
  private readonly list: HTMLUListElement
  private readonly search: SearchBar
  private tokens: string[] = []
  /** 当前显示的项目（搜索时为过滤、排序后的结果） */
  private visibleIds: string[] = []
  /** 搜索框中 ↑↓ 选到的项目，Enter 打开它 */
  private activeId: string | null = null
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
    title.title = '关于 AgentManager'
    title.append(shapeSvg('cookie9', 'app-logo'), document.createTextNode('AgentManager'))
    title.addEventListener('click', () => cb.onOpenAbout())
    const addButton = document.createElement('button')
    addButton.type = 'button'
    addButton.className = 'fab add-project'
    addButton.append(icon('add'), document.createTextNode('添加项目'))
    addButton.addEventListener('click', () => cb.onAdd())
    header.append(title, addButton)

    this.search = this.buildSearch()

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

    root.append(header, this.search.box, label, this.list, footer)
    this.setupResizer()
  }

  setProjects(projects: Project[]): void {
    this.projects = projects
    // 没有项目时不显示搜索框，也不保留看不见的搜索词
    this.search.box.hidden = projects.length === 0
    if (projects.length === 0) this.clearQuery()
    this.render()
  }

  /** Ctrl+Shift+F：聚焦搜索框并全选 */
  focusSearch(): void {
    if (this.search.box.hidden) return
    this.search.input.focus()
    this.search.input.select()
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

  /** 状态只用名称前的图形表示，第二行固定显示路径；状态文字放在悬浮提示里 */
  private applyAgentState(li: HTMLLIElement, project: Project): void {
    const state = this.agents.get(project.id) ?? null
    const status = state?.status ?? 'none'
    for (const s of ALL_STATUSES) li.classList.toggle(`agent-${s}`, s === status)
    li.querySelector('.status-slot')?.replaceChildren(statusIndicator(status))
    li.title = state ? `${project.path}\n${statusText(state)}` : project.path
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
    const entries = this.visibleEntries()
    this.visibleIds = entries.map((e) => e.project.id)
    // 有搜索词时默认选中第一个结果（Enter 直接打开它）
    if (this.tokens.length === 0) this.activeId = null
    else if (!this.activeId || !this.visibleIds.includes(this.activeId)) this.activeId = this.visibleIds[0] ?? null

    const fragment = document.createDocumentFragment()
    for (const { project, match } of entries) {
      const li = document.createElement('li')
      li.className = 'project-item'
      li.dataset.id = project.id
      li.tabIndex = 0
      li.title = project.path
      li.classList.toggle('selected', project.id === this.selectedId)
      li.classList.toggle('running', this.running.has(project.id))
      li.classList.toggle('search-active', project.id === this.activeId)

      const slot = document.createElement('span')
      slot.className = 'status-slot'
      const text = document.createElement('div')
      text.className = 'project-text'
      const name = document.createElement('div')
      name.className = 'project-name'
      appendHighlighted(name, project.name, match?.nameHits)
      const pathEl = document.createElement('div')
      pathEl.className = 'project-path'
      appendHighlighted(pathEl, shortenPath(project.path), match?.pathHits)
      text.append(name, pathEl)
      li.append(slot, text)
      this.applyAgentState(li, project)
      fragment.appendChild(li)
    }
    if (entries.length === 0 && this.tokens.length > 0) {
      const empty = document.createElement('li')
      empty.className = 'list-empty'
      empty.append(icon('searchOff'), document.createTextNode('没有匹配的项目'))
      fragment.appendChild(empty)
    }
    this.list.replaceChildren(fragment)
  }

  /** 没有搜索词时按原顺序；有搜索词时只保留匹配的项目，按得分从高到低，同分保持原顺序 */
  private visibleEntries(): { project: Project; match: ProjectMatch | null }[] {
    if (this.tokens.length === 0) return this.projects.map((project) => ({ project, match: null }))
    const matched: { project: Project; match: ProjectMatch; index: number }[] = []
    this.projects.forEach((project, index) => {
      // 只匹配侧栏上显示出来的路径（盘符 + 最后两级），缩写成 … 的部分看不见，不参与匹配
      const match = matchProject(this.tokens, project.name, shortenPath(project.path))
      if (match) matched.push({ project, match, index })
    })
    matched.sort((a, b) => b.match.score - a.match.score || a.index - b.index)
    return matched
  }

  private buildSearch(): SearchBar {
    const box = document.createElement('div')
    box.className = 'search-bar'
    box.hidden = true
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'search-input'
    input.placeholder = '搜索项目'
    input.spellcheck = false
    input.setAttribute('role', 'searchbox')
    input.setAttribute('aria-label', '搜索项目')
    input.title = '模糊搜索项目名称与路径（Ctrl+Shift+F）'
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'icon-btn search-clear'
    clear.title = '清除搜索（Esc）'
    clear.hidden = true
    clear.append(icon('close'))
    box.append(icon('search', 'search-icon'), input, clear)

    // 输入法组字过程中（拼音还没上屏）不过滤，上屏后由 compositionend 触发
    input.addEventListener('input', (e) => {
      if (!(e as InputEvent).isComposing) this.setQuery(input.value)
    })
    input.addEventListener('compositionend', () => this.setQuery(input.value))
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        this.moveActive(e.key === 'ArrowDown' ? 1 : -1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (this.activeId) this.cb.onSelect(this.activeId)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (input.value) {
          this.clearQuery()
        } else {
          input.blur()
          this.cb.onSearchDone()
        }
      }
    })
    // 键盘选中项的高亮只在搜索框有焦点时显示
    input.addEventListener('focus', () => this.root.classList.add('search-focused'))
    input.addEventListener('blur', () => this.root.classList.remove('search-focused'))
    clear.addEventListener('click', () => {
      this.clearQuery()
      input.focus()
    })
    return { box, input, clear }
  }

  private clearQuery(): void {
    this.search.input.value = ''
    this.setQuery('')
  }

  private setQuery(value: string): void {
    this.search.clear.hidden = value === ''
    const tokens = searchTokens(value)
    if (tokens.join(' ') === this.tokens.join(' ')) return
    this.tokens = tokens
    this.activeId = null
    this.render()
    this.list.scrollTop = 0
  }

  /** 搜索框中 ↑↓：在当前显示的项目之间移动 */
  private moveActive(delta: number): void {
    if (this.visibleIds.length === 0) return
    const index = this.activeId ? this.visibleIds.indexOf(this.activeId) : -1
    const next = index < 0 ? (delta > 0 ? 0 : this.visibleIds.length - 1) : index + delta
    const id = this.visibleIds[Math.max(0, Math.min(this.visibleIds.length - 1, next))]
    this.activeId = id
    for (const li of this.items()) li.classList.toggle('search-active', li.dataset.id === id)
    this.itemById(id)?.scrollIntoView({ block: 'nearest' })
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

interface SearchBar {
  box: HTMLElement
  input: HTMLInputElement
  clear: HTMLButtonElement
}

/** 把命中的字符包进 <mark>（连续命中合并为一段），其余为普通文本 */
function appendHighlighted(el: HTMLElement, text: string, hits: ReadonlySet<number> | undefined): void {
  if (!hits || hits.size === 0) {
    el.textContent = text
    return
  }
  let run = ''
  let runIsHit = false
  const flush = (): void => {
    if (!run) return
    if (runIsHit) {
      const mark = document.createElement('mark')
      mark.textContent = run
      el.append(mark)
    } else {
      el.append(run)
    }
    run = ''
  }
  Array.from(text).forEach((ch, i) => {
    const hit = hits.has(i)
    if (hit !== runIsHit) {
      flush()
      runIsHit = hit
    }
    run += ch
  })
  flush()
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
