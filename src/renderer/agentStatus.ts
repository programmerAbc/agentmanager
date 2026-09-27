import { AGENT_LABEL, type AgentEvent, type AgentKind } from '../shared/types'
import { icon } from './icons'
import { loadingIndicator } from './shapes'

/**
 * none：没有通过按钮启动的助手；starting：已发出启动命令，等待 SessionStart（仅 claude）；
 * idle：就绪等待输入；working：正在处理；waiting：等待用户确认；done：本轮已完成（用户尚未查看）
 */
export type AgentStatus = 'none' | 'starting' | 'idle' | 'working' | 'waiting' | 'done'

export interface AgentState {
  agent: AgentKind
  status: Exclude<AgentStatus, 'none'>
}

export const ALL_STATUSES: AgentStatus[] = ['none', 'starting', 'idle', 'working', 'waiting', 'done']

export function statusText(state: AgentState): string {
  const name = AGENT_LABEL[state.agent]
  switch (state.status) {
    case 'starting':
      return `正在启动 ${name}…`
    case 'idle':
      return `${name} 就绪`
    case 'working':
      return `${name} 工作中…`
    case 'waiting':
      return `${name} 等待你的确认`
    case 'done':
      return `${name} 已完成`
  }
}

/** 状态图形：圆点（无 / 就绪）、形状变换加载指示器（启动中 / 工作中）、举手（等待确认）、对勾（已完成） */
export function statusIndicator(status: AgentStatus): Element {
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

/** claude 发出启动命令后多久没收到 SessionStart 就认为没启动起来（例如命令写错、未安装） */
const START_TIMEOUT_MS = 30_000

const WAITING_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog'])

/** 每个终端同一时间只跟踪一个助手 */
export class AgentStatusTracker {
  private readonly states = new Map<string, AgentState>()
  private readonly startTimers = new Map<string, number>()

  constructor(private readonly onChange: (sessionId: string, state: AgentState | null) => void) {}

  get(sessionId: string): AgentState | null {
    return this.states.get(sessionId) ?? null
  }

  /**
   * 刚发出启动命令。claude 启动时会触发 SessionStart，先显示「启动中」；
   * codex 的 SessionStart 要到第一轮对话才触发，直接显示「就绪」。
   */
  markLaunched(sessionId: string, agent: AgentKind): void {
    if (agent === 'codex') {
      this.set(sessionId, { agent, status: 'idle' })
      return
    }
    this.set(sessionId, { agent, status: 'starting' })
    window.clearTimeout(this.startTimers.get(sessionId))
    this.startTimers.set(
      sessionId,
      window.setTimeout(() => {
        if (this.get(sessionId)?.status === 'starting') this.set(sessionId, null)
      }, START_TIMEOUT_MS)
    )
  }

  handleEvent(sessionId: string, event: AgentEvent): void {
    const current = this.get(sessionId)
    // 事件来自另一个助手（例如上一个助手退出后没来得及清理），以新事件为准
    const agent = event.agent
    const status = current?.agent === agent ? current.status : 'none'
    const to = (s: AgentState['status']): void => this.set(sessionId, { agent, status: s })
    switch (event.name) {
      case 'SessionStart':
        // claude 的 /clear、resume、自动压缩也会触发 SessionStart，只在刚启动时切到就绪
        if (status === 'none' || status === 'starting') to('idle')
        break
      case 'UserPromptSubmit':
      case 'PostToolUse':
        to('working')
        break
      case 'PermissionRequest':
        to('waiting')
        break
      case 'Notification':
        if (event.notificationType && WAITING_NOTIFICATIONS.has(event.notificationType)) to('waiting')
        // 用户按 Esc 中断时 claude 不会发 Stop，空闲提醒到来时把「工作中」回落为就绪
        else if (event.notificationType === 'idle_prompt' && status === 'working') to('idle')
        break
      case 'Stop':
        to('done')
        break
      case 'SessionEnd':
        if (current?.agent === agent) this.set(sessionId, null)
        break
    }
  }

  /** 用户切换到该项目或在终端里输入：「已完成」视为已查看 */
  markSeen(sessionId: string): void {
    const current = this.get(sessionId)
    if (current?.status === 'done') this.set(sessionId, { agent: current.agent, status: 'idle' })
  }

  /** 终端退出 / 重启 / 移除 */
  reset(sessionId: string): void {
    if (this.states.has(sessionId)) this.set(sessionId, null)
  }

  private set(sessionId: string, state: AgentState | null): void {
    if (state?.status !== 'starting') {
      window.clearTimeout(this.startTimers.get(sessionId))
      this.startTimers.delete(sessionId)
    }
    const current = this.get(sessionId)
    if (current?.agent === state?.agent && current?.status === state?.status) return
    if (state) this.states.set(sessionId, state)
    else this.states.delete(sessionId)
    this.onChange(sessionId, state)
  }
}
