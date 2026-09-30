import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import {
  IPC,
  themeModeOf,
  WINDOW_BACKGROUND,
  type AgentKind,
  type AppInfo,
  type CursorStyle,
  type DataResult,
  type OpResult,
  type Project,
  type SettingsPatch,
  type ShellId,
  type ShellInfo,
  type SidebarGroup
} from '../shared/types'
import type { AgentHookServer } from './hookServer'
import { openLink, openLocalPath, resolveLocalPaths } from './links'
import log from './log'
import { detectShells, type ShellFamily } from './shells'
import type { ProjectStore } from './projectStore'
import type { PtyManager } from './ptyManager'
import type { SettingsStore } from './settingsStore'

export interface IpcDeps {
  projects: ProjectStore
  settings: SettingsStore
  ptys: PtyManager
  hooks: AgentHookServer
}

/** 目前一个项目一个会话，sessionId 就是 projectId。以后支持多会话时只需要改这里。 */
function projectIdOfSession(sessionId: string): string {
  return sessionId
}

export function registerIpc({ projects, settings, ptys, hooks }: IpcDeps): void {
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

  ipcMain.handle(IPC.projectsSetStarred, (_e, id: unknown, starred: unknown) =>
    guard('星标', async () => {
      await projects.setStarred(asString(id), asBoolean(starred))
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
      return ptys.open(sessionId, {
        cwd: project.path,
        cols: asInt(cols),
        rows: asInt(rows),
        shell: settings.get().shell,
        env: hooks.envFor(sessionId)
      })
    } catch (err) {
      log.error('[ipc] pty.open 失败', err)
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(IPC.ptyShells, (): ShellInfo[] => detectShells())

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

  ipcMain.handle(IPC.settingsUpdate, (e, patch: unknown) =>
    guard('保存设置', async () => {
      const parsed = asSettingsPatch(patch)
      await settings.update(parsed)
      if (parsed.themeSeed) {
        BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(WINDOW_BACKGROUND[themeModeOf(parsed.themeSeed)])
      }
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

  // ---------- 终端里的链接（Ctrl+单击） ----------
  ipcMain.handle(IPC.linkOpen, (_e, url: unknown) =>
    guard('打开链接', async () => {
      await openLink(asString(url))
    })
  )

  ipcMain.handle(IPC.linkOpenPath, (_e, target: unknown) =>
    guard('打开文件', async () => {
      await openLocalPath(asString(target))
    })
  )

  ipcMain.handle(IPC.linkResolvePaths, (_e, id: unknown, candidates: unknown): (string | null)[] => {
    if (typeof id !== 'string' || !Array.isArray(candidates)) return []
    const project = projects.get(projectIdOfSession(id))
    if (!project) return candidates.map(() => null)
    // 一行里的候选不会很多；限制数量与长度，非字符串按不存在处理
    const list = candidates.slice(0, 64).map((c) => (typeof c === 'string' && c.length <= 1024 ? c : ''))
    return resolveLocalPaths(project.path, list)
  })

  // ---------- agents ----------
  ipcMain.handle(IPC.agentLaunch, (_e, id: unknown, agent: unknown) =>
    guard('启动助手', async () => {
      const sessionId = asString(id)
      const kind = asAgentKind(agent)
      if (!ptys.has(sessionId)) throw new Error('终端未启动')
      const line = await launchLine(kind, sessionId)
      ptys.write(sessionId, `${line}\r`)
      log.info(`[agents] 启动 ${kind} session=${sessionId}`)
    })
  )

  /**
   * 拼出写进终端的启动命令，写法取决于该终端实际使用的 shell（PowerShell / cmd / bash）。
   * 只有命令确实以 claude / codex 开头、且 hooks 服务可用时才注入 hooks，否则原样执行（没有状态）。
   */
  async function launchLine(kind: AgentKind, sessionId: string): Promise<string> {
    const s = settings.get()
    const family = ptys.shellFamilyOf(sessionId) ?? 'powershell'
    if (kind === 'claude') {
      const command = s.claudeCommand
      if (!hooks.ready || !/^claude(\.exe|\.cmd)?(\s|$)/i.test(command)) return command
      const file = await hooks.writeClaudeSettings(sessionId)
      return `${command} --settings ${quotePath(file, family)}`
    }
    const command = s.codexCommand
    if (!hooks.ready || !/^codex(\.exe|\.cmd|\.ps1)?(\s|$)/i.test(command)) return command
    return hooks.codexLaunchLine(command, family)
  }

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

function asBoolean(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Error('参数类型错误')
  return v
}

function asAgentKind(v: unknown): AgentKind {
  if (v !== 'claude' && v !== 'codex') throw new Error('参数类型错误')
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
  // 取值由 settingsStore 校验
  if (typeof r.cursorStyle === 'string') patch.cursorStyle = r.cursorStyle as CursorStyle
  if (typeof r.shell === 'string') patch.shell = r.shell as ShellId
  if (typeof r.themeSeed === 'string') patch.themeSeed = r.themeSeed
  if (typeof r.claudeCommand === 'string') patch.claudeCommand = r.claudeCommand
  if (typeof r.codexCommand === 'string') patch.codexCommand = r.codexCommand
  if (Array.isArray(r.collapsedGroups)) patch.collapsedGroups = r.collapsedGroups as SidebarGroup[]
  if (typeof r.lastProjectId === 'string' || r.lastProjectId === null) patch.lastProjectId = r.lastProjectId
  return patch
}

/**
 * 把文件路径作为一个命令行参数：
 * - PowerShell / bash 用单引号（不展开 $ 等），内部单引号分别写成 '' / '\''
 * - cmd 不认单引号，用双引号（Windows 路径里不会有双引号）
 */
function quotePath(file: string, family: ShellFamily): string {
  if (family === 'cmd') return `"${file}"`
  if (family === 'bash') return `'${file.replace(/'/g, `'\\''`)}'`
  return `'${file.replace(/'/g, "''")}'`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
