import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import { showContextMenu } from './contextMenu'

const api = window.api

export const FONT_FAMILY = "'Sarasa Term SC', Consolas, 'Microsoft YaHei UI', monospace"
const RESIZE_DEBOUNCE_MS = 50

export type ZoomAction = 'in' | 'out' | 'reset'

/** Ctrl+= / Ctrl+- / Ctrl+0（含小键盘）→ 字号操作；其他按键返回 null */
export function zoomActionOf(e: KeyboardEvent): ZoomAction | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '=' || e.key === '+') return 'in'
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_') return 'out'
  if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0') return 'reset'
  return null
}

/** 取按键对应的字母（小写）。非拉丁键盘布局下 e.key 不是字母时，按物理键位回退。 */
function letterOf(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  const m = /^Key([A-Z])$/.exec(e.code)
  return m ? m[1].toLowerCase() : ''
}

const THEME: ITheme = {
  background: '#181818',
  foreground: '#d4d4d4',
  cursor: '#e6e6e6',
  cursorAccent: '#181818',
  selectionBackground: 'rgba(217, 119, 87, 0.35)',
  selectionInactiveBackground: 'rgba(217, 119, 87, 0.2)',
  scrollbarSliderBackground: 'rgba(121, 121, 121, 0.3)',
  scrollbarSliderHoverBackground: 'rgba(121, 121, 121, 0.5)',
  scrollbarSliderActiveBackground: 'rgba(191, 191, 191, 0.5)',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}

/**
 * idle: 还没启动 PTY；starting: pty.open 进行中；running: PTY 运行中；
 * exited: PTY 已退出（按 Enter 重启）；failed: 启动失败（按 Enter 重试）
 */
type ViewState = 'idle' | 'starting' | 'running' | 'exited' | 'failed'

export interface TerminalHooks {
  onRunningChange(sessionId: string, running: boolean): void
  onError(message: string): void
}

/** 一个项目的终端：一个 xterm 实例 + 它的 DOM 容器。切换项目时只切换容器可见性，不 dispose。 */
class TerminalView {
  readonly pane: HTMLDivElement
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private webgl: WebglAddon | null = null
  private state: ViewState = 'idle'
  private disposed = false

