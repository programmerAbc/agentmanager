import './styles.css'
import type { AppSettings, Project } from '../shared/types'
import { Sidebar } from './sidebar'
import { toast } from './toast'

const api = window.api

/** 渲染进程的总控：持有项目列表和当前选中项，协调侧栏与右侧区域。 */
class App {
  private projects: Project[]
  private selectedId: string | null = null
  private readonly sidebar: Sidebar
  private readonly emptyState: HTMLElement
  private readonly projectPanel: HTMLElement

  constructor(settings: AppSettings, projects: Project[]) {
    this.projects = projects

    const sidebarEl = mustGet('sidebar')
    const resizer = mustGet('resizer')
    const host = mustGet('terminal-host')

    this.emptyState = document.createElement('div')
    this.emptyState.className = 'center-panel'
    this.projectPanel = document.createElement('div')
    this.projectPanel.className = 'center-panel'
    host.append(this.emptyState, this.projectPanel)

    this.sidebar = new Sidebar(sidebarEl, resizer, {
      onAdd: () => void this.addProject(),
      onSelect: (id) => this.select(id),
      onRename: (id, name) => void this.renameProject(id, name),
      onRemove: (id) => void this.removeProject(id),
      onOpenInExplorer: (id) => void this.openInExplorer(id),
      onRestartTerminal: () => undefined,
      onWidthChange: (width, done) => {
        if (done) void this.saveSettings({ sidebarWidth: width })
      }
    })
    this.sidebar.setWidth(settings.sidebarWidth)
    this.sidebar.setProjects(this.projects)

    const last = settings.lastProjectId
    if (last && this.projects.some((p) => p.id === last)) this.select(last)
    else this.render()
  }

  select(id: string | null): void {
    if (id !== null && !this.projects.some((p) => p.id === id)) id = null
    const changed = this.selectedId !== id
    this.selectedId = id
    this.sidebar.setSelected(id)
    this.render()
    if (changed) {
      void this.saveSettings({ lastProjectId: id })
      if (id) void api.projects.touch(id)
    }
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
    this.select(project.id)
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
    this.projects = this.projects.filter((p) => p.id !== id)
    this.sidebar.setProjects(this.projects)
    if (this.selectedId === id) this.select(null)
    else this.render()
  }

  private async openInExplorer(id: string): Promise<void> {
    const result = await api.projects.openInExplorer(id)
    if (!result.ok) toast(result.error)
  }

  private async saveSettings(patch: Parameters<typeof api.settings.update>[0]): Promise<void> {
    const result = await api.settings.update(patch)
    if (!result.ok) toast(result.error)
  }

  private render(): void {
    const project = this.projects.find((p) => p.id === this.selectedId) ?? null
    document.title = project ? `Agent Desk — ${project.name}` : 'Agent Desk'

    this.emptyState.hidden = project !== null
    this.projectPanel.hidden = project === null
    if (project) {
      renderPanel(this.projectPanel, project.name, project.path)
    } else if (this.projects.length === 0) {
      renderPanel(this.emptyState, '还没有项目', null, '添加一个本地目录作为项目，然后在终端里运行 claude 等命令。', {
        label: '＋ 添加项目',
        action: () => void this.addProject()
      })
    } else {
      renderPanel(this.emptyState, '选择一个项目', null, '从左侧列表中选择一个项目以打开它的终端。')
    }
  }
}

function renderPanel(
  panel: HTMLElement,
  title: string,
  path: string | null,
  hint?: string,
  button?: { label: string; action: () => void }
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
    btn.addEventListener('click', button.action)
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
  new App(settings, projects)
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  toast(`启动失败：${err instanceof Error ? err.message : String(err)}`)
})
