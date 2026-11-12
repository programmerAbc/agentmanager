import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { access, lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { GitSnapshot, RepositoryBranch } from '../shared/types'

interface Entry {
  directory: string
  headPath: string
  head: string
  marker: string
  row: RepositoryBranch
}

export interface MonitorOptions {
  pollMs?: number
  scanMs?: number
  watch?: boolean
  /** 供隔离测试使用；生产从系统 PATH 定位 Git 绝对路径 */
  gitExecutable?: string
}

const canonical = (p: string): string => process.platform === 'win32' ? p.toLowerCase() : p
const message = (err: unknown): string => err instanceof Error ? err.message : String(err)
const codeOf = (err: unknown): unknown => (err as NodeJS.ErrnoException | null)?.code

/** 每订阅一实例。只读取仓库，文件事件是提示，周期校验才是可靠性兜底。 */
export class GitRepositoryMonitor {
  private readonly root: string
  private readonly notify: (snapshot: GitSnapshot) => void
  private readonly options: MonitorOptions
  private readonly abort = new AbortController()
  private readonly entries = new Map<string, Entry>()
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Set<ReturnType<typeof setInterval>>()
  private eventTimer?: ReturnType<typeof setTimeout>
  private scanTimer?: ReturnType<typeof setTimeout>
  private scanWanted = false
  private checkWanted = false
  private running = false
  private disposed = false
  private git = ''
  private lastEmit = 0
  private snapshot: GitSnapshot

  constructor(projectId: string, root: string, notify: (snapshot: GitSnapshot) => void, options: MonitorOptions = {}) {
    this.root = path.resolve(root)
    this.notify = notify
    this.options = options
    this.snapshot = {
      projectId, subscriptionId: randomUUID(), revision: 0, repositories: [],
      scanState: 'scanning', monitorState: 'polling', scannedDirectories: 0,
      skippedPaths: [], checkedAt: null
    }
  }

  get current(): GitSnapshot {
    return { ...this.snapshot, repositories: [...this.entries.values()].map(e => ({ ...e.row }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)), skippedPaths: [...this.snapshot.skippedPaths] }
  }

  start(): void {
    this.request(true)
    for (const [ms, scan] of [[this.options.pollMs ?? 5000, false], [this.options.scanMs ?? 30000, true]] as const) {
      const timer = setInterval(() => this.request(scan), ms)
      timer.unref()
      this.timers.add(timer)
    }
  }

  refresh(): void { this.request(true) }

  dispose(): void {
    this.disposed = true
    this.abort.abort()
    for (const timer of this.timers) clearInterval(timer)
    this.timers.clear()
    clearTimeout(this.eventTimer)
    clearTimeout(this.scanTimer)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private emit(): void {
    if (this.disposed) return
    this.snapshot.revision++
    this.lastEmit = Date.now()
    this.notify(this.current)
  }

  private request(scan: boolean): void {
    if (this.disposed) return
    if (scan) this.scanWanted = true
    else this.checkWanted = true
    if (!this.running) void this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (!this.disposed && (this.scanWanted || this.checkWanted)) {
        const scan = this.scanWanted
        this.scanWanted = false
        this.checkWanted = false
        try {
          if (scan) await this.scan()
          else await this.check()
        } catch (err) {
          if (this.disposed) return
          this.snapshot.scanState = codeOf(err) === 'ENOENT' && !this.git ? 'missing-git' : 'error'
          this.snapshot.error = message(err)
          this.emit()
        }
      }
    } finally { this.running = false }
  }

  private async gitCommand(directory: string, args: string[]): Promise<string> {
    const env = { ...process.env }
    // 不继承父 Git 命令的仓库、index、临时配置覆盖。
    for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key]
    return new Promise((resolve, reject) => {
      execFile(this.git, args, { cwd: directory, env, windowsHide: true, timeout: 3000,
        maxBuffer: 256 * 1024, encoding: 'utf8', signal: this.abort.signal }, (err, stdout, stderr) => {
        if (err) {
          // 保留退出码，区分非符号 HEAD 与真正的权限/损坏错误。
          reject(Object.assign(new Error(stderr.trim() || err.message), { code: err.code }))
        } else resolve(stdout.trim())
      })
    })
  }

  private async findGit(): Promise<string> {
    if (this.options.gitExecutable) return this.options.gitExecutable
    const executable = process.platform === 'win32' ? 'git.exe' : 'git'
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const clean = dir.replace(/^"|"$/g, '')
      if (!path.isAbsolute(clean)) continue // 不执行工作树中的同名程序
      const file = path.join(clean, executable)
      try { await access(file); return file } catch { /* 继续搜索 */ }
    }
    throw Object.assign(new Error('未检测到 Git，请安装 Git 后刷新'), { code: 'ENOENT' })
  }

  private async discover(directory: string, marker: string, previous?: Entry): Promise<Entry> {
    if (previous?.headPath && previous.marker === marker) {
      await this.readEntry(previous)
      return previous
    }
    const top = await realpath(await this.gitCommand(directory, ['rev-parse', '--show-toplevel']))
    if (canonical(top) !== canonical(await realpath(directory))) throw new Error('不是独立 Git 工作树根目录')
    const headPath = await this.gitCommand(directory, ['rev-parse', '--path-format=absolute', '--git-path', 'HEAD'])
    const relativePath = path.relative(this.root, directory).split(path.sep).join('/') || '.'
    const entry: Entry = { directory, headPath, head: '', marker, row: previous?.row ?? {
      id: relativePath, relativePath, branch: null, shortOid: null, state: 'error', lastSuccessAt: null
    } }
    await this.readEntry(entry)
    return entry
  }

  private async readEntry(entry: Entry): Promise<void> {
    for (const wait of [0, 100, 300, 1000]) {
      try {
        if (wait) await delay(wait, undefined, { signal: this.abort.signal })
        if (this.disposed) return
        // HEAD 是小文件；限大小避免损坏/恶意仓库造成无界解析。
        const stat = await lstat(entry.headPath)
        if (!stat.isFile() || stat.size > 4096) throw new Error('HEAD 格式异常')
        const head = (await readFile(entry.headPath, 'utf8')).trim()
        if (!/^(?:ref: refs\/[^\s\x00-\x1f]+|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(head)) throw new Error('HEAD 内容无效')
        if (head === entry.head && entry.row.state !== 'error' && entry.row.state !== 'unborn') {
          entry.row.lastSuccessAt = Date.now()
          return
        }
        let branch: string | null = null
        let shortOid: string | null = null
        let state: RepositoryBranch['state']
        try {
          branch = await this.entryCommand(entry, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
          state = 'branch'
          try { await this.entryCommand(entry, ['rev-parse', '--verify', 'HEAD']) }
          catch (err) {
            // rev-parse 对尚无提交返回 128；再用 show-ref 判断缺失引用，避免吞掉权限错误。
            if (codeOf(err) !== 128) throw err
            try { await this.entryCommand(entry, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); throw err }
            catch (refErr) { if (codeOf(refErr) !== 1) throw refErr }
            state = 'unborn'
          }
        } catch (err) {
          if (codeOf(err) !== 1 || branch !== null) throw err
          shortOid = await this.entryCommand(entry, ['rev-parse', '--verify', '--short', 'HEAD'])
          state = 'detached'
        }
        entry.head = head
        entry.row = { ...entry.row, branch, shortOid, state, error: undefined, lastSuccessAt: Date.now() }
        return
      } catch (err) {
        if (this.disposed) return
        if (wait === 1000) entry.row = { ...entry.row, state: 'error', error: message(err) }
      }
    }
  }

  private entryCommand(entry: Entry, args: string[]): Promise<string> {
    // 显式绑定 gitdir：HEAD 损坏时 Git 不能向上退回父项目仓库。
    return this.gitCommand(entry.directory, [`--git-dir=${path.dirname(entry.headPath)}`, `--work-tree=${entry.directory}`, ...args])
  }

  private async scan(): Promise<void> {
    this.snapshot.scanState = 'scanning'
    this.snapshot.error = undefined
    this.snapshot.scannedDirectories = 0
    this.snapshot.skippedPaths = []
    this.emit()
    this.git = await this.findGit()
    try { await this.gitCommand(path.dirname(this.git), ['--version']) }
    catch (err) { if (codeOf(err) === 'ENOENT') this.git = ''; throw err }
    const seen = new Set<string>()
    const failed: string[] = []
    let frontier = [this.root]
    while (frontier.length && !this.disposed) {
      const next: string[] = []
      for (let offset = 0; offset < frontier.length && !this.disposed; offset += 4) {
        await Promise.all(frontier.slice(offset, offset + 4).map(async directory => {
          if (this.disposed) return
          const relative = path.relative(this.root, directory).split(path.sep).join('/') || '.'
          try {
            const files = await readdir(directory, { withFileTypes: true })
            this.snapshot.scannedDirectories++
            const marker = files.find(f => canonical(f.name) === '.git' && (f.isDirectory() || f.isFile()))
            if (marker) {
              seen.add(relative)
              try {
                const markerPath = path.join(directory, marker.name)
                const stat = await lstat(markerPath)
                if (stat.isFile() && stat.size > 4096) throw new Error('.git 指针文件过大')
                const identity = stat.isFile() ? `file:${await readFile(markerPath, 'utf8')}` : `directory:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
                const entry = await this.discover(directory, identity, this.entries.get(relative))
                if (!this.disposed) this.entries.set(relative, entry)
              } catch (err) {
                const old = this.entries.get(relative)
                this.entries.set(relative, { directory, headPath: '', head: '', marker: '', row: {
                  ...(old?.row ?? { id: relative, relativePath: relative, branch: null, shortOid: null, lastSuccessAt: null }),
                  state: 'error', error: message(err)
                } })
              }
            }
            // Dirent 不跟随符号链接/junction；根目录由用户选择，允许根本身是链接。
            for (const file of files) if (canonical(file.name) !== '.git' && file.isDirectory() && !file.isSymbolicLink()) next.push(path.join(directory, file.name))
          } catch (err) {
            if (directory === this.root) this.snapshot.error = `项目目录无法读取：${message(err)}`
            // 不存在是确切删除；无法访问则保留该子树旧事实并标记过期。
            if (codeOf(err) !== 'ENOENT') {
              failed.push(relative)
              if (directory === this.root) this.snapshot.error = message(err)
            }
          }
        }))
        if (Date.now() - this.lastEmit >= 200) this.emit()
        await delay(0, undefined, { signal: this.abort.signal })
      }
      frontier = next
    }
    if (this.disposed) return
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue
      if (failed.some(p => p === '.' || id === p || id.startsWith(p + '/'))) {
        entry.row = { ...entry.row, state: 'error', error: '所在目录无法访问，显示上次读取结果' }
      } else this.entries.delete(id)
    }
    this.snapshot.skippedPaths = failed
    this.snapshot.scanState = this.snapshot.error ? 'error' : failed.length ? 'partial' : 'ready'
    this.snapshot.checkedAt = Date.now()
    this.rebuildWatches()
    this.emit()
  }

  private async check(): Promise<void> {
    const entries = [...this.entries.values()]
    for (let offset = 0; offset < entries.length && !this.disposed; offset += 4) {
      await Promise.all(entries.slice(offset, offset + 4).map(e => e.headPath ? this.readEntry(e) : Promise.resolve()))
    }
    if (!this.disposed) { this.snapshot.checkedAt = Date.now(); this.emit() }
  }

  private queueEvent(scan: boolean): void {
    if (this.disposed) return
    if (scan) {
      if (!this.scanTimer) this.scanTimer = setTimeout(() => { this.scanTimer = undefined; this.request(true) }, 1000)
    } else if (!this.eventTimer) {
      // 从首个事件起固定窗口，持续事件不能无限延后刷新。
      this.eventTimer = setTimeout(() => { this.eventTimer = undefined; this.request(false) }, 150)
    }
  }

  private rebuildWatches(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    let degraded = this.options.watch === false
    const add = (directory: string, recursive: boolean, listener: (event: string, filename: string | null) => void): void => {
      if (this.watchers.has(canonical(directory))) return
      if (this.watchers.size >= 256 || this.options.watch === false) { degraded = true; return }
      try {
        const watcher = watch(directory, { recursive }, (event, file) => listener(event, file?.toString() ?? null))
        watcher.on('error', () => { watcher.close(); this.watchers.delete(canonical(directory)); this.snapshot.monitorState = 'polling'; this.emit() })
        watcher.unref()
        this.watchers.set(canonical(directory), watcher)
      } catch { degraded = true }
    }
    // .git 创建/移动提示发现；普通文件内容变更不重扫整个目录树。
    add(this.root, true, (event, file) => {
      if (!file) { this.queueEvent(true); return }
      const segments = file.split(/[\\/]/)
      const gitIndex = segments.findIndex(segment => canonical(segment) === '.git')
      if (gitIndex >= 0) {
        if (gitIndex === segments.length - 1) this.queueEvent(true)
        else if (segments.at(-1)?.toUpperCase() === 'HEAD') this.queueEvent(false)
        // 忽略 objects/index/refs 等内部写入，避免普通提交引起整树扫描。
      } else if (event === 'rename') {
        // 新增/移入目录立即发现；删除路径无法确认类型，交给周期重扫兜底。
        void lstat(path.join(this.root, file)).then(stat => {
          if (stat.isDirectory() && !stat.isSymbolicLink()) this.queueEvent(true)
        }).catch(() => undefined)
      }
    })
    for (const entry of this.entries.values()) {
      if (entry.headPath) add(path.dirname(entry.headPath), false, (_event, file) => {
        if (!file || file.toUpperCase() === 'HEAD') this.queueEvent(false)
      })
    }
    this.snapshot.monitorState = degraded ? 'polling' : 'watching'
  }
}