  constructor(
    readonly sessionId: string,
    host: HTMLElement,
    fontSize: number,
    private readonly hooks: TerminalHooks
  ) {
    // 先让容器可见再 open，xterm 需要在可见状态下测量字符尺寸
    this.pane = document.createElement('div')
    this.pane.className = 'term-pane visible'
    const mount = document.createElement('div')
    mount.className = 'term-mount'
    this.pane.appendChild(mount)
    host.appendChild(this.pane)

    this.term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize,
      scrollback: 10000,
      cursorBlink: true,
      allowProposedApi: true,
      theme: THEME,
      windowsPty: { backend: 'conpty', buildNumber: api.system.windowsBuild }
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void api.shell.openExternal(uri).then((r) => {
          if (!r.ok) hooks.onError(r.error)
        })
      })
    )
    this.term.open(mount)
    this.loadWebgl()

    this.term.onData((data) => this.handleInput(data))
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e))
    this.pane.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showContextMenu(e.clientX, e.clientY, [
        { label: '复制', disabled: !this.term.hasSelection(), action: () => this.copySelection(false) },
        { label: '粘贴', action: () => void this.pasteFromClipboard() }
      ])
    })
  }

  get visible(): boolean {
    return this.pane.classList.contains('visible')
  }

  show(): void {
    this.pane.classList.add('visible')
    // 顺序：先 fit，再把新尺寸同步给 PTY，最后聚焦
    this.fit()
    this.syncPtySize()
    this.term.focus()
  }

  hide(): void {
    this.pane.classList.remove('visible')
  }

  /** 按容器尺寸重新计算行列。隐藏状态下不 fit，否则会被算成 0。返回行列是否变化。 */
  fit(): boolean {
    if (!this.visible || this.pane.clientWidth === 0 || this.pane.clientHeight === 0) return false
    const { cols, rows } = this.term
    try {
      this.fitAddon.fit()
    } catch (err) {
      console.warn('[terminal] fit 失败', err)
      return false
    }
    return cols !== this.term.cols || rows !== this.term.rows
  }

  syncPtySize(): void {
    if (this.state === 'running') api.pty.resize(this.sessionId, this.term.cols, this.term.rows)
  }

  async start(): Promise<void> {
    if (this.state === 'starting' || this.state === 'running') return
    this.setState('starting')
    this.fit()
    const result = await api.pty.open(this.sessionId, this.term.cols, this.term.rows)
    if (this.disposed) return
    if (result.ok) {
      this.setState('running')
      // pty.open 期间窗口尺寸可能变过
      this.syncPtySize()
    } else {
      this.setState('failed')
      this.term.write(`\x1b[31m${result.error}\x1b[0m\r\n\x1b[90m按 Enter 重试\x1b[0m\r\n`)
      this.hooks.onError(result.error)
    }
  }

  /** 右键菜单「重启终端」：结束当前 PTY（如果有），清屏后在同一个 xterm 里重新启动 */
  async restart(): Promise<void> {
    if (this.state === 'starting') return
    if (this.state === 'running') {
      const result = await api.pty.kill(this.sessionId)
      if (!result.ok) this.hooks.onError(result.error)
    }
    if (this.disposed) return
    this.setState('idle')
    this.term.reset()
    await this.start()
  }

  write(data: string): void {
    this.term.write(data)
  }

  handleExit(exitCode: number): void {
    if (this.state !== 'running') return
    this.setState('exited')
    this.term.write(`\r\n\x1b[90m进程已退出 (code ${exitCode})，按 Enter 重启\x1b[0m\r\n`)
  }

  focus(): void {
    this.term.focus()
  }

  /** 仅供开发期自测使用 */
  debugSnapshot(): { state: ViewState; cols: number; rows: number; visible: boolean; webgl: boolean; text: string } {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return {
      state: this.state,
      cols: this.term.cols,
      rows: this.term.rows,
      visible: this.visible,
      webgl: this.webgl !== null,
      text: lines.join('\n')
    }
  }

  dispose(): void {
    this.disposed = true
    this.webgl?.dispose()
    this.webgl = null
    this.term.dispose()
    this.pane.remove()
  }

  setFontSize(fontSize: number): void {
    this.term.options.fontSize = fontSize
    // 隐藏的终端等下次显示时再 fit
    if (this.fit()) this.syncPtySize()
  }

  /**
   * 复制 / 粘贴快捷键，只处理 keydown：
   * - Ctrl+C：有选区时复制并清除选区；没有选区时照常发给 PTY（中断信号）
   * - Ctrl+Shift+C：始终复制
   * - Ctrl+V / Ctrl+Shift+V：通过 term.paste() 粘贴，保证 bracketed paste 生效
   * - Ctrl+= / Ctrl+- / Ctrl+0：字号快捷键由全局监听处理，这里只阻止它们发给 PTY
   * 返回 false 表示 xterm 不再处理该按键。
   */
  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true
    if (!e.ctrlKey || e.altKey || e.metaKey) return true
    if (zoomActionOf(e)) return false
    const letter = letterOf(e)
    if (letter === 'c') {
      if (!e.shiftKey && !this.term.hasSelection()) return true
      e.preventDefault()
      this.copySelection(!e.shiftKey)
      return false
    }
    if (letter === 'v') {
      // 阻止浏览器原生 paste 事件，否则 xterm 会再粘贴一次
      e.preventDefault()
      void this.pasteFromClipboard()
      return false
    }
    return true
  }

  private copySelection(clearAfterCopy: boolean): void {
    const text = this.term.getSelection()
    if (text) void api.clipboard.writeText(text)
    if (clearAfterCopy) this.term.clearSelection()
    this.term.focus()
  }

  private async pasteFromClipboard(): Promise<void> {
    const text = await api.clipboard.readText()
    if (text && !this.disposed) this.term.paste(text)
    this.term.focus()
  }

  private handleInput(data: string): void {
    if (this.state === 'running') {
      api.pty.write(this.sessionId, data)
    } else if ((this.state === 'exited' || this.state === 'failed') && data === '\r') {
      this.term.reset()
      void this.start()
    }
  }

  private setState(state: ViewState): void {
    const wasRunning = this.state === 'running'
    this.state = state
    const running = state === 'running'
    if (wasRunning !== running) this.hooks.onRunningChange(this.sessionId, running)
  }

  /** WebGL 渲染器；加载失败或 context lost 时释放它，xterm 自动回退到默认 DOM 渲染器 */
  private loadWebgl(): void {
    let addon: WebglAddon | null = null
    try {
      addon = new WebglAddon()
      const loaded = addon
      loaded.onContextLoss(() => {
        console.warn(`[terminal] WebGL context lost，回退到默认渲染器 session=${this.sessionId}`)
        loaded.dispose()
        if (this.webgl === loaded) this.webgl = null
      })
      this.term.loadAddon(loaded)
      this.webgl = loaded
    } catch (err) {
      console.warn('[terminal] WebGL 渲染器加载失败，使用默认渲染器', err)
      addon?.dispose()
      this.webgl = null
    }
  }
}

