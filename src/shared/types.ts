// 主进程、preload、渲染进程共享的类型与常量。
// 这里只能放纯类型和纯数据常量，不能引入 electron / node 模块（渲染进程也会编译它）。

export interface Project {
  id: string // crypto.randomUUID()
  name: string // 默认取目录名，可以重命名
  path: string // 绝对路径
  createdAt: number
  lastOpenedAt?: number
}

export interface ProjectsFile {
  version: 1
  projects: Project[]
}

/** 操作结果。主进程不抛异常给渲染进程，错误通过返回值传递。 */
export type OpResult = { ok: true } | { ok: false; error: string }
export type DataResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface AppSettings {
  sidebarWidth: number
  fontSize: number
  lastProjectId: string | null
  window: WindowState | null
}

export interface SettingsFile extends AppSettings {
  version: 1
}

/** 渲染进程允许修改的设置项；窗口状态由主进程自己维护。 */
export type SettingsPatch = Partial<Pick<AppSettings, 'sidebarWidth' | 'fontSize' | 'lastProjectId'>>

export const SIDEBAR_WIDTH = { default: 240, min: 180, max: 400 } as const
export const FONT_SIZE = { default: 14, min: 8, max: 32 } as const

export interface ConfirmOptions {
  message: string
  detail?: string
  okLabel?: string
}

/** IPC 通道名，全部集中在这里。 */
export const IPC = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsRename: 'projects:rename',
  projectsRemove: 'projects:remove',
  projectsTouch: 'projects:touch',
  projectsOpenInExplorer: 'projects:open-in-explorer',
  ptyOpen: 'pty:open',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  clipboardReadText: 'clipboard:read-text',
  clipboardWriteText: 'clipboard:write-text',
  shellOpenExternal: 'shell:open-external',
  dialogConfirm: 'dialog:confirm'
} as const

/**
 * preload 通过 contextBridge 暴露的 window.api。
 *
 * pty.* 的 id 是 sessionId。目前一个项目只有一个会话，sessionId === projectId；
 * 以后一个项目支持多个会话时，只需要改 ipc 层的 sessionId → 项目 映射。
 */
export interface Api {
  system: {
    /** Windows 内部版本号（例如 26200），用于 xterm 的 windowsPty 配置 */
    windowsBuild: number
  }
  projects: {
    list(): Promise<Project[]>
    /** 用户取消时 data 为 null；同一路径已存在时返回已有项目 */
    add(): Promise<DataResult<Project | null>>
    rename(id: string, name: string): Promise<OpResult>
    remove(id: string): Promise<OpResult>
    touch(id: string): Promise<OpResult>
    openInExplorer(id: string): Promise<OpResult>
  }
  pty: {
    open(id: string, cols: number, rows: number): Promise<OpResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<OpResult>
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: SettingsPatch): Promise<OpResult>
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  shell: {
    openExternal(url: string): Promise<OpResult>
  }
  dialog: {
    confirm(options: ConfirmOptions): Promise<boolean>
  }
}
