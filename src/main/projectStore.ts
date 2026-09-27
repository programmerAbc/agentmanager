import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Project, ProjectsFile } from '../shared/types'
import { JsonFileWriter, readJsonFile } from './jsonFile'
import log from './log'

/** projects.json 的读写。内存中的列表是唯一数据源，每次修改后整体落盘。 */
export class ProjectStore {
  private projects: Project[] = []
  private readonly writer: JsonFileWriter

  constructor(private readonly file: string) {
    this.writer = new JsonFileWriter(file)
  }

  async load(): Promise<void> {
    const result = await readJsonFile(this.file, parseProjectsFile)
    if (result.kind === 'ok') {
      this.projects = result.value.projects
      log.info(`[projects] 已加载 ${this.projects.length} 个项目`)
    } else {
      this.projects = []
      if (result.kind === 'corrupt') log.warn(`[projects] projects.json 损坏，以空列表启动`)
    }
  }

  list(): Project[] {
    return this.projects.map((p) => ({ ...p }))
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id)
  }

  /** 添加目录；同一路径已存在时直接返回已有项目。 */
  async add(dir: string): Promise<Project> {
    const absPath = path.resolve(dir)
    const key = pathKey(absPath)
    const existing = this.projects.find((p) => pathKey(p.path) === key)
    if (existing) return { ...existing }

    const project: Project = {
      id: randomUUID(),
      name: path.basename(absPath) || absPath,
      path: absPath,
      createdAt: Date.now()
    }
    this.projects.push(project)
    await this.save()
    log.info(`[projects] 添加 ${project.id} ${project.path}`)
    return { ...project }
  }

  async rename(id: string, name: string): Promise<void> {
    const project = this.require(id)
    const trimmed = name.trim()
    if (!trimmed) throw new Error('项目名不能为空')
    project.name = trimmed
    await this.save()
  }

  async remove(id: string): Promise<void> {
    const index = this.projects.findIndex((p) => p.id === id)
    if (index < 0) return
    const [removed] = this.projects.splice(index, 1)
    await this.save()
    log.info(`[projects] 移除 ${removed.id} ${removed.path}`)
  }

  async touch(id: string): Promise<void> {
    this.require(id).lastOpenedAt = Date.now()
    await this.save()
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private require(id: string): Project {
    const project = this.get(id)
    if (!project) throw new Error('项目不存在')
    return project
  }

  private save(): Promise<void> {
    const data: ProjectsFile = { version: 1, projects: this.projects }
    return this.writer.write(data)
  }
}

/** Windows 路径不区分大小写，并忽略末尾的分隔符 */
function pathKey(p: string): string {
  const resolved = path.resolve(p)
  const trimmed = resolved.length > 3 ? resolved.replace(/[\\/]+$/, '') : resolved
  return trimmed.toLowerCase()
}

function parseProjectsFile(raw: unknown): ProjectsFile | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.projects)) return null
  const projects: Project[] = []
  for (const item of raw.projects) {
    const project = parseProject(item)
    // 任何一项不合法都视为整个文件损坏，交给调用方备份原文件，避免静默丢数据
    if (!project) return null
    projects.push(project)
  }
  return { version: 1, projects }
}

function parseProject(raw: unknown): Project | null {
  if (!isRecord(raw)) return null
  const { id, name, path: p, createdAt, lastOpenedAt } = raw
  if (typeof id !== 'string' || !id) return null
  if (typeof name !== 'string' || typeof p !== 'string' || !p) return null
  if (typeof createdAt !== 'number') return null
  if (lastOpenedAt !== undefined && typeof lastOpenedAt !== 'number') return null
  const project: Project = { id, name, path: p, createdAt }
  if (lastOpenedAt !== undefined) project.lastOpenedAt = lastOpenedAt
  return project
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
