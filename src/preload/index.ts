import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AgentEvent, type AgentDashboard, type Api } from '../shared/types'

// 沙箱 preload：只能用 electron 的少数模块，其余能力全部经 IPC 由主进程提供

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

function windowsBuild(): number {
  // process.getSystemVersion() 在 Windows 上形如 "10.0.26200"
  const build = Number(process.getSystemVersion().split('.')[2])
  return Number.isInteger(build) ? build : 0
}

const api: Api = {
  system: {
    windowsBuild: windowsBuild()
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    add: () => ipcRenderer.invoke(IPC.projectsAdd),
    rename: (id, name) => ipcRenderer.invoke(IPC.projectsRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.projectsRemove, id),
    touch: (id) => ipcRenderer.invoke(IPC.projectsTouch, id),
    setStarred: (id, starred) => ipcRenderer.invoke(IPC.projectsSetStarred, id, starred),
    openInExplorer: (id) => ipcRenderer.invoke(IPC.projectsOpenInExplorer, id)
  },
  pty: {
    open: (id, cols, rows) => ipcRenderer.invoke(IPC.ptyOpen, id, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id) => ipcRenderer.invoke(IPC.ptyKill, id),
    onData: (cb) => subscribe<[string, string]>(IPC.ptyData, cb),
    onExit: (cb) => subscribe<[string, number]>(IPC.ptyExit, cb),
    shells: () => ipcRenderer.invoke(IPC.ptyShells)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardReadText),
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url)
  },
  links: {
    open: (url) => ipcRenderer.invoke(IPC.linkOpen, url),
    openPath: (target) => ipcRenderer.invoke(IPC.linkOpenPath, target),
    resolvePaths: (sessionId, candidates) => ipcRenderer.invoke(IPC.linkResolvePaths, sessionId, candidates)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openDir: (kind) => ipcRenderer.invoke(IPC.appOpenDir, kind)
  },
  agents: {
    launch: (sessionId, agent) => ipcRenderer.invoke(IPC.agentLaunch, sessionId, agent),
    onEvent: (cb) => subscribe<[string, AgentEvent]>(IPC.agentEvent, cb)
  },
  dashboard: {
    get: (id) => ipcRenderer.invoke(IPC.dashboardGet, id),
    onUpdate: (cb) => subscribe<[string, AgentDashboard | null]>(IPC.dashboardUpdate, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
