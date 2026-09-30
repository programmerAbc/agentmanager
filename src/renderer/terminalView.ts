import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITerminalOptions, type ITheme } from '@xterm/xterm'
import type { CursorStyle, OpResult } from '../shared/types'
import { PathLinkProvider } from './pathLinks'
import { showContextMenu } from './contextMenu'

const api = window.api

const RESIZE_DEBOUNCE_MS = 50

/**
 * Shift / Ctrl / Alt + Enter 发给 PTY 的「换行」按键。
 * xterm.js 对 Shift/Ctrl+Enter 只发 "\r"（与 Enter 相同，claude / codex 会直接提交），Alt+Enter 发 ESC CR（codex 不认）。
 * 这里改发 win32-input-mode 格式的 Shift+Enter（按下 + 抬起，字符为 LF），ConPTY 会还原成一条
 * VK_RETURN + SHIFT、字符 '\n' 的控制台按键记录（实测，见 docs/architecture.md）：
 * - codex（crossterm 按虚拟键码读记录）与 PowerShell / PSReadLine（Console.ReadKey）看到 Shift+Enter → 换行
 * - claude（Node / libuv 只取字符）收到 "\n"，即 Ctrl+J → 换行
 * 未验证过的较老 Windows（build < 22000）退回只发 "\n"。
 */
const WIN32_INPUT_KEYS = api.system.windowsBuild >= 22000
const NEWLINE_KEY = WIN32_INPUT_KEYS ? '\x1b[13;28;10;1;16;1_\x1b[13;28;10;0;16;1_' : '\n'

/**
 * win32-input-mode 格式的 Esc（按下 + 抬起，VK_ESCAPE）。
 * ConPTY 一旦收到过 win32-input-mode 序列（即发过 NEWLINE_KEY），就认为终端会把所有按键都这样发，
 * 此后单独的 ESC 会被当成未完成序列的开头吞掉（实测），Esc / Ctrl+[ 失效。所以那之后 Esc 改用这个格式发送。
 */
const ESC_KEY = '\x1b[27;1;27;1;0;1_\x1b[27;1;27;0;0;1_'

/**
 * xterm 替程序自动发送的上报序列，不是用户输入：焦点上报 ESC[I / ESC[O（DECSET 1004），
 * 鼠标上报 SGR ESC[<b;x;yM/m 与 URXVT ESC[b;x;yM（程序开启鼠标跟踪时，滚轮 / 点击都会产生）
 */
const REPORT_SEQUENCE = /^\x1b\[(?:[IO]|<\d+;\d+;\d+[Mm]|\d+;\d+;\d+M)$/

/** 终端输出静止多久后，光标位置才算落定（程序重绘一帧的中间状态一般只停留一两个 ConPTY 刷新周期） */
const OUTPUT_SETTLE_MS = 50
/** 输出一直不停时，组字位置最多推迟这么久也要更新一次 */
const COMPOSITION_MAX_DEFER_MS = 400

/** xterm 6 内部的组字助手（私有 API，只用来稳定输入法组字位置；结构不符时不包装） */
interface XtermCompositionHelper {
  readonly isComposing: boolean
  updateCompositionElements(dontRecurse?: boolean): void
  _compositionView: HTMLElement
  _textarea: HTMLTextAreaElement
}

/** Shift / Ctrl / Alt + Enter（输入法组字时的 Enter 交给输入法） */
function isNewlineKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.altKey) && !e.metaKey && !e.isComposing && e.keyCode !== 229
  )
}

/** 终端外观，全部终端共用；任一字段变化都会重新 fit */
export interface TerminalAppearance {
  /** 完整的 CSS font-family 字体栈 */
  fontFamily: string
  fontSize: number
  lineHeight: number
  theme: ITheme
  minimumContrastRatio: number
  cursorStyle: CursorStyle
}

/** 光标样式对应的 xterm 选项；失焦时保持同一形状（xterm 默认失焦画空心方块） */
function cursorOptions(style: CursorStyle): Pick<ITerminalOptions, 'cursorStyle' | 'cursorInactiveStyle' | 'cursorWidth'> {
  return {
    cursorStyle: style,
    cursorInactiveStyle: style === 'block' ? 'outline' : style,
    // 竖线用 2px，1px 在高 DPI 下太细
    cursorWidth: 2
  }
}

export type ZoomAction = 'in' | 'out' | 'reset'

/** 应用级快捷键（Ctrl+, 打开设置），终端里不发给 PTY */
export function isSettingsShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.key === ',' || e.code === 'Comma')
}

