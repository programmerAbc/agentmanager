import type { AgentDashboard, AgentKind, AgentLimit } from '../shared/types'

export type Json = Record<string, unknown>
export function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 4096 ? value.trim() : null
}
export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
const percent = (v: number): number => Math.min(100, Math.max(0, v))

export function emptyDashboard(agent: AgentKind): AgentDashboard {
  return { agent, sessionId: null, title: null, cwd: null, model: null, effort: null, fast: null,
    permission: null, permissionDetail: null, context: null,
    limits: { primary: null, secondary: null }, cost: null, git: null, updatedAt: null, usageUpdatedAt: null }
}

export function permissionMode(value: unknown): string | null {
  const raw = text(value)
  return raw ? ({ default: '默认权限', plan: '计划模式', acceptEdits: '接受编辑', auto: '自动审批',
    dontAsk: '不询问', bypassPermissions: '跳过权限确认' } as Record<string, string>)[raw] ?? raw : null
}

function limit(raw: unknown, minutes?: number): AgentLimit | null {
  const r = object(raw)
  const used = number(r.used_percent ?? r.used_percentage)
  const window = number(r.window_minutes ?? r.window_duration_mins) ?? minutes
  return used !== null && window !== undefined && window > 0
    ? { usedPercent: percent(used), windowMinutes: window, resetsAt: number(r.resets_at) } : null
}

export function applyClaudeStatus(d: AgentDashboard, raw: unknown): void {
  const r = object(raw), model = object(r.model), context = object(r.context_window), rates = object(r.rate_limits)
  d.model = text(model.display_name) ?? text(model.id) ?? d.model
  d.title = text(r.session_name) ?? text(r.session_title) ?? d.title
  d.cwd = text(r.cwd) ?? text(object(r.workspace).current_dir) ?? d.cwd
  d.effort = text(object(r.effort).level) ?? d.effort
  if (typeof r.fast_mode === 'boolean') d.fast = r.fast_mode
  const used = number(context.used_percentage), size = number(context.context_window_size)
  const usage = object(context.current_usage)
  const tokens = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .map(k => number(usage[k]))
  if (used !== null) d.context = { remainingPercent: percent(100 - used), windowTokens: size,
    usedTokens: tokens.some(v => v !== null) ? tokens.reduce<number>((a, v) => a + (v ?? 0), 0) : null }
  d.limits = { primary: limit(rates.five_hour, 300), secondary: limit(rates.seven_day, 10080) }
  d.cost = number(object(r.cost).total_cost_usd)
  d.usageUpdatedAt = Date.now()
}

export function applyCodexLine(d: AgentDashboard, raw: unknown): void {
  const r = object(raw), p = object(r.payload)
  const settings = r.type === 'turn_context' ? p : r.type === 'event_msg' && p.type === 'thread_settings_applied' ? object(p.thread_settings) : null
  if (settings) {
    d.cwd = text(settings.cwd) ?? d.cwd
    d.model = text(settings.model) ?? d.model
    d.effort = text(settings.effort) ?? text(settings.reasoning_effort) ?? d.effort
    if (typeof settings.service_tier === 'string' || settings.service_tier === null) d.fast = settings.service_tier === 'fast' || settings.service_tier === 'priority'
    const sandbox = text(object(settings.sandbox_policy).type) ?? (object(settings.permission_profile).type === 'disabled' ? 'danger-full-access' : null)
    const approval = text(settings.approval_policy)
    if (sandbox) {
      d.permission = ({ 'danger-full-access': '完全访问', 'workspace-write': '工作区写入', 'read-only': '只读' } as Record<string,string>)[sandbox] ?? sandbox
      d.permissionDetail = [sandbox, approval].filter(Boolean).join(' / ')
    } else if (object(settings.permission_profile).type) {
      d.permission = null
      d.permissionDetail = [text(object(settings.permission_profile).type), approval].filter(Boolean).join(' / ')
    }
  } else if (r.type === 'event_msg' && p.type === 'token_count') {
    const info = object(p.info), usage = object(info.last_token_usage)
    const used = number(usage.total_tokens), size = number(info.model_context_window)
    if (used !== null && size !== null && size > 0) {
      d.context = { remainingPercent: percent(100 - used / size * 100), usedTokens: used, windowTokens: size }
    }
    if (p.rate_limits !== null && p.rate_limits !== undefined) {
      const rates = object(p.rate_limits)
      d.limits = { primary: limit(rates.primary), secondary: limit(rates.secondary) }
    }
    const timestamp = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN
    d.usageUpdatedAt = Number.isFinite(timestamp) ? timestamp : Date.now()
  } else if (r.type === 'event_msg' && p.type === 'thread_name_updated') {
    d.title = text(p.name) ?? text(p.thread_name) ?? d.title
  }
}
