import { promises as fs } from 'node:fs'
import path from 'node:path'
import log from './log'

export type ReadJsonResult<T> =
  | { kind: 'missing' }
  | { kind: 'ok'; value: T }
  | { kind: 'corrupt'; backupPath: string | null }

/**
 * 读取并校验 JSON 文件。
 * 文件损坏（无法解析或校验不通过）时，把原文件改名为 `<file>.bak-<时间戳>` 备份，返回 corrupt。
 */
export async function readJsonFile<T>(
  file: string,
  validate: (raw: unknown) => T | null
): Promise<ReadJsonResult<T>> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    log.error(`[json] 读取失败 ${file}`, err)
    return { kind: 'corrupt', backupPath: await backupCorrupt(file) }
  }

  try {
    const value = validate(JSON.parse(text))
    if (value !== null) return { kind: 'ok', value }
    log.warn(`[json] 内容校验失败 ${file}`)
  } catch (err) {
    log.warn(`[json] 解析失败 ${file}`, err)
  }
  return { kind: 'corrupt', backupPath: await backupCorrupt(file) }
}

async function backupCorrupt(file: string): Promise<string | null> {
  const backupPath = `${file}.bak-${timestamp()}`
  try {
    await fs.rename(file, backupPath)
    log.warn(`[json] 已将损坏的文件备份为 ${backupPath}`)
    return backupPath
  } catch (err) {
    log.error(`[json] 备份损坏文件失败 ${file}`, err)
    return null
  }
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 原子写 JSON：先写同目录下的临时文件并 fsync，再 rename 覆盖目标文件。
 * 同一个实例上的写入串行执行，避免并发 rename 互相覆盖。
 */
export class JsonFileWriter {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  write(value: unknown): Promise<void> {
    const job = this.queue.then(() => writeAtomic(this.file, JSON.stringify(value, null, 2)))
    // 队列本身不因某次失败而中断
    this.queue = job.catch(() => undefined)
    return job
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

// Windows 上目标文件被杀毒软件/索引服务短暂占用时 rename 会报 EPERM/EBUSY，稍等重试
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!retryable || attempt >= 4) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}
