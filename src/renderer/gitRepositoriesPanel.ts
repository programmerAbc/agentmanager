import type { GitSnapshot, RepositoryBranch } from '../shared/types'
import { iconButton } from './dialog'
import { icon } from './icons'
import { toast } from './toast'

const api = window.api
const ROW_HEIGHT = 128

/** 当前项目 Git 订阅及独立右栏，不向终端输入任何命令。 */
export class GitRepositoriesPanel {
  private readonly root = document.createElement('aside')
  private readonly scrim = document.createElement('div')
  private readonly count = document.createElement('span')
  private readonly status = document.createElement('div')
  private readonly dirtySummary = document.createElement('span')
  private readonly summary = document.createElement('span')
  private readonly checked = document.createElement('span')
  private readonly filter = document.createElement('input')
  private readonly list = document.createElement('div')
  private readonly refreshButton: HTMLButtonElement
  private readonly media = window.matchMedia('(max-width: 1100px)')
  private readonly toggleButton: HTMLButtonElement
  private readonly savePreference: (expanded: boolean) => void
  private expanded: boolean
  private preference: boolean | null
  private projectId: string | null = null
  private snapshot: GitSnapshot | null = null
  private early: GitSnapshot | null = null
  private token: string | null = null
  private generation = 0
  private signature = ''
  private loading = false
  private error = ''
  private readonly highlighted = new Map<string, number>()
  private filtered: RepositoryBranch[] = []
  private virtualStart = -1

  constructor(host: HTMLElement, toggle: HTMLButtonElement, preference: boolean | null, save: (expanded: boolean) => void) {
    this.toggleButton = toggle
    this.savePreference = save
    this.preference = preference
    this.expanded = !this.media.matches && (preference ?? true)
    this.root.id = 'git-panel'
    this.root.className = 'git-panel'
    this.root.setAttribute('aria-label', 'Git 仓库')
    const head = document.createElement('div')
    head.className = 'git-panel-head'
    const heading = document.createElement('div')
    heading.className = 'git-panel-heading'
    const title = document.createElement('h2')
    title.textContent = 'Git 仓库'
    this.count.className = 'git-count'
    this.refreshButton = iconButton('refresh', '重新扫描仓库', () => this.refresh())
    heading.append(icon('accountTree'), title, this.count, this.refreshButton,
      iconButton('close', '收起仓库面板', () => this.setExpanded(false, true)))
    const scope = document.createElement('div')
    scope.className = 'git-scope'
    scope.textContent = '当前项目目录 · 仅第一层子目录'
    const statusRow = document.createElement('div')
    statusRow.className = 'git-status-row'
    this.status.className = 'git-status'
    this.status.setAttribute('role', 'status')
    this.dirtySummary.className = 'git-dirty-summary'
    statusRow.append(this.status, this.dirtySummary)
    const search = document.createElement('label')
    search.className = 'git-search'
    this.filter.placeholder = '搜索仓库或分支'
    this.filter.setAttribute('aria-label', '搜索仓库或分支')
    this.filter.addEventListener('input', () => { this.list.scrollTop = 0; this.renderList() })
    search.append(icon('search'), this.filter)
    head.append(heading, scope, statusRow, search)
    this.list.className = 'git-list'
    this.list.tabIndex = 0
    this.list.setAttribute('role', 'list')
    this.list.setAttribute('aria-label', '仓库与分支，可搜索或滚动查看')
    this.list.addEventListener('scroll', () => {
      if (this.filtered.length > 200) this.renderRows()
    })
    const footer = document.createElement('footer')
    footer.className = 'git-footer'
    footer.append(this.summary, this.checked)
    this.root.append(head, this.list, footer)
    this.scrim.className = 'git-scrim'
    this.scrim.addEventListener('click', () => this.setExpanded(false, true))
    host.append(this.scrim, this.root)
    toggle.setAttribute('aria-controls', this.root.id)
    toggle.addEventListener('click', () => this.setExpanded(!this.expanded, true))
    this.media.addEventListener('change', () => {
      this.expanded = !this.media.matches && (this.preference ?? true)
      this.updateVisibility()
    })
    api.git.onChanged(snapshot => {
      if (snapshot.projectId !== this.projectId) return
      if (snapshot.subscriptionId === this.token) this.accept(snapshot)
      else if (!this.token && this.loading) this.early = snapshot
    })
    document.addEventListener('visibilitychange', () => this.updateSubscription())
    window.addEventListener('focus', () => this.refresh())
    window.addEventListener('beforeunload', () => this.stop())
    document.addEventListener('keydown', e => this.handleKey(e))
    this.updateVisibility()
  }