/** 应用级快捷键（Ctrl+Shift+F 搜索项目），终端里不发给 PTY */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && letterOf(e) === 'f'
}

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

/**
 * idle: 还没启动 PTY；starting: pty.open 进行中；running: PTY 运行中；
 * exited: PTY 已退出（按 Enter 重启）；failed: 启动失败（按 Enter 重试）
 */
type ViewState = 'idle' | 'starting' | 'running' | 'exited' | 'failed'

export interface TerminalHooks {
  onRunningChange(sessionId: string, running: boolean): void
  /** 用户向运行中的终端输入（不含焦点 / 鼠标上报）；data 为发给 PTY 的内容 */
  onInput(sessionId: string, data: string): void
  onError(message: string): void
}

/** 一个项目的终端：一个 xterm 实例 + 它的 DOM 容器。切换项目时只切换容器可见性，不 dispose。 */
class TerminalView {
  readonly pane: HTMLDivElement
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private webgl: WebglAddon | null = null
  private state: ViewState = 'idle'
  private startPromise: Promise<void> = Promise.resolve()
  private disposed = false
  /** 当前 PTY 是否已收到过 win32-input-mode 序列（见 ESC_KEY）；ConPTY 的这个状态直到 PTY 结束都不会恢复 */
  private win32InputSent = false
  /** 最近一次输出解析完成的时间（performance.now()），用于判断光标是否已落定 */
  private lastOutputAt = 0
  /** 是否已包装 xterm 的组字定位（见 stabilizeComposition） */
  private compositionStabilized = false

