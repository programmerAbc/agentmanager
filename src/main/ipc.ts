import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { IPC, type AppInfo, type DataResult, type OpResult, type Project, type SettingsPatch } from '../shared/types'
import log from './log'
import type { ProjectStore } from './projectStore'
import type { PtyManager } from './ptyManager'
import type { SettingsStore } from './settingsStore'

export interface IpcDeps {
  projects: ProjectStore
  settings: SettingsStore
  ptys: PtyManager
}

/** 目前一个项目一个会话，sessionId 就是 projectId。以后支持多会话时只需要改这里。 */
function projectIdOfSession(sessionId: string): string {
  return sessionId
}

export function registerIpc({ projects, settings, ptys }: IpcDeps): void {
  // ---------- projects ----------
  ipcMain.handle(IPC.projectsList, (): Project[] => projects.list())

  ipcMain.handle(IPC.projectsAdd, (event) =>
    guardData('添加项目', async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { title: '选择项目目录', properties: ['openDirectory'] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const dir = result.filePaths[0]
      if (result.canceled || !dir) return null
      return projects.add(dir)
    })
  )

  ipcMain.handle(IPC.projectsRename, (_e, id: unknown, name: unknown) =>
    guard('重命名', async () => {
      await projects.rename(asString(id), asString(name))
    })
  )

  ipcMain.handle(IPC.projectsRemove, (_e, id: unknown) =>
    guard('移除项目', async () => {
      const projectId = asString(id)
      // 当前 sessionId === projectId；有多会话后这里要杀掉该项目的所有会话
      await ptys.kill(projectId)
      await projects.remove(projectId)
    })
  )

  ipcMain.handle(IPC.projectsTouch, (_e, id: unknown) =>
    guard('更新打开时间', async () => {
      await projects.touch(asString(id))
    })
  )

  ipcMain.handle(IPC.projectsOpenInExplorer, (_e, id: unknown) =>
    guard('打开目录', async () => {
      const project = projects.get(asString(id))
      if (!project) throw new Error('项目不存在')
      const error = await shell.openPath(project.path)
      if (error) throw new Error(error)
    })
  )

  // ---------- pty ----------
  ipcMain.handle(IPC.ptyOpen, (_e, id: unknown, cols: unknown, rows: unknown): OpResult => {
    try {
      const sessionId = asString(id)
      const project = projects.get(projectIdOfSession(sessionId))
      if (!project) return { ok: false, error: '项目不存在' }
      return ptys.open(sessionId, { cwd: project.path, cols: asInt(cols), rows: asInt(rows) })
    } catch (err) {
      log.error('[ipc] pty.open 失败', err)
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.on(IPC.ptyWrite, (_e, id: unknown, data: unknown) => {
    if (typeof id === 'string' && typeof data === 'string') ptys.write(id, data)
  })

  ipcMain.on(IPC.ptyResize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === 'string' && isPositiveInt(cols) && isPositiveInt(rows)) ptys.resize(id, cols, rows)
  })

  ipcMain.handle(IPC.ptyKill, (_e, id: unknown) =>
    guard('结束终端', async () => {
      await ptys.kill(asString(id))
    })
  )

  // ---------- settings ----------
  ipcMain.handle(IPC.settingsGet, () => settings.get())

  ipcMain.handle(IPC.settingsUpdate, (_e, patch: unknown) =>
    guard('保存设置', async () => {
      await settings.update(asSettingsPatch(patch))
    })
  )

  // ---------- clipboard / shell / dialog ----------
  ipcMain.handle(IPC.clipboardReadText, () => clipboard.readText())

  ipcMain.handle(IPC.clipboardWriteText, (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })

  ipcMain.handle(IPC.shellOpenExternal, (_e, url: unknown) =>
    guard('打开链接', async () => {
      const parsed = new URL(asString(url))
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`不支持的链接：${parsed.protocol}`)
      }
      await shell.openExternal(parsed.toString())
    })
  )

  // ---------- app ----------
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    os: `Windows ${os.release()} (${os.arch()})`,
    userDataDir: app.getPath('userData'),
    logsDir: logsDir()
  }))

  ipcMain.handle(IPC.appOpenDir, (_e, kind: unknown) =>
    guard('打开目录', async () => {
      const dir = kind === 'logs' ? logsDir() : app.getPath('userData')
      const error = await shell.openPath(dir)
      if (error) throw new Error(error)
    })
  )
}

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

async function guard(action: string, fn: () => Promise<void>): Promise<OpResult> {
  try {
    await fn()
    return { ok: true }
  } catch (err) {
    log.error(`[ipc] ${action}失败`, err)
    return { ok: false, error: `${action}失败：${errorMessage(err)}` }
  }
}

async function guardData<T>(action: string, fn: () => Promise<T>): Promise<DataResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    log.error(`[ipc] ${action}失败`, err)
    return { ok: false, error: `${action}失败：${errorMessage(err)}` }
  }
}

// ---------- IPC 边界上的参数校验 ----------

function asString(v: unknown): string {
  if (typeof v !== 'string') throw new Error('参数类型错误')
  return v
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function asInt(v: unknown): number {
  if (!isPositiveInt(v)) throw new Error('参数类型错误')
  return v
}

/** 只挑出类型正确的字段；取值范围与格式由 SettingsStore 校验 */
function asSettingsPatch(v: unknown): SettingsPatch {
  if (typeof v !== 'object' || v === null) throw new Error('参数类型错误')
  const r = v as Record<string, unknown>
  const patch: SettingsPatch = {}
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (num(r.sidebarWidth)) patch.sidebarWidth = r.sidebarWidth
  if (num(r.fontSize)) patch.fontSize = r.fontSize
  if (num(r.lineHeight)) patch.lineHeight = r.lineHeight
  if (typeof r.fontFamily === 'string') patch.fontFamily = r.fontFamily
  if (typeof r.themeSeed === 'string') patch.themeSeed = r.themeSeed
  if (typeof r.claudeCommand === 'string') patch.claudeCommand = r.claudeCommand
  if (typeof r.lastProjectId === 'string' || r.lastProjectId === null) patch.lastProjectId = r.lastProjectId
  return patch
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
