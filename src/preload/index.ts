import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type Api } from '../shared/types'

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
    openInExplorer: (id) => ipcRenderer.invoke(IPC.projectsOpenInExplorer, id)
  },
  pty: {
    open: (id, cols, rows) => ipcRenderer.invoke(IPC.ptyOpen, id, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id) => ipcRenderer.invoke(IPC.ptyKill, id),
    onData: (cb) => subscribe<[string, string]>(IPC.ptyData, cb),
    onExit: (cb) => subscribe<[string, number]>(IPC.ptyExit, cb)
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
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openDir: (kind) => ipcRenderer.invoke(IPC.appOpenDir, kind)
  }
}

contextBridge.exposeInMainWorld('api', api)