  setProject(id: string | null): void {
    if (id === this.projectId) return
    this.stop()
    this.projectId = id
    this.snapshot = null
    this.signature = ''
    this.error = ''
    this.filter.value = ''
    this.highlighted.clear()
    this.list.scrollTop = 0
    this.render()
    this.updateVisibility()
  }

  private stop(): void {
    this.generation++
    const token = this.token
    this.token = null
    this.early = null
    this.loading = false
    if (token) void api.git.unsubscribe(token).catch(() => undefined)
  }

  private updateSubscription(): void {
    if (!this.expanded || !this.projectId || document.hidden) {
      this.stop()
      return
    }
    if (this.token || this.loading) return
    const generation = ++this.generation
    const id = this.projectId
    this.loading = true
    this.error = ''
    this.render()
    void api.git.subscribe(id).then(result => {
      if (generation !== this.generation) {
        if (result.ok) void api.git.unsubscribe(result.data.subscriptionId).catch(() => undefined)
        return
      }
      this.loading = false
      if (!result.ok) { this.error = result.error; this.render(); return }
      this.token = result.data.subscriptionId
      // 新订阅 revision 从 0 开始，不与旧缓存的 revision 比较。
      const early = this.early
      this.early = null
      this.snapshot = null
      this.accept(result.data)
      if (early?.subscriptionId === this.token) this.accept(early)
    }).catch(err => {
      if (generation !== this.generation) return
      this.loading = false
      this.error = err instanceof Error ? err.message : String(err)
      this.render()
    })
  }

  private setExpanded(value: boolean, persist: boolean): void {
    this.expanded = value
    if (persist) { this.preference = value; this.savePreference(value) }
    this.updateVisibility()
    if (!value) this.toggleButton.focus()
    else if (this.media.matches) this.filter.focus()
  }

  private updateVisibility(): void {
    const visible = this.expanded && this.projectId !== null
    const modal = visible && this.media.matches
    this.root.hidden = !visible
    this.scrim.hidden = !modal
    this.toggleButton.hidden = !this.projectId
    this.toggleButton.setAttribute('aria-expanded', String(visible))
    for (const el of document.querySelectorAll<HTMLElement>('#sidebar,#resizer,#topbar,#terminal-host')) el.inert = modal
    if (modal) {
      this.root.setAttribute('role', 'dialog')
      this.root.setAttribute('aria-modal', 'true')
      if (!this.root.contains(document.activeElement)) this.filter.focus()
    } else {
      this.root.removeAttribute('role')
      this.root.removeAttribute('aria-modal')
    }
    this.updateSubscription()
  }

  private refresh(): void {
    if (!this.expanded || document.hidden || !this.projectId) return
    if (!this.token) { this.updateSubscription(); return }
    void api.git.refresh(this.token).then(result => {
      if (!result.ok) { this.error = result.error; this.render() }
    }).catch(() => { this.error = '无法刷新仓库，请收起后重新展开'; this.render() })
  }

  private accept(snapshot: GitSnapshot): void {
    if (snapshot.revision <= (this.snapshot?.revision ?? -1)) return
    const previous = new Map(this.snapshot?.repositories.map(r => [r.id, r]) ?? [])
    for (const row of snapshot.repositories) {
      const old = previous.get(row.id)
      if (old && row.state !== 'error' && (old.branch !== row.branch || old.shortOid !== row.shortOid)) {
        this.highlighted.set(row.id, Date.now() + 2600)
      }
    }
    this.snapshot = snapshot
    this.error = ''
    this.render()
  }