/** 管理所有项目的终端视图，只有一个可见。PTY 输出按 sessionId 分发，后台项目照常写入。 */
export class TerminalManager {
  private readonly views = new Map<string, TerminalView>()
  private activeId: string | null = null
  private resizeTimer: number | undefined

  constructor(
    private readonly host: HTMLElement,
    private fontSize: number,
    private readonly hooks: TerminalHooks
  ) {
    api.pty.onData((id, data) => this.views.get(id)?.write(data))
    api.pty.onExit((id, exitCode) => this.views.get(id)?.handleExit(exitCode))

    // 终端区域尺寸变化（窗口缩放、拖动侧栏）→ 防抖后只 fit 当前可见的终端
    new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer)
      this.resizeTimer = window.setTimeout(() => this.fitActive(), RESIZE_DEBOUNCE_MS)
    }).observe(host)
  }

  setFontSize(fontSize: number): void {
    this.fontSize = fontSize
    for (const view of this.views.values()) view.setFontSize(fontSize)
  }

  private fitActive(): void {
    const view = this.activeId ? this.views.get(this.activeId) : undefined
    if (view?.fit()) view.syncPtySize()
  }

  has(sessionId: string): boolean {
    return this.views.has(sessionId)
  }

  /** 显示某个会话的终端；还没有实例时创建并启动 PTY。 */
  show(sessionId: string): void {
    this.hideActive()
    this.activeId = sessionId
    const existing = this.views.get(sessionId)
    if (existing) {
      existing.show()
      return
    }
    const view = new TerminalView(sessionId, this.host, this.fontSize, this.hooks)
    this.views.set(sessionId, view)
    view.fit()
    void view.start()
    view.focus()
  }

  hideActive(): void {
    if (this.activeId) this.views.get(this.activeId)?.hide()
    this.activeId = null
  }

  async restart(sessionId: string): Promise<void> {
    await this.views.get(sessionId)?.restart()
  }

  /** 仅供开发期自测使用 */
  debugSnapshot(): Record<string, ReturnType<TerminalView['debugSnapshot']>> {
    const result: Record<string, ReturnType<TerminalView['debugSnapshot']>> = {}
    for (const [id, view] of this.views) result[id] = view.debugSnapshot()
    return result
  }

  dispose(sessionId: string): void {
    const view = this.views.get(sessionId)
    if (!view) return
    view.dispose()
    this.views.delete(sessionId)
    if (this.activeId === sessionId) this.activeId = null
  }
}
