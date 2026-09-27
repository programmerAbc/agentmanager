import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Project, ProjectsFile } from '../shared/types'
import { readJsonFile, timestamp } from './jsonFile'
import log from './log'

/** 数据库 schema 版本，记录在 PRAGMA user_version */
const SCHEMA_VERSION = 1

const SELECT_COLUMNS = 'id, name, path, created_at, last_opened_at'

/**
 * 项目列表存在 SQLite（Electron 内置 Node 的 node:sqlite）里。
 * 所有操作都是同步的小事务，调用返回时数据已经落盘；对外保留 async 签名，IPC 层无需关心存储方式。
 */
export class ProjectStore {
  private db: DatabaseSync | null = null

  constructor(
    private readonly dbFile: string,
    /** 迭代 1 使用的 projects.json，首次启动时导入 */
    private readonly legacyJsonFile: string
  ) {}

  async load(): Promise<void> {
    this.db = await openOrRecover(this.dbFile)
    await this.importLegacyJson()
    log.info(`[projects] 已加载 ${this.count()} 个项目（${path.basename(this.dbFile)}）`)
  }

  /** 退出前关闭数据库（WAL 会被合并回主文件） */
  close(): void {
    try {
      this.db?.close()
    } catch (err) {
      log.warn('[projects] 关闭数据库失败', err)
    }
    this.db = null
  }

  list(): Project[] {
    return this.database()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM projects ORDER BY sort_order, rowid`)
      .all()
      .map(toProject)
  }

  get(id: string): Project | undefined {
    const row = this.database().prepare(`SELECT ${SELECT_COLUMNS} FROM projects WHERE id = ?`).get(id)
    return row ? toProject(row) : undefined
  }

  /** 添加目录；同一路径已存在时直接返回已有项目。 */
  async add(dir: string): Promise<Project> {
    const db = this.database()
    const absPath = path.resolve(dir)
    const key = pathKey(absPath)
    const existing = db.prepare(`SELECT ${SELECT_COLUMNS} FROM projects WHERE path_key = ?`).get(key)
    if (existing) return toProject(existing)

    const project: Project = {
      id: randomUUID(),
      name: path.basename(absPath) || absPath,
      path: absPath,
      createdAt: Date.now()
    }
    db.prepare(
      `INSERT INTO projects (id, name, path, path_key, sort_order, created_at)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects), ?)`
    ).run(project.id, project.name, project.path, key, project.createdAt)
    log.info(`[projects] 添加 ${project.id} ${project.path}`)
    return project
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('项目名不能为空')
    const result = this.database().prepare('UPDATE projects SET name = ? WHERE id = ?').run(trimmed, id)
    if (Number(result.changes) === 0) throw new Error('项目不存在')
  }

  async remove(id: string): Promise<void> {
    const result = this.database().prepare('DELETE FROM projects WHERE id = ?').run(id)
    if (Number(result.changes) > 0) log.info(`[projects] 移除 ${id}`)
  }

  async touch(id: string): Promise<void> {
    const result = this.database().prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(Date.now(), id)
    if (Number(result.changes) === 0) throw new Error('项目不存在')
  }

  private database(): DatabaseSync {
    if (!this.db) throw new Error('项目数据库未打开')
    return this.db
  }

  private count(): number {
    const row = this.database().prepare('SELECT COUNT(*) AS n FROM projects').get()
    return Number(row?.n ?? 0)
  }

  /**
   * 迭代 1 的 projects.json → SQLite。只在数据库里还没有项目时导入，
   * 导入后把原文件改名为 projects.json.migrated-<时间戳> 留作备份。
   * 文件损坏时 readJsonFile 已经把它备份为 .bak-<时间戳>，这里直接跳过。
   */
  private async importLegacyJson(): Promise<void> {
    if (this.count() > 0) return
    const result = await readJsonFile(this.legacyJsonFile, parseProjectsFile)
    if (result.kind !== 'ok') return
    const projects = result.value.projects
    const db = this.database()
    const insert = db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, path, path_key, sort_order, created_at, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    transaction(db, () => {
      projects.forEach((p, i) => {
        insert.run(p.id, p.name, p.path, pathKey(p.path), i, p.createdAt, p.lastOpenedAt ?? null)
      })
    })
    const migrated = `${this.legacyJsonFile}.migrated-${timestamp()}`
    await fs.rename(this.legacyJsonFile, migrated).catch((err: unknown) => {
      log.warn('[projects] 迁移后重命名 projects.json 失败', err)
    })
    log.info(`[projects] 已从 projects.json 导入 ${projects.length} 个项目，原文件备份为 ${path.basename(migrated)}`)
  }
}

/** 打开数据库并检查完整性；失败时把数据库文件备份为 .bak-<时间戳> 后新建空库 */
async function openOrRecover(file: string): Promise<DatabaseSync> {
  try {
    return openDatabase(file)
  } catch (err) {
    log.error(`[projects] 数据库无法打开或已损坏，备份后以空库启动 ${file}`, err)
  }
  try {
    const suffix = `.bak-${timestamp()}`
    for (const f of [file, `${file}-wal`, `${file}-shm`]) {
      await fs.rename(f, `${f}${suffix}`).catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      })
    }
    return openDatabase(file)
  } catch (err) {
    // 连备份都做不了（例如文件被占用）：用内存数据库保证应用能启动，本次运行的改动不会保存
    log.error('[projects] 备份损坏的数据库失败，本次使用内存数据库', err)
    return openDatabase(':memory:')
  }
}

function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 2000;')
    const check = db.prepare('PRAGMA quick_check').get()
    if (check?.quick_check !== 'ok') throw new Error(`完整性检查失败：${JSON.stringify(check)}`)
    migrateSchema(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

function migrateSchema(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (version > SCHEMA_VERSION) {
    log.warn(`[projects] 数据库 schema 版本 ${version} 高于当前支持的 ${SCHEMA_VERSION}（可能由新版本写入）`)
    return
  }
  if (version < 1) {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id             TEXT PRIMARY KEY,
          name           TEXT NOT NULL,
          path           TEXT NOT NULL,
          path_key       TEXT NOT NULL UNIQUE, -- 小写、去掉末尾分隔符，用于同路径去重
          sort_order     INTEGER NOT NULL,     -- 添加顺序
          created_at     INTEGER NOT NULL,
          last_opened_at INTEGER
        );
        PRAGMA user_version = 1;
      `)
    })
  }
}

function transaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function toProject(row: Record<string, unknown>): Project {
  const { id, name, path: p, created_at: createdAt, last_opened_at: lastOpenedAt } = row
  if (typeof id !== 'string' || typeof name !== 'string' || typeof p !== 'string') {
    throw new Error('项目数据格式错误')
  }
  const project: Project = { id, name, path: p, createdAt: Number(createdAt) }
  if (lastOpenedAt !== null && lastOpenedAt !== undefined) project.lastOpenedAt = Number(lastOpenedAt)
  return project
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
