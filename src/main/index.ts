import { app, BrowserWindow, dialog, Menu, screen, type Rectangle } from 'electron'
import path from 'node:path'
import { IPC, type WindowState } from '../shared/types'
import { ClaudeHookServer } from './hookServer'
import { registerIpc } from './ipc'
import log from './log'
import { ProjectStore } from './projectStore'
import { PtyManager } from './ptyManager'
import { SettingsStore } from './settingsStore'

const QUIT_CLEANUP_TIMEOUT_MS = 2000
const DEFAULT_SIZE = { width: 1280, height: 800 }
const MIN_SIZE = { width: 720, height: 480 }

let mainWindow: BrowserWindow | null = null
let quitConfirmed = false
let cleanedUp = false

const userData = app.getPath('userData')
const projects = new ProjectStore(path.join(userData, 'agent-desk.db'), path.join(userData, 'projects.json'))
const settings = new SettingsStore(path.join(userData, 'settings.json'))
const ptys = new PtyManager(
  (sessionId, data) => sendToRenderer(IPC.ptyData, sessionId, data),
  (sessionId, exitCode) => sendToRenderer(IPC.ptyExit, sessionId, exitCode)
)
const hooks = new ClaudeHookServer(path.join(userData, 'claude-hooks'), (sessionId, event) =>
  sendToRenderer(IPC.claudeEvent, sessionId, event)
)

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function createWindow(): BrowserWindow {
  const saved = settings.get().window
  const initialBounds = restoreBounds(saved)
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'Agent Desk',
    backgroundColor: '#181818',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const getNormalBounds = trackNormalBounds(win, initialBounds)
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // 只允许加载应用自己的页面（允许重新加载当前页，dev 下 Vite 整页刷新需要）；
  // 链接一律通过 shell.openExternal 打开
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (stripHash(url) !== stripHash(win.webContents.getURL())) event.preventDefault()
  })

  // 渲染进程重新加载（导航已提交）或崩溃后，旧的 xterm 实例已经没了，对应的 PTY 也一并清理。
  // 不用 did-start-navigation：它在导航可能被取消之前就触发。
  win.webContents.on('did-navigate', () => {
    if (ptys.size > 0) {
      log.info('[app] 渲染进程重新加载，清理全部 PTY')
      void ptys.killAll(QUIT_CLEANUP_TIMEOUT_MS)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[app] 渲染进程退出 reason=${details.reason}`)
    void ptys.killAll(QUIT_CLEANUP_TIMEOUT_MS)
  })

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  win.on('close', (event) => {
    saveWindowState(win, getNormalBounds())
    if (quitConfirmed || ptys.size === 0) return
    event.preventDefault()
    void confirmQuit(win)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))

  return win
}

async function confirmQuit(win: BrowserWindow): Promise<void> {
  const count = ptys.size
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Agent Desk',
    message: `有 ${count} 个终端仍在运行，确定退出？`,
    detail: '退出会结束这些终端以及其中运行的所有进程。',
    buttons: ['退出', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (response === 0) {
    quitConfirmed = true
    win.close()
  }
}

function saveWindowState(win: BrowserWindow, normalBounds: Rectangle): void {
  const state: WindowState = { ...normalBounds, maximized: win.isMaximized() }
  settings.setWindowState(state).catch(() => undefined)
}

/**
 * 自己跟踪窗口在「普通状态」下的位置和尺寸。
 * 高 DPI 下最大化窗口的 getNormalBounds() 不精确，每次重启都会漂移几个像素，
 * 所以只在窗口处于普通状态时通过 resize/move 事件记录，初始值取恢复时使用的值。
 */
function trackNormalBounds(win: BrowserWindow, initial: Partial<Rectangle>): () => Rectangle {
  let bounds: Rectangle | null =
    initial.x !== undefined && initial.y !== undefined && initial.width && initial.height
      ? { x: initial.x, y: initial.y, width: initial.width, height: initial.height }
      : null
  const update = (): void => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) bounds = win.getBounds()
  }
  win.on('resize', update)
  win.on('move', update)
  return () => bounds ?? win.getNormalBounds()
}

/** 恢复上次的窗口位置；如果那块区域已经不在任何显示器上（比如拔了副屏），就只保留大小 */
function restoreBounds(saved: WindowState | null): Partial<Rectangle> {
  if (!saved) return { ...DEFAULT_SIZE }
  const width = Math.max(MIN_SIZE.width, saved.width)
  const height = Math.max(MIN_SIZE.height, saved.height)
  if (saved.x === undefined || saved.y === undefined) return { width, height }
  const rect = { x: saved.x, y: saved.y, width, height }
  const visible = screen.getAllDisplays().some((d) => overlapArea(d.workArea, rect) >= 100 * 100)
  return visible ? rect : { width, height }
}

function stripHash(url: string): string {
  const i = url.indexOf('#')
  return i < 0 ? url : url.slice(0, i)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function overlapArea(a: Rectangle, b: Rectangle): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // 退出前清理所有 PTY（含进程树）并等待配置落盘，最多等 2 秒
  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    const started = Date.now()
    const cleanup = Promise.all([ptys.killAll(QUIT_CLEANUP_TIMEOUT_MS), settings.flush()])
    void Promise.race([cleanup, delay(QUIT_CLEANUP_TIMEOUT_MS)])
      .catch((err: unknown) => log.error('[app] 退出清理失败', err))
      .finally(() => {
        cleanedUp = true
        hooks.stop()
        projects.close()
        log.info(`[app] 退出清理完成 用时 ${Date.now() - started}ms`)
        app.quit()
      })
  })

  app.on('window-all-closed', () => app.quit())

  app
    .whenReady()
    .then(async () => {
      log.info(`[app] 启动 version=${app.getVersion()} electron=${process.versions.electron}`)
      // 使用系统原生标题栏，但不需要菜单栏（也去掉默认菜单的 Ctrl+=/- 页面缩放快捷键）
      Menu.setApplicationMenu(null)
      await Promise.all([projects.load(), settings.load()])
      // 状态服务启动失败不影响终端功能，只是没有 Claude 状态
      await hooks.start().catch((err: unknown) => log.error('[claude] hooks 服务启动失败', err))
      registerIpc({ projects, settings, ptys, hooks })
      mainWindow = createWindow()
    })
    .catch((err: unknown) => {
      log.error('[app] 启动失败', err)
      app.quit()
    })
}

main()
