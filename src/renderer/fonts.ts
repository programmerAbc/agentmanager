import { DEFAULT_FONT_FAMILY } from '../shared/types'

/** 打包在应用里的字体（@font-face 声明在 styles.css） */
export const BUNDLED_FONT = 'Sarasa Term SC'

/** 用户所选字体之后的回退链：Maple Mono（含 NL 变体）→ Cascadia Mono → Consolas，中文最后走微软雅黑 */
const FALLBACKS = [DEFAULT_FONT_FAMILY, 'Maple Mono NL NF CN', 'Cascadia Mono', 'Consolas', 'Microsoft YaHei UI']

function families(primary: string): string[] {
  return [primary, ...FALLBACKS.filter((f) => f !== primary)]
}

export function fontStack(primary: string): string {
  return `${families(primary).map((f) => `"${f}"`).join(', ')}, monospace`
}

/** 字体栈里第一个已安装的字体（即西文实际使用的字体） */
export function effectiveFont(primary: string): string {
  return families(primary).find(isFontAvailable) ?? 'monospace'
}

/** 内置字体按需加载；系统字体无需等待 */
export async function ensureFontLoaded(primary: string, size: number): Promise<void> {
  if (primary !== BUNDLED_FONT) return
  try {
    await document.fonts.load(`${size}px "${BUNDLED_FONT}"`)
  } catch (err) {
    console.warn('内置字体加载失败', err)
  }
}

const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')

function measure(font: string, text: string): number {
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

/** 字体是否已安装：分别以 monospace / serif 为回退测量同一段文字，已安装时两者相同 */
export function isFontAvailable(family: string): boolean {
  if (family === BUNDLED_FONT) return true
  const sample = 'mmmmmmmmmmlli10WW中文'
  return measure(`40px "${family}", monospace`, sample) === measure(`40px "${family}", serif`, sample)
}

function isMonospace(family: string): boolean {
  const narrow = measure(`40px "${family}", serif`, 'iiiiiiiiii')
  const wide = measure(`40px "${family}", serif`, 'WWWWWWWWWW')
  return narrow > 0 && Math.abs(narrow - wide) < 0.5
}

/** 符号字体、CJK 扩展字库（只含生僻字，拉丁字母走回退）、以及非等宽的界面字体 */
const EXCLUDED = /^(Marlett|Wingdings|Webdings|Symbol|MT Extra|Segoe (MDL2|Fluent|UI Symbol|UI Emoji)|Microsoft YaHei)|-Ext[A-Z]$/i

let cached: string[] | null = null

/**
 * 本机已安装的等宽字体族（需要用户手势触发，例如打开设置页的点击 / 按键）。
 * queryLocalFonts 不可用或被拒绝时只返回回退链里已安装的字体。
 */
export async function listMonospaceFonts(): Promise<string[]> {
  if (cached) return cached
  const families = new Set<string>()
  try {
    const fonts = (await window.queryLocalFonts?.()) ?? []
    for (const f of fonts) families.add(f.family)
  } catch (err) {
    console.warn('queryLocalFonts 失败', err)
  }
  for (const f of FALLBACKS) families.add(f)
  const result = [...families]
    .filter((f) => !EXCLUDED.test(f) && isFontAvailable(f) && isMonospace(f))
    .sort((a, b) => a.localeCompare(b))
  cached = [BUNDLED_FONT, ...result.filter((f) => f !== BUNDLED_FONT)]
  return cached
}
