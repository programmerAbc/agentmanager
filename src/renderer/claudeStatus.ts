import type { ClaudeEvent } from '../shared/types'
import { icon } from './icons'
import { loadingIndicator } from './shapes'

/**
 * none：没有通过按钮启动的 claude；starting：已发出启动命令，等待 SessionStart；
 * idle：claude 就绪等待输入；working：正在处理；waiting：等待用户确认；done：本轮已完成（用户尚未查看）
 */
export type ClaudeStatus = 'none' | 'starting' | 'idle' | 'working' | 'waiting' | 'done'

export const STATUS_TEXT: Record<Exclude<ClaudeStatus, 'none'>, string> = {
  starting: '正在启动 Claude…',
  idle: 'Claude 就绪',
  working: 'Claude 工作中…',
  waiting: '等待你的确认',
  done: '已完成'
}

export const ALL_STATUSES: ClaudeStatus[] = ['none', 'starting', 'idle', 'working', 'waiting', 'done']

/** 状态图形：圆点（无 / 就绪）、形状变换加载指示器（启动中 / 工作中）、举手（等待确认）、对勾（已完成） */
export function statusIndicator(status: ClaudeStatus): Element {
  switch (status) {
    case 'starting':
    case 'working':
      return loadingIndicator('loading-indicator')
    case 'waiting':
      return icon('frontHandFill', 'status-icon waiting')
    case 'done':
      return icon('checkCircleFill', 'status-icon done')
    default: {
      const dot = document.createElement('span')
      dot.className = 'status-dot'
      return dot
    }
  }
}

/** 发出启动命令后多久没收到 SessionStart 就认为没启动起来（例如命令写错、claude 未安装） */
const START_TIMEOUT_MS = 30_000

const WAITING_TYPES = new Set(['permission_prompt', 'elicitation_dialog'])

export class ClaudeStatusTracker {
  private readonly statuses = new Map<string, ClaudeStatus>()
  private readonly startTimers = new Map<string, number>()

  constructor(private readonly onChange: (sessionId: string, status: ClaudeStatus) => void) {}

  get(sessionId: string): ClaudeStatus {
    return this.statuses.get(sessionId) ?? 'none'
  }

  markStarting(sessionId: string): void {
    this.set(sessionId, 'starting')
    window.clearTimeout(this.startTimers.get(sessionId))
    this.startTimers.set(
      sessionId,
      window.setTimeout(() => {
        if (this.get(sessionId) === 'starting') this.set(sessionId, 'none')
      }, START_TIMEOUT_MS)
    )
  }

  handleEvent(sessionId: string, event: ClaudeEvent): void {
    const current = this.get(sessionId)
    switch (event.name) {
      case 'SessionStart':
        // /clear、resume、自动压缩也会触发 SessionStart，只在刚启动时切到就绪
        if (current === 'none' || current === 'starting') this.set(sessionId, 'idle')
        break
      case 'UserPromptSubmit':
      case 'PostToolUse':
        this.set(sessionId, 'working')
        break
      case 'Notification':
        if (event.notificationType && WAITING_TYPES.has(event.notificationType)) this.set(sessionId, 'waiting')
        // 用户按 Esc 中断时不会有 Stop，空闲提醒到来时把「工作中」回落为就绪
        else if (event.notificationType === 'idle_prompt' && current === 'working') this.set(sessionId, 'idle')
        break
      case 'Stop':
        this.set(sessionId, 'done')
        break
      case 'SessionEnd':
        this.set(sessionId, 'none')
        break
    }
  }

  /** 用户切换到该项目或在终端里输入：「已完成」视为已查看 */
  markSeen(sessionId: string): void {
    if (this.get(sessionId) === 'done') this.set(sessionId, 'idle')
  }

  /** 终端退出 / 重启 / 移除 */
  reset(sessionId: string): void {
    if (this.get(sessionId) !== 'none') this.set(sessionId, 'none')
  }

  private set(sessionId: string, status: ClaudeStatus): void {
    if (status !== 'starting') {
      window.clearTimeout(this.startTimers.get(sessionId))
      this.startTimers.delete(sessionId)
    }
    if (this.get(sessionId) === status) return
    if (status === 'none') this.statuses.delete(sessionId)
    else this.statuses.set(sessionId, status)
    this.onChange(sessionId, status)
  }
}
