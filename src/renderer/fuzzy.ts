// 项目列表的模糊搜索：子序列匹配 + 打分（参考 fzy 的动态规划算法）。
// 纯函数，不依赖 DOM。所有下标都按码点（Array.from）计算，与高亮渲染一致。

export interface FuzzyMatch {
  score: number
  /** 命中字符在文本中的下标（码点，升序） */
  positions: number[]
}

const SCORE_GAP_LEADING = -0.005
const SCORE_GAP_TRAILING = -0.005
const SCORE_GAP_INNER = -0.01
const SCORE_MATCH_CONSECUTIVE = 1.0
const SCORE_MATCH_SLASH = 0.9
const SCORE_MATCH_WORD = 0.8
const SCORE_MATCH_CAPITAL = 0.7
const SCORE_MATCH_DOT = 0.6
/** 完全相等时的得分 */
const SCORE_EXACT = 1000
/** 名称命中的词整体排在只有路径命中的词前面 */
const NAME_WEIGHT = 10000
/** 超长文本不参与匹配（DP 是 O(词长 × 文本长)） */
const MAX_TEXT_LENGTH = 1024

/**
 * 不区分大小写的子序列匹配。不匹配返回 null。
 * 得分：连续命中、词首（开头、分隔符之后、驼峰大写处）命中加分，命中之间的间隔扣分。
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = Array.from(query)
  const t = Array.from(text)
  const n = q.length
  const m = t.length
  if (n === 0 || n > m || m > MAX_TEXT_LENGTH) return null
  const ql = q.map(lower)
  const tl = t.map(lower)
  if (!isSubsequence(ql, tl)) return null
  if (n === m) return { score: SCORE_EXACT, positions: t.map((_, i) => i) }

  const bonus = t.map((_, j) => bonusAt(t, j))
  // D[i][j]：q[i] 恰好命中 t[j] 时的最高分；M[i][j]：q[0..i] 落在 t[0..j] 内的最高分
  const D: Float64Array[] = []
  const M: Float64Array[] = []
  for (let i = 0; i < n; i++) {
    const d = new Float64Array(m)
    const mm = new Float64Array(m)
    const gap = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER
    let prev = -Infinity
    for (let j = 0; j < m; j++) {
      if (ql[i] === tl[j]) {
        let score = -Infinity
        if (i === 0) score = j * SCORE_GAP_LEADING + bonus[j]
        else if (j > 0) score = Math.max(M[i - 1][j - 1] + bonus[j], D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE)
        d[j] = score
        prev = Math.max(score, prev + gap)
      } else {
        d[j] = -Infinity
        prev = prev + gap
      }
      mm[j] = prev
    }
    D.push(d)
    M.push(mm)
  }

  // 回溯出命中位置
  const positions = new Array<number>(n)
  let matchRequired = false
  let j = m - 1
  for (let i = n - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      if (D[i][j] !== -Infinity && (matchRequired || D[i][j] === M[i][j])) {
        matchRequired = i > 0 && j > 0 && M[i][j] === D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE
        positions[i] = j--
        break
      }
    }
  }
  return { score: M[n - 1][m - 1], positions }
}

/** 搜索框内容按空白拆成多个词 */
export function searchTokens(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean)
}

export interface ProjectMatch {
  score: number
  /** 项目名中命中的字符下标 */
  nameHits: Set<number>
  /** 路径中命中的字符下标 */
  pathHits: Set<number>
}

/**
 * 每个词都要匹配上：优先匹配项目名；名称不匹配时，匹配路径中的某一级目录名（不跨分隔符）。
 * 任何一个词匹配不上就返回 null。
 * path 应传界面上显示的路径（侧栏的缩写形式），保证每个命中都看得见、能高亮。
 */
export function matchProject(tokens: string[], name: string, path: string): ProjectMatch | null {
  const segments = splitSegments(path)
  const nameHits = new Set<number>()
  const pathHits = new Set<number>()
  let score = 0
  for (const token of tokens) {
    const byName = fuzzyMatch(token, name)
    if (byName) {
      score += NAME_WEIGHT + byName.score
      for (const p of byName.positions) nameHits.add(p)
      continue
    }
    const byPath = bestSegmentMatch(token, segments)
    if (!byPath) return null
    score += byPath.score
    for (const p of byPath.positions) pathHits.add(byPath.offset + p)
  }
  return { score, nameHits, pathHits }
}

/** 在各级目录名里分别匹配，取得分最高的一级；positions 为段内下标，offset 为该段在整个路径中的起点 */
function bestSegmentMatch(
  token: string,
  segments: { text: string; offset: number }[]
): (FuzzyMatch & { offset: number }) | null {
  let best: (FuzzyMatch & { offset: number }) | null = null
  for (const seg of segments) {
    const match = fuzzyMatch(token, seg.text)
    if (match && (!best || match.score > best.score)) best = { ...match, offset: seg.offset }
  }
  return best
}

/** 按 \ 和 / 切分，offset 为该段第一个字符在原文本中的码点下标 */
function splitSegments(text: string): { text: string; offset: number }[] {
  const chars = Array.from(text)
  const segments: { text: string; offset: number }[] = []
  let start = 0
  for (let i = 0; i <= chars.length; i++) {
    if (i === chars.length || chars[i] === '\\' || chars[i] === '/') {
      if (i > start) segments.push({ text: chars.slice(start, i).join(''), offset: start })
      start = i + 1
    }
  }
  return segments
}

function isSubsequence(q: string[], t: string[]): boolean {
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) if (q[i] === t[j]) i++
  return i === q.length
}

function bonusAt(t: string[], j: number): number {
  if (j === 0) return SCORE_MATCH_SLASH
  const prev = t[j - 1]
  if (prev === '\\' || prev === '/') return SCORE_MATCH_SLASH
  if (prev === '-' || prev === '_' || prev === ' ') return SCORE_MATCH_WORD
  if (prev === '.') return SCORE_MATCH_DOT
  if (isLowerLetter(prev) && isUpperLetter(t[j])) return SCORE_MATCH_CAPITAL
  return 0
}

function lower(ch: string): string {
  return ch.toLowerCase()
}

function isLowerLetter(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}

function isUpperLetter(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase()
}
