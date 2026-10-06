import { promises as fs } from 'node:fs'

const CHUNK = 256 * 1024
const MAX_LINE = 1024 * 1024
/** 字节层保存半行，避免半个 UTF-8 汉字被解码成替换字符。 */
export class JsonlTail {
  constructor(private readonly initialBytes = 4 * 1024 * 1024) {}
  private offset = 0
  private pending = Buffer.alloc(0)
  private skipping = false
  private identity = ''

  async read(file: string, accept: (value: unknown) => void): Promise<void> {
    const handle = await fs.open(file, 'r')
    try {
      const stat = await handle.stat()
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
      if (identity !== this.identity || stat.size < this.offset) {
        this.identity = identity
        this.offset = Math.max(0, stat.size - this.initialBytes)
        this.pending = Buffer.alloc(0)
        this.skipping = this.offset > 0
      }
      // 每轮有界读取；大文件在后续轮次继续，不阻塞主进程一次扫描全部内容。
      for (let round = 0; round < 8 && this.offset < stat.size; round++) {
        const buffer = Buffer.alloc(Math.min(CHUNK, stat.size - this.offset))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset)
        if (!bytesRead) break
        this.offset += bytesRead
        let bytes = Buffer.concat([this.pending, buffer.subarray(0, bytesRead)])
        let start = 0, end: number
        while ((end = bytes.indexOf(10, start)) !== -1) {
          if (!this.skipping && end - start <= MAX_LINE) {
            try { accept(JSON.parse(bytes.subarray(start, end).toString('utf8'))) } catch { /* 非JSON行忽略 */ }
          }
          this.skipping = false
          start = end + 1
        }
        bytes = bytes.subarray(start)
        if (bytes.length > MAX_LINE || this.skipping) {
          this.skipping = true
          this.pending = Buffer.alloc(0)
        } else this.pending = Buffer.from(bytes)
      }
    } finally { await handle.close() }
  }
}
