/** 「活跃」分组最多容纳的项目数 */
export const ACTIVE_LIST_LIMIT = 10

interface ActiveEntry {
  /** 是否正在工作（工作中 / 等待确认）：忙碌的项目不算静默 */
  busy: boolean
  /** 最后一次活动（进入或离开忙碌状态）的时间，用来判断静默多久 */
  lastActive: number
}

/**
 * 「活跃」分组的成员：助手开始工作的项目加入（新加入的排在最前，已在其中的不挪位置）；
 * 超过上限时移出静默最久的项目（优先不动正在工作的项目）。只保存在内存里。
 */
export class ActiveList {
  /** 按加入顺序，新的在前 */
  private readonly order: string[] = []
  private readonly entries = new Map<string, ActiveEntry>()

  private readonly limit: number
  private readonly now: () => number

  // 不用参数属性写法：保持可被 Node 原生类型剥离直接运行（tests/activeList.test.ts）
  constructor(limit = ACTIVE_LIST_LIMIT, now: () => number = Date.now) {
    this.limit = limit
    this.now = now
  }

  ids(): readonly string[] {
    return this.order
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  /**
   * 项目的助手状态变化。busy=true 时（尚未加入则加入）记为活动；
   * busy=false 只更新已在分组里的项目（记下开始静默的时间）。返回成员是否变化。
   */
  update(id: string, busy: boolean): boolean {
    const t = this.now()
    const entry = this.entries.get(id)
    if (entry) {
      if (entry.busy || busy) entry.lastActive = t
      entry.busy = busy
      return false
    }
    if (!busy) return false
    this.entries.set(id, { busy, lastActive: t })
    this.order.unshift(id)
    this.evict(id)
    return true
  }

  /** 移出（项目被删除或用户手动移出）。返回成员是否变化 */
  remove(id: string): boolean {
    if (!this.entries.delete(id)) return false
    this.order.splice(this.order.indexOf(id), 1)
    return true
  }

  /** 只保留仍存在的项目。返回成员是否变化 */
  retain(exists: (id: string) => boolean): boolean {
    let changed = false
    for (const id of [...this.order]) if (!exists(id)) changed = this.remove(id) || changed
    return changed
  }

  /** 超出上限：移出静默最久的（不忙碌的优先；全部忙碌时移出最久没有新活动的）；不移出刚加入的 */
  private evict(keep: string): void {
    while (this.order.length > this.limit) {
      let victim: string | null = null
      let best: ActiveEntry | null = null
      for (const id of this.order) {
        if (id === keep) continue
        const e = this.entries.get(id)!
        if (!best || (best.busy && !e.busy) || (best.busy === e.busy && e.lastActive <= best.lastActive)) {
          victim = id
          best = e
        }
      }
      if (!victim) return
      this.remove(victim)
    }
  }
}