  constructor(
    readonly sessionId: string,
    host: HTMLElement,
    appearance: TerminalAppearance,
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
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      lineHeight: appearance.lineHeight,
      scrollback: 10000,
      cursorBlink: true,
      ...cursorOptions(appearance.cursorStyle),
      allowProposedApi: true,
      theme: appearance.theme,
      minimumContrastRatio: appearance.minimumContrastRatio,
      windowsPty: { backend: 'conpty', buildNumber: api.system.windowsBuild },
      // 程序输出的 OSC 8 超链接（claude 的「[Image #N]」、文件引用是 file:// 链接），协议由主进程按白名单处理
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (event, uri) => this.activateLink(event, () => api.links.open(uri)),
        hover: (_event, uri) => this.showLinkHint(uri),
        leave: () => this.hideLinkHint()
      }
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    // 文本里的网址
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => this.activateLink(event, () => api.links.open(uri)), {
        hover: (_event, uri) => this.showLinkHint(uri),
        leave: () => this.hideLinkHint()
      })
    )
    // 文本里的本机文件路径（codex 等不输出超链接的程序）
    this.term.registerLinkProvider(
      new PathLinkProvider(this.term, sessionId, {
        open: (event, target) => this.activateLink(event, () => api.links.openPath(target)),
        hover: (target) => this.showLinkHint(target),
        leave: () => this.hideLinkHint()
      })
    )
    this.term.open(mount)
    this.loadWebgl()
    this.stabilizeComposition()

    this.term.onData((data) => this.handleInput(data))
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e))
    this.pane.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showContextMenu(e.clientX, e.clientY, [
        {
          label: '复制',
          icon: 'contentCopy',
          disabled: !this.term.hasSelection(),
          action: () => this.copySelection(false)
        },
        { label: '粘贴', icon: 'contentPaste', action: () => void this.pasteFromClipboard() }
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

  start(): Promise<void> {
    if (this.state === 'running') return Promise.resolve()
    if (this.state !== 'starting') this.startPromise = this.doStart()
    return this.startPromise
  }

  /** 保证 PTY 在运行：已退出 / 启动失败时清屏重启；返回是否在运行 */
  async ensureRunning(): Promise<boolean> {
    if (this.state === 'exited' || this.state === 'failed') this.term.reset()
    await this.start()
    return this.state === 'running'
  }

  private async doStart(): Promise<void> {
    this.setState('starting')
    this.fit()
    const result = await api.pty.open(this.sessionId, this.term.cols, this.term.rows)
    if (this.disposed) return
    if (result.ok) {
      this.win32InputSent = false
      this.setState('running')
      // pty.open 期间窗口尺寸可能变过
      this.syncPtySize()
    } else {
      this.setState('failed')
      this.term.write(`\x1b[31m${result.error}\x1b[0m\r\n\x1b[90m按 Enter 重试\x1b[0m\r\n`)
      this.hooks.onError(result.error)
    }
  }

  /**
   * 「结束终端」：销毁 xterm 并结束 PTY 及其进程树。
   * pty.open 进行中时也照常 kill：open 已先发出，主进程按顺序处理 IPC，kill 时会话已经创建。
   */
  end(): void {
    this.setState('idle')
    this.dispose()
    void api.pty.kill(this.sessionId).then((result) => {
      if (!result.ok) this.hooks.onError(result.error)
    })
  }

  write(data: string): void {
    this.term.write(data, () => {
      this.lastOutputAt = performance.now()
    })
  }

  /**
   * 输入法组字时，xterm 每次渲染都把组字框和隐藏输入框移到光标处。claude 等程序重绘一帧的中途，光标会临时停在别处
   * （例如画满整行分隔线后停在最右列），组字框和候选窗就跟着乱跳，隐藏输入框超出右边缘时还会引起画面横移。
   * 这里改为：输出静止 OUTPUT_SETTLE_MS 后才按光标定位（最多推迟 COMPOSITION_MAX_DEFER_MS），并把超出右边缘的组字框收回。
   */
  private stabilizeComposition(): void {
    const core = (this.term as unknown as { _core?: { _compositionHelper?: Partial<XtermCompositionHelper> } })._core
    const helper = core?._compositionHelper
    const original = helper?.updateCompositionElements
    if (!helper || typeof original !== 'function' || !helper._compositionView || !helper._textarea) {
      console.warn('[terminal] xterm 内部结构已变化，未启用输入法组字位置稳定')
      return
    }
    const h = helper as XtermCompositionHelper
    this.compositionStabilized = true
    let timer: number | undefined
    let deferredSince = 0
    /** 本次组字是否已经定位过：第一次不推迟，否则组字框会先出现在上一次组字的位置 */
    let placed = false
    h._textarea.addEventListener('compositionstart', () => {
      placed = false
    })
    h.updateCompositionElements = (dontRecurse?: boolean): void => {
      window.clearTimeout(timer)
      if (!h.isComposing) {
        deferredSince = 0
        return
      }
      const now = performance.now()
      const wait = this.lastOutputAt + OUTPUT_SETTLE_MS - now
      if (placed && wait > 0) {
        if (deferredSince === 0) deferredSince = now
        if (now - deferredSince < COMPOSITION_MAX_DEFER_MS) {
          timer = window.setTimeout(() => {
            if (!this.disposed) h.updateCompositionElements(dontRecurse)
          }, wait)
          return
        }
      }
      deferredSince = 0
      placed = true
      original.call(h, dontRecurse)
      this.keepCompositionInside(h)
    }
  }

  /** 光标就在右边缘时（长行末尾），把组字框和隐藏输入框左移到刚好放下，组字文字仍然可见 */
  private keepCompositionInside(h: XtermCompositionHelper): void {
    const screen = this.term.element?.querySelector<HTMLElement>('.xterm-screen')
    const view = h._compositionView
    if (!screen || !view.style.left) return
    const left = parseFloat(view.style.left)
    const overflow = left + view.offsetWidth - screen.clientWidth
    if (overflow <= 0) return
    const fixed = `${Math.max(0, left - overflow)}px`
    view.style.left = fixed
    h._textarea.style.left = fixed
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
  debugSnapshot(): {
    state: ViewState
    cols: number
    rows: number
    visible: boolean
    webgl: boolean
    text: string
    /** 视口第一行在缓冲区中的行号（用来把文本位置换算成屏幕坐标） */
    viewportY: number
    /** 链接悬浮提示（终端容器的 title） */
    hint: string
    /** 输入法组字位置稳定是否生效；距最近一次输出的毫秒数；光标位置 */
    ime: { stabilized: boolean; msSinceOutput: number; cursor: string }
  } {
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
      text: lines.join('\n'),
      viewportY: buffer.viewportY,
      hint: this.pane.title,
      ime: {
        stabilized: this.compositionStabilized,
        msSinceOutput: Math.round(performance.now() - this.lastOutputAt),
        cursor: `${buffer.cursorX},${buffer.cursorY}`
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.webgl?.dispose()
    this.webgl = null
    this.term.dispose()
    this.pane.remove()
  }

  setAppearance(appearance: TerminalAppearance): void {
    const o = this.term.options
    if (o.fontFamily !== appearance.fontFamily) o.fontFamily = appearance.fontFamily
    if (o.fontSize !== appearance.fontSize) o.fontSize = appearance.fontSize
    if (o.lineHeight !== appearance.lineHeight) o.lineHeight = appearance.lineHeight
    if (o.theme !== appearance.theme) o.theme = appearance.theme
    if (o.minimumContrastRatio !== appearance.minimumContrastRatio) {
      o.minimumContrastRatio = appearance.minimumContrastRatio
    }
    if (o.cursorStyle !== appearance.cursorStyle) Object.assign(o, cursorOptions(appearance.cursorStyle))
    // 隐藏的终端等下次显示时再 fit
    if (this.fit()) this.syncPtySize()
  }

  /**
   * 复制 / 粘贴快捷键，只处理 keydown：
   * - Ctrl+C：有选区时复制并清除选区；没有选区时照常发给 PTY（中断信号）
   * - Ctrl+Shift+C：始终复制
   * - Ctrl+V / Ctrl+Shift+V：通过 term.paste() 粘贴，保证 bracketed paste 生效
   * - Ctrl+= / Ctrl+- / Ctrl+0、Ctrl+,、Ctrl+Shift+F：应用快捷键由全局监听处理，这里只阻止它们发给 PTY
   * - Shift / Ctrl / Alt + Enter：发送换行按键（见 NEWLINE_KEY）
   * 返回 false 表示 xterm 不再处理该按键。
   */
  private handleKey(e: KeyboardEvent): boolean {
    if (isNewlineKey(e)) {
      // keydown 时发送并阻止默认行为：否则 Shift+Enter 还会产生 keypress，被 xterm 当成 "\r" 再发一次；
      // Alt+Enter 在 Windows 上还会响系统提示音
      if (e.type === 'keydown') {
        e.preventDefault()
        this.handleInput(NEWLINE_KEY)
      }
      return false
    }
    if (e.type !== 'keydown') return true
    if (!e.ctrlKey || e.altKey || e.metaKey) return true
    if (zoomActionOf(e) || isSettingsShortcut(e) || isSearchShortcut(e)) return false
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

  /** 与 VS Code 一致：Ctrl（macOS 为 Cmd）+ 单击才打开链接，普通单击留给选择文本和程序自己的鼠标操作 */
  private activateLink(event: MouseEvent, open: () => Promise<OpResult>): void {
    if (!event.ctrlKey && !event.metaKey) return
    void open().then((r) => {
      if (!r.ok) this.hooks.onError(r.error)
    })
  }

  private showLinkHint(target: string): void {
    this.pane.title = `${target}\n按住 Ctrl 单击打开`
  }

  private hideLinkHint(): void {
    this.pane.title = ''
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
      if (data === NEWLINE_KEY && WIN32_INPUT_KEYS) this.win32InputSent = true
      else if (data === '\x1b' && this.win32InputSent) data = ESC_KEY
      api.pty.write(this.sessionId, data)
      if (!REPORT_SEQUENCE.test(data)) this.hooks.onInput(this.sessionId, data)
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
    private appearance: TerminalAppearance,
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

  setAppearance(patch: Partial<TerminalAppearance>): void {
    this.appearance = { ...this.appearance, ...patch }
    for (const view of this.views.values()) view.setAppearance(this.appearance)
  }

  /**
   * 确保会话的终端已显示且 PTY 在运行（没有实例则创建，已退出 / 启动失败则重新启动）。
   * 返回 PTY 是否在运行。
   */
  async ensureRunning(sessionId: string): Promise<boolean> {
    if (this.activeId !== sessionId || !this.views.has(sessionId)) this.show(sessionId)
    const view = this.views.get(sessionId)
    return view ? view.ensureRunning() : false
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
    const view = new TerminalView(sessionId, this.host, this.appearance, this.hooks)
    this.views.set(sessionId, view)
    view.fit()
    void view.start()
    view.focus()
  }

  focus(sessionId: string): void {
    this.views.get(sessionId)?.focus()
  }

  hideActive(): void {
    if (this.activeId) this.views.get(this.activeId)?.hide()
    this.activeId = null
  }

  /** 结束会话的终端（见 TerminalView.end），该会话回到「未启动」 */
  end(sessionId: string): void {
    this.take(sessionId)?.end()
  }

  /** 仅供开发期自测使用 */
  debugSnapshot(): Record<string, ReturnType<TerminalView['debugSnapshot']>> {
    const result: Record<string, ReturnType<TerminalView['debugSnapshot']>> = {}
    for (const [id, view] of this.views) result[id] = view.debugSnapshot()
    return result
  }

  dispose(sessionId: string): void {
    this.take(sessionId)?.dispose()
  }

  /** 从管理器中摘除视图，之后到达的 PTY 输出 / 退出事件会被丢弃 */
  private take(sessionId: string): TerminalView | undefined {
    const view = this.views.get(sessionId)
    this.views.delete(sessionId)
    if (this.activeId === sessionId) this.activeId = null
    return view
  }
}
