import { AGENT_LABEL, type AgentDashboard, type AgentLimit, type Project } from '../shared/types'
import { iconButton } from './dialog'
import { icon } from './icons'

interface Metric { button: HTMLButtonElement; label: HTMLElement; value: HTMLElement; canvas: HTMLCanvasElement; percent: number | null }

/** Project信息与真实Agent数据独立渲染；无来源时显示空值，不猜测。 */
export class Dashboard {
  readonly toggleButton: HTMLButtonElement
  private readonly fields = new Map<string, HTMLElement>()
  private readonly metrics: Metric[] = []
  private data: AgentDashboard | null = null
  private project: Project | null = null
  private collapsed: boolean
  private drawerOpen = false

  constructor(private readonly root: HTMLElement, collapsed: boolean, private readonly onCollapsed: (collapsed: boolean) => void) {
    this.collapsed = collapsed
    const heading = document.createElement('div')
    heading.className = 'dashboard-heading'
    const title = document.createElement('div')
    title.innerHTML = '<h2>AI 仪表板</h2><p>当前 Agent 会话</p>'
    const close = iconButton('close', '收起 AI 仪表板', () => this.closeDrawer())
    close.classList.add('dashboard-close')
    heading.append(title, close)
    this.toggleButton = iconButton('dockToRight', '收起仪表板', () => this.toggle())
    this.toggleButton.classList.add('dashboard-toggle')
    this.toggleButton.setAttribute('aria-controls', root.id)
    const toggleLabel = document.createElement('span')
    toggleLabel.className = 'dashboard-toggle-label'
    this.toggleButton.append(toggleLabel)

    const session = document.createElement('section')
    session.className = 'dashboard-card dashboard-session'
    const top = document.createElement('div')
    top.className = 'dashboard-agent-row'
    const model = document.createElement('div')
    model.append(this.field('model', 'dashboard-model'), this.field('modelMeta', 'dashboard-muted dashboard-model-meta'))
    const permission = document.createElement('button')
    permission.className = 'dashboard-permission'
    permission.type = 'button'
    permission.append(icon('verifiedUser'), this.field('permission'))
    permission.addEventListener('click', () => this.details(permission, 'session'))
    top.append(model, permission)
    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'dashboard-session-name'
    name.append(this.label('会话'), this.field('title'))
    name.addEventListener('click', () => this.details(name, 'session'))
    const directory = document.createElement('button')
    directory.type = 'button'
    directory.className = 'dashboard-directory'
    directory.append(this.label('当前目录'), this.field('cwd', 'dashboard-path'))
    const branch = this.field('git', 'dashboard-git')
    directory.append(branch)
    directory.addEventListener('click', () => this.details(directory, 'session'))
    session.append(top, name, directory, this.field('freshness', 'dashboard-freshness'))

    const usage = document.createElement('section')
    usage.className = 'dashboard-card dashboard-usage'
    for (const labelText of ['上下文剩余', '5 小时剩余', '每周剩余']) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dashboard-metric'
      const heading = document.createElement('div')
      heading.className = 'dashboard-metric-heading'
      const label = this.label(labelText), value = document.createElement('strong'), canvas = document.createElement('canvas')
      heading.append(label, value)
      canvas.className = 'dashboard-wave'
      canvas.setAttribute('role', 'progressbar')
      canvas.setAttribute('aria-valuemin', '0')
      canvas.setAttribute('aria-valuemax', '100')
      button.append(heading, canvas)
      const metric = { button, label, value, canvas, percent: null }
      this.metrics.push(metric)
      button.addEventListener('click', () => this.details(button, labelText === '上下文剩余' ? 'context' : 'limits'))
      usage.append(button)
    }
    const project = document.createElement('section')
    project.className = 'dashboard-card dashboard-project'
    project.append(this.label('项目工作区'), this.field('projectName'), this.field('workspace', 'dashboard-path'))
    root.replaceChildren(heading, session, usage, project)
    new ResizeObserver(() => this.draw()).observe(usage)
    window.addEventListener('resize', () => this.layout())
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.drawerOpen && this.root.contains(document.activeElement) && !document.querySelector('dialog[open],.dialog-scrim')) {
        e.preventDefault()
        this.closeDrawer()
      }
    })
    this.layout()
    this.render(null, null)
  }

  private label(text: string): HTMLElement {
    const el = document.createElement('span')
    el.className = 'dashboard-muted'
    el.textContent = text
    return el
  }
  private field(key: string, className = ''): HTMLElement {
    const el = document.createElement('span')
    el.className = className
    this.fields.set(key, el)
    return el
  }
  private put(key: string, value: string): void { this.fields.get(key)!.textContent = value }

  render(project: Project | null, value: AgentDashboard | null): void {
    this.project = project
    this.data = value
    this.put('projectName', project?.name ?? '未选择项目')
    this.put('workspace', project?.path ?? '选择左侧项目查看工作区')
    this.put('model', value?.model ?? (value ? AGENT_LABEL[value.agent] : '尚未启动助手'))
    this.put('modelMeta', value ? [value.effort, value.fast === true ? 'Fast' : null, AGENT_LABEL[value.agent]].filter(Boolean).join(' · ') : '通过项目菜单启动 Claude / Codex')
    this.put('permission', value?.permission ?? '权限未就绪')
    this.fields.get('permission')!.parentElement!.title = value?.permissionDetail ?? '等待会话上报权限'
    this.put('title', value?.title ?? (value?.sessionId ? '未命名会话' : '等待会话数据'))
    this.put('cwd', value?.cwd ?? '当前目录未就绪')
    this.fields.get('cwd')!.title = value?.cwd ?? ''
    const git = this.fields.get('git')!
    git.hidden = !value?.git
    if (value?.git) {
      const label = document.createElement('span')
      label.textContent = value.git.detached ? `Detached · ${value.git.branch}` : value.git.branch
      git.replaceChildren(icon('accountTree'), label)
      git.title = `Git 工作树：${value.git.root}`
    } else { git.replaceChildren(); git.title = '' }
    this.metrics[0].label.textContent = '上下文剩余'
    this.metrics[0].percent = value?.context?.remainingPercent ?? null
    for (const [i, limit] of [value?.limits.primary, value?.limits.secondary].entries()) {
      this.metrics[i + 1].label.textContent = limitLabel(limit, i === 0 ? '5 小时剩余' : '每周剩余')
      this.metrics[i + 1].percent = limit ? 100 - limit.usedPercent : null
    }
    for (const metric of this.metrics) {
      metric.value.textContent = metric.percent === null ? '—' : `${Math.round(metric.percent)}%`
      metric.canvas.setAttribute('aria-label', metric.label.textContent!)
      metric.canvas.setAttribute('aria-valuetext', metric.percent === null ? '数据未就绪' : `${Math.round(metric.percent)}% 剩余`)
      if (metric.percent === null) metric.canvas.removeAttribute('aria-valuenow')
      else metric.canvas.setAttribute('aria-valuenow', String(metric.percent))
      metric.button.classList.toggle('low', metric.percent !== null && metric.percent <= 10)
    }
    this.put('freshness', value?.usageUpdatedAt ? `用量更新于 ${new Date(value.usageUpdatedAt).toLocaleTimeString()}` : '等待用量数据')
    this.draw()
  }

  refreshTheme(): void { this.draw() }
  private toggle(): void {
    if (window.innerWidth <= 1000) this.drawerOpen = !this.drawerOpen
    else { this.collapsed = !this.collapsed; this.onCollapsed(this.collapsed) }
    this.layout()
  }
  private closeDrawer(): void {
    if (window.innerWidth <= 1000) this.drawerOpen = false
    else { this.collapsed = true; this.onCollapsed(true) }
    this.layout()
    this.toggleButton.focus()
  }
  private layout(): void {
    const compact = window.innerWidth <= 1000
    const visible = compact ? this.drawerOpen : !this.collapsed
    this.root.hidden = !visible
    this.root.classList.toggle('dashboard-overlay', compact)
    this.toggleButton.setAttribute('aria-expanded', String(visible))
    this.toggleButton.title = visible ? '收起仪表板' : '打开 AI 仪表板'
    this.toggleButton.setAttribute('aria-label', this.toggleButton.title)
    this.toggleButton.querySelector('span.dashboard-toggle-label')!.textContent = visible ? '收起仪表板' : 'AI 仪表板'
    requestAnimationFrame(() => this.draw())
  }

  private draw(): void {
    const style = getComputedStyle(document.documentElement)
    const ink = style.getPropertyValue('--md-sys-color-primary').trim(), track = style.getPropertyValue('--md-sys-color-outline-variant').trim()
    for (const metric of this.metrics) {
      const canvas = metric.canvas, w = canvas.clientWidth, h = 16, ratio = window.devicePixelRatio || 1
      if (!w) continue
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.scale(ratio, ratio); ctx.lineWidth = 3; ctx.lineCap = 'round'
      const length = (w - 4) * Math.min(100, Math.max(0, metric.percent ?? 0)) / 100
      ctx.strokeStyle = track; ctx.beginPath(); ctx.moveTo(Math.min(w - 2, length + 7), 8); ctx.lineTo(w - 2, 8); ctx.stroke()
      if (metric.percent !== null && metric.percent > 0) {
        ctx.strokeStyle = metric.percent <= 10 ? style.getPropertyValue('--md-sys-color-error').trim() : ink
        ctx.beginPath()
        for (let x = 2; x <= length + 2; x += .5) {
          const y = 8 + Math.min(2.5, length / 12) * Math.sin((x - 2) * Math.PI / 12)
          if (x === 2) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }
  }

  private details(trigger: HTMLButtonElement, kind: 'session' | 'context' | 'limits'): void {
    const d = this.data, dialog = document.createElement('dialog')
    dialog.className = 'dashboard-details'
    const heading = document.createElement('div')
    heading.className = 'dashboard-detail-heading'
    const title = document.createElement('h2')
    title.textContent = kind === 'session' ? 'Agent 会话' : kind === 'context' ? '上下文' : '用量额度'
    const close = iconButton('close', '关闭详情', () => dialog.close())
    heading.append(title, close); dialog.append(heading)
    const unknown = '未就绪'
    const rows: [string, string][] = kind === 'session' ? [
      ['项目', this.project?.name ?? '未选择'], ['项目 workspace', this.project?.path ?? unknown],
      ['会话名称', d?.title ?? (d?.sessionId ? '未命名会话' : unknown)], ['会话 ID', d?.sessionId ?? unknown],
      ['Agent 当前目录', d?.cwd ?? unknown], ['Git 工作树', d?.git?.root ?? '未提供'],
      ['权限', d?.permissionDetail ?? unknown], ['模型', d?.model ?? unknown]
    ] : kind === 'context' ? [
      ['当前上下文 Token', d?.context?.usedTokens?.toLocaleString() ?? unknown],
      ['窗口 Token', d?.context?.windowTokens?.toLocaleString() ?? unknown],
      ['剩余', d?.context ? `${Math.round(d.context.remainingPercent)}%` : unknown]
    ] : [
      ['主额度重置', resetTime(d?.limits.primary)], ['次额度重置', resetTime(d?.limits.secondary)],
      ['会话费用', d?.cost === null || d?.cost === undefined ? '未提供' : `$${d.cost.toFixed(2)}`]
    ]
    rows.push(['数据更新时间', d?.updatedAt ? new Date(d.updatedAt).toLocaleString() : unknown],
      ['用量更新时间', d?.usageUpdatedAt ? new Date(d.usageUpdatedAt).toLocaleString() : unknown])
    for (const [label, value] of rows) {
      const row = document.createElement('div')
      row.className = 'dashboard-detail-row'
      const a = document.createElement('span'), b = document.createElement('strong')
      a.textContent = label; b.textContent = value; row.append(a, b); dialog.append(row)
    }
    dialog.addEventListener('close', () => { dialog.remove(); if (trigger.isConnected) trigger.focus() }, { once: true })
    document.body.append(dialog); dialog.showModal()
  }
}

function resetTime(limit: AgentLimit | null | undefined): string {
  return limit?.resetsAt ? new Date(limit.resetsAt * 1000).toLocaleString() : '未提供'
}
function limitLabel(limit: AgentLimit | null | undefined, fallback: string): string {
  if (!limit) return fallback
  if (limit.windowMinutes === 10080) return '每周剩余'
  return `${limit.windowMinutes % 60 === 0 ? `${limit.windowMinutes / 60} 小时` : `${limit.windowMinutes} 分钟`}剩余`
}
