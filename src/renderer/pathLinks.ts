import type { IBufferCell, IBufferCellPosition, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

const api = window.api

/** 识别出的路径链接被激活（Ctrl+单击）、悬浮、离开时的回调 */
export interface PathLinkHandlers {
  open(event: MouseEvent, absolutePath: string): void
  hover(absolutePath: string): void
  leave(): void
}

// 路径里不允许的字符：空白、引号、反引号、尖括号、| ? * 以及冒号（冒号只出现在盘符和 :行号 后缀里）
const PATH_CHAR = String.raw`[^\s"'\x60<>|?*:]`
const NAME_CHAR = String.raw`[\p{L}\p{N}_.@-]`
/** 可选的位置后缀：file.ts:12、file.ts:12:3、file.md#L20、file.md#L20-L30 */
const SUFFIX = String.raw`(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)?`
/**
 * 1. Windows 绝对路径：C:\a\b.png、D:/x/y
 * 2. 相对路径 / 文件名：src/main/ipc.ts、.\docs\spec.md、handoff.md（必须有扩展名，扩展名以字母开头）
 * 前面不能紧跟路径字符或 ://（不在网址、单词中间开始匹配；网址由 WebLinksAddon 处理）。
 */
const PATH_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.@\\/:-])` +
    String.raw`(?:[A-Za-z]:[\\/]${PATH_CHAR}*|(?:\.{1,2}[\\/])?(?:${NAME_CHAR}+[\\/])*${NAME_CHAR}*\.[A-Za-z][A-Za-z0-9]{0,15})` +
    SUFFIX,
  'gu'
)
/** 句末标点、括号等不算路径的一部分 */
const TRAILING_PUNCTUATION = /[.,;:!)\]}，。；：！）】]+$/
/** 一个逻辑行（含自动换行的续行）最多看这么多行，避免超长输出拖慢悬浮 */
const MAX_WRAPPED_ROWS = 20

interface CellPos {
  x: number
  y: number
  width: number
}

/**
 * 把终端文本里的本机文件路径变成链接（Ctrl+单击用默认程序打开）。
 * 只有主进程确认存在的文件才显示为链接；相对路径以项目目录为基准。
 */
export class PathLinkProvider implements ILinkProvider {
  private cell: IBufferCell | undefined

  constructor(
    private readonly term: Terminal,
    private readonly sessionId: string,
    private readonly handlers: PathLinkHandlers
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const row = bufferLineNumber - 1
    const { text, cells } = this.logicalLine(row)
    const matches = findPaths(text).filter((m) => {
      const first = cells[m.start]
      const last = cells[m.end - 1]
      return first && last && first.y <= bufferLineNumber && last.y >= bufferLineNumber
    })
    if (matches.length === 0) {
      callback(undefined)
      return
    }
    void api.links
      .resolvePaths(
        this.sessionId,
        matches.map((m) => m.path)
      )
      .then((resolved) => {
        const links: ILink[] = []
        matches.forEach((m, i) => {
          const target = resolved[i]
          if (!target) return
          const first = cells[m.start]
          const last = cells[m.end - 1]
          const start: IBufferCellPosition = { x: first.x, y: first.y }
          const end: IBufferCellPosition = { x: last.x + last.width - 1, y: last.y }
          links.push({
            text: m.text,
            range: { start, end },
            decorations: { underline: true, pointerCursor: true },
            activate: (event) => this.handlers.open(event, target),
            hover: () => this.handlers.hover(target),
            leave: () => this.handlers.leave()
          })
        })
        callback(links.length > 0 ? links : undefined)
      })
      .catch(() => callback(undefined))
  }

  /** 取包含该行的逻辑行文本，并记录每个 UTF-16 码元对应的单元格（1 起始坐标，宽字符占 2 格） */
  private logicalLine(row: number): { text: string; cells: CellPos[] } {
    const buffer = this.term.buffer.active
    let first = row
    while (first > 0 && row - first < MAX_WRAPPED_ROWS && buffer.getLine(first)?.isWrapped) first--
    let last = row
    while (last - first < MAX_WRAPPED_ROWS && buffer.getLine(last + 1)?.isWrapped) last++

    let text = ''
    const cells: CellPos[] = []
    for (let y = first; y <= last; y++) {
      const line = buffer.getLine(y)
      if (!line) continue
      for (let x = 0; x < line.length; x++) {
        this.cell = line.getCell(x, this.cell)
        if (!this.cell) continue
        const width = this.cell.getWidth()
        if (width === 0) continue // 宽字符的后半格
        const chars = this.cell.getChars() || ' '
        text += chars
        for (let i = 0; i < chars.length; i++) cells.push({ x: x + 1, y: y + 1, width })
      }
    }
    return { text, cells }
  }
}

interface PathMatch {
  /** 显示的链接文本（含 :行号 后缀） */
  text: string
  /** 去掉位置后缀后的路径 */
  path: string
  start: number
  end: number
}

export function findPaths(text: string): PathMatch[] {
  const result: PathMatch[] = []
  for (const m of text.matchAll(PATH_PATTERN)) {
    const raw = m[0].replace(TRAILING_PUNCTUATION, '')
    const path = raw.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, '')
    // 至少要有扩展名或分隔符之外的内容；「C:\」这种只有盘符的不算
    if (path.length < 3 || /^[A-Za-z]:[\\/]?$/.test(path)) continue
    const start = m.index ?? 0
    result.push({ text: raw, path, start, end: start + raw.length })
  }
  return result
}
