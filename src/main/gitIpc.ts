import { app, ipcMain, type WebContents } from 'electron'
import { IPC, type DataResult, type GitSnapshot, type OpResult } from '../shared/types'
import { GitRepositoryMonitor } from './gitRepositoryMonitor'
import type { ProjectStore } from './projectStore'

/** 一窗口一个当前项目订阅；只接受项目 id，文件路径由主进程数据库决定。 */
export function registerGitIpc(projects: ProjectStore): { removeProject(id: string): void } {
  const subscriptions = new Map<number, GitRepositoryMonitor>()
  const attached = new Set<number>()
  const refreshed = new Map<number, number>()
  const stop = (owner: number): void => {
    subscriptions.get(owner)?.dispose()
    subscriptions.delete(owner)
    refreshed.delete(owner)
  }
  const attach = (sender: WebContents): void => {
    if (attached.has(sender.id)) return
    attached.add(sender.id)
    const cleanup = (): void => stop(sender.id)
    sender.on('did-navigate', cleanup)
    sender.on('render-process-gone', cleanup)
    sender.once('destroyed', () => { cleanup(); attached.delete(sender.id) })
  }
  ipcMain.handle(IPC.gitSubscribe, (event, id: unknown): DataResult<GitSnapshot> => {
    if (typeof id !== 'string') return { ok: false, error: '项目编号不合法' }
    const project = projects.get(id)
    if (!project) return { ok: false, error: '项目不存在' }
    const sender = event.sender
    attach(sender)
    stop(sender.id)
    const monitor = new GitRepositoryMonitor(id, project.path, snapshot => {
      if (!sender.isDestroyed()) sender.send(IPC.gitChanged, snapshot)
    })
    subscriptions.set(sender.id, monitor)
    const initial = monitor.current
    // 返回初始订阅令牌后再启动；renderer 仍按 revision 处理 IPC 到达顺序。
    setImmediate(() => { if (subscriptions.get(sender.id) === monitor) monitor.start() })
    return { ok: true, data: initial }
  })
  ipcMain.handle(IPC.gitUnsubscribe, (event, token: unknown): OpResult => {
    if (subscriptions.get(event.sender.id)?.current.subscriptionId === token) stop(event.sender.id)
    return { ok: true }
  })
  ipcMain.handle(IPC.gitRefresh, (event, token: unknown): OpResult => {
    const monitor = subscriptions.get(event.sender.id)
    if (!monitor || monitor.current.subscriptionId !== token) return { ok: false, error: '仓库订阅已失效' }
    const now = Date.now()
    if (now - (refreshed.get(event.sender.id) ?? 0) >= 1000) {
      refreshed.set(event.sender.id, now)
      monitor.refresh()
    }
    return { ok: true }
  })
  app.on('before-quit', () => { for (const id of subscriptions.keys()) stop(id) })
  return {
    removeProject(id): void {
      for (const [owner, monitor] of subscriptions) if (monitor.current.projectId === id) stop(owner)
    }
  }
}