  private render(): void {
    const s = this.snapshot
    const rows = s?.repositories ?? []
    const failed = rows.filter(r => r.state === 'error').length
    this.count.textContent = String(rows.length)
    this.toggleButton.replaceChildren(icon('accountTree'), document.createTextNode(`仓库 ${s?.scanState === 'scanning' ? '…' : rows.length}`))
    const text = this.error || (this.loading ? '正在连接仓库监控…' : !s ? '正在扫描…'
      : s.scanState === 'missing-git' ? '未检测到 Git，安装后刷新'
      : s.scanState === 'scanning' ? `正在扫描 · 已检查 ${s.scannedDirectories} 个目录`
      : s.scanState === 'error' ? '扫描失败，可点击刷新重试'
      : s.scanState === 'partial' ? `扫描不完整 · ${s.skippedPaths.length} 个目录不可读`
      : failed ? `${failed} 个仓库读取失败`
      : s.monitorState === 'polling' ? '定期校验中 · 部分监听不可用'
      : rows.length ? '自动更新中' : '扫描完成')
    this.status.textContent = text
    this.status.title = this.error || s?.error || s?.skippedPaths.join('\n') || text
    this.status.classList.toggle('git-warning', Boolean(this.error || failed || s?.scanState === 'partial' || s?.scanState === 'error' || s?.scanState === 'missing-git'))
    this.renderDirtySummary(s, rows)
    this.refreshButton.disabled = this.loading || s?.scanState === 'scanning'
    this.checked.textContent = s?.checkedAt ? `${new Date(s.checkedAt).toLocaleTimeString()} 校验` : '等待校验'
    // 不因 5 秒时间戳变动重建列表，保留焦点、选中与滚动位置。
    const signature = JSON.stringify([rows.map(({ lastSuccessAt: _time, ...r }) => r), Boolean(this.error), s?.scanState])
    if (signature !== this.signature) { this.signature = signature; this.renderList() }
  }

  private renderList(): void {
    const q = this.filter.value.trim().toLocaleLowerCase()
    const rows = this.snapshot?.repositories ?? []
    this.filtered = rows.filter(r => `${r.relativePath} ${r.branch ?? ''} ${r.shortOid ?? ''}`.toLocaleLowerCase().includes(q))
    this.summary.textContent = q ? `${this.filtered.length} / ${rows.length} 个仓库` : `${rows.length} 个仓库`
    this.virtualStart = -1
    this.renderRows()
  }

  private renderRows(): void {
    const virtual = this.filtered.length > 200
    const start = virtual ? Math.max(0, Math.floor(this.list.scrollTop / ROW_HEIGHT) - 4) : 0
    if (virtual && start === this.virtualStart) return
    this.virtualStart = start
    const end = virtual ? Math.min(this.filtered.length, start + Math.ceil((this.list.clientHeight || 600) / ROW_HEIGHT) + 9) : this.filtered.length
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.repoId : undefined
    const content = document.createDocumentFragment()
    const spacer = (height: number): void => { const el = document.createElement('div'); el.style.height = `${height}px`; el.setAttribute('aria-hidden', 'true'); content.append(el) }
    if (start) spacer(start * ROW_HEIGHT)
    for (let i = start; i < end; i++) content.append(this.row(this.filtered[i], i, this.filtered.length))
    if (end < this.filtered.length) spacer((this.filtered.length - end) * ROW_HEIGHT)
    if (!this.filtered.length) {
      const empty = document.createElement('div')
      empty.className = 'git-empty'
      empty.append(icon('folderOpen'))
      const title = document.createElement('strong')
      title.textContent = this.filter.value ? '没有匹配的仓库' : this.error ? '无法读取仓库'
        : this.snapshot?.scanState === 'missing-git' ? '需要安装 Git'
        : this.snapshot?.scanState === 'error' ? '项目目录无法读取'
        : !this.snapshot || this.snapshot.scanState === 'scanning' ? '正在发现仓库' : '未发现 Git 仓库'
      const desc = document.createElement('p')
      desc.textContent = this.filter.value ? '试试其他目录名或分支名。' : '新建或克隆仓库后自动发现，也可点击刷新。'
      empty.append(title, desc)
      content.append(empty)
    }
    this.list.replaceChildren(content)
    if (focused) [...this.list.querySelectorAll<HTMLButtonElement>('[data-repo-id]')].find(b => b.dataset.repoId === focused)?.focus({ preventScroll: true })
  }

  private row(r: RepositoryBranch, index: number, total: number): HTMLElement {
    const row = document.createElement('div')
    row.className = 'git-repo'
    row.setAttribute('role', 'listitem')
    row.setAttribute('aria-posinset', String(index + 1))
    row.setAttribute('aria-setsize', String(total))
    if ((this.highlighted.get(r.id) ?? 0) > Date.now()) {
      row.classList.add('git-updated')
      window.setTimeout(() => { row.classList.remove('git-updated'); row.querySelector('.git-update-label')?.remove() }, 2600)
    }
    const heading = document.createElement('div')
    heading.className = 'git-repo-title'
    const name = document.createElement('strong')
    name.textContent = r.relativePath === '.' ? '项目根目录' : r.relativePath.split('/').at(-1) ?? r.relativePath
    name.title = name.textContent
    heading.append(icon('folderOpen'), name)
    if (row.classList.contains('git-updated')) { const label = document.createElement('span'); label.className = 'git-update-label'; label.textContent = '已更新'; heading.append(label) }
    const location = document.createElement('div')
    location.className = 'git-repo-path'
    location.textContent = r.relativePath
    location.title = r.relativePath
    const branchRow = document.createElement('div')
    branchRow.className = 'git-branch-row'
    const branch = document.createElement('button')
    branch.className = 'git-branch'
    branch.dataset.repoId = r.id
    const value = r.branch || r.shortOid
    branch.title = value ? `复制分支或提交：${value}` : '暂未读取到分支'
    branch.disabled = !value
    const text = document.createElement('span')
    text.textContent = value || '读取失败'
    branch.append(icon('accountTree'), text)
    branch.addEventListener('click', () => {
      if (value) void api.clipboard.writeText(value).then(() => toast('已复制', 'info')).catch(() => toast('复制失败'))
    })
    branchRow.append(branch, this.worktreeBadge(r))
    const note = document.createElement('div')
    note.className = 'git-repo-note'
    note.textContent = r.state === 'unborn' ? '尚无提交' : r.state === 'detached' ? '分离 HEAD' : ''
    if (r.state === 'error') {
      note.classList.add('git-warning')
      note.textContent = value ? '读取失败 · 上次读取的分支' : '读取失败'
      note.title = r.error ?? ''
      const retry = document.createElement('button')
      retry.textContent = '重试'
      retry.addEventListener('click', () => this.refresh())
      note.append(retry)
    }
    row.append(heading, location, branchRow, note)
    return row
  }

  private renderDirtySummary(s: GitSnapshot | null, rows: RepositoryBranch[]): void {
    this.dirtySummary.classList.remove('is-dirty', 'is-clean')
    if (this.error || !s || !rows.length || s.scanState === 'scanning' || s.scanState === 'missing-git' || s.scanState === 'error') {
      this.dirtySummary.textContent = ''
      return
    }
    const dirtyRepos = rows.filter(r => (r.dirtyCount ?? 0) > 0).length
    const unknownRepos = rows.filter(r => r.dirtyCount === null).length
    if (dirtyRepos > 0) {
      this.dirtySummary.textContent = `${dirtyRepos} 个未提交`
      this.dirtySummary.classList.add('is-dirty')
    } else if (unknownRepos === 0) {
      this.dirtySummary.textContent = '全部已提交'
      this.dirtySummary.classList.add('is-clean')
    } else {
      this.dirtySummary.textContent = ''
    }
  }

  private worktreeTooltip(r: RepositoryBranch): string {
    if (r.dirtyCount === null) return '工作区状态未知，未能读取未提交文件数'
    if (r.dirtyCount === 0) return '工作区干净，已全部提交'
    const parts: string[] = []
    if (r.stagedCount) parts.push(`${r.stagedCount} 已暂存`)
    if (r.modifiedCount) parts.push(`${r.modifiedCount} 已修改`)
    if (r.untrackedCount) parts.push(`${r.untrackedCount} 未跟踪`)
    const detail = parts.length ? `（${parts.join(' · ')}）` : ''
    return `${r.dirtyCount} 个未提交文件${detail}`
  }

  private worktreeBadge(r: RepositoryBranch): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'git-worktree-badge'
    badge.title = this.worktreeTooltip(r)
    if (r.dirtyCount === null) {
      badge.classList.add('is-unknown')
      badge.textContent = '—'
      badge.setAttribute('aria-label', '工作区状态未知')
      return badge
    }
    if (r.dirtyCount > 0) {
      badge.classList.add('is-dirty')
      const dot = document.createElement('span')
      dot.className = 'badge-dot'
      dot.setAttribute('aria-hidden', 'true')
      const count = document.createElement('span')
      count.textContent = r.dirtyCount > 999 ? '999+' : String(r.dirtyCount)
      badge.append(dot, count)
      badge.setAttribute('aria-label', `${r.dirtyCount} 个未提交文件`)
      return badge
    }
    badge.classList.add('is-clean')
    badge.append(icon('check'))
    badge.setAttribute('aria-label', '工作区干净，已全部提交')
    return badge
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.expanded || !this.projectId || document.querySelector('.dialog-scrim')) return
    // 终端里的 Escape 属于 CLI；只有浮层或面板内的焦点才关闭面板。
    if (e.key === 'Escape' && (this.media.matches || this.root.contains(document.activeElement))) {
      e.preventDefault(); this.setExpanded(false, true); return
    }
    if (e.key !== 'Tab' || !this.media.matches) return
    const controls = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled),input,[tabindex="0"]')]
    const first = controls[0], last = controls.at(-1)
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }
}
