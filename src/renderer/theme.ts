import {
  argbFromHex,
  Hct,
  hexFromArgb,
  MaterialDynamicColors as C,
  SchemeTonalSpot,
  type DynamicColor
} from '@material/material-color-utilities'
import type { ITheme } from '@xterm/xterm'

/** 设置页提供的种子色预设 */
export const THEME_PRESETS: { name: string; seed: string }[] = [
  { name: 'Claude 橙', seed: '#D97757' },
  { name: 'MD3 紫', seed: '#6750A4' },
  { name: '海蓝', seed: '#0B57D0' },
  { name: '青绿', seed: '#006A6A' },
  { name: '森绿', seed: '#386A20' },
  { name: '玫红', seed: '#B4005F' },
  { name: '琥珀', seed: '#8B5000' }
]

/** 写到 :root 上的 MD3 色彩角色，变量名为 --md-sys-color-<role> */
const ROLES: [string, DynamicColor][] = [
  ['primary', C.primary],
  ['on-primary', C.onPrimary],
  ['primary-container', C.primaryContainer],
  ['on-primary-container', C.onPrimaryContainer],
  ['secondary', C.secondary],
  ['on-secondary', C.onSecondary],
  ['secondary-container', C.secondaryContainer],
  ['on-secondary-container', C.onSecondaryContainer],
  ['tertiary', C.tertiary],
  ['on-tertiary', C.onTertiary],
  ['tertiary-container', C.tertiaryContainer],
  ['on-tertiary-container', C.onTertiaryContainer],
  ['error', C.error],
  ['on-error', C.onError],
  ['error-container', C.errorContainer],
  ['on-error-container', C.onErrorContainer],
  ['surface', C.surface],
  ['surface-dim', C.surfaceDim],
  ['surface-bright', C.surfaceBright],
  ['surface-container-lowest', C.surfaceContainerLowest],
  ['surface-container-low', C.surfaceContainerLow],
  ['surface-container', C.surfaceContainer],
  ['surface-container-high', C.surfaceContainerHigh],
  ['surface-container-highest', C.surfaceContainerHighest],
  ['on-surface', C.onSurface],
  ['on-surface-variant', C.onSurfaceVariant],
  ['outline', C.outline],
  ['outline-variant', C.outlineVariant],
  ['inverse-surface', C.inverseSurface],
  ['inverse-on-surface', C.inverseOnSurface],
  ['inverse-primary', C.inversePrimary],
  ['scrim', C.scrim],
  ['shadow', C.shadow]
]

// 终端 ANSI 16 色保持中性（VS Code 深色），只有背景 / 前景 / 光标 / 选区跟随配色方案
const ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}

/**
 * 由种子色生成 MD3（2025 规范，即 M3 Expressive）暗色方案，写入 CSS 变量，
 * 返回对应的 xterm 主题。
 */
export function applyTheme(seedHex: string): ITheme {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seedHex)), true, 0, '2025')
  const colors = new Map<string, string>()
  const root = document.documentElement.style
  for (const [role, color] of ROLES) {
    const hex = hexFromArgb(color.getArgb(scheme))
    colors.set(role, hex)
    root.setProperty(`--md-sys-color-${role}`, hex)
  }
  const get = (role: string): string => colors.get(role) ?? '#000000'
  // 2025 规范的暗色 surface-container-lowest 是纯黑，终端用略带色调的 surface，与卡片背景一致
  const background = get('surface')
  return {
    ...ANSI,
    background,
    foreground: get('on-surface'),
    cursor: get('primary'),
    cursorAccent: background,
    selectionBackground: withAlpha(get('primary'), 0.32),
    selectionInactiveBackground: withAlpha(get('primary'), 0.18),
    scrollbarSliderBackground: withAlpha(get('on-surface-variant'), 0.22),
    scrollbarSliderHoverBackground: withAlpha(get('on-surface-variant'), 0.4),
    scrollbarSliderActiveBackground: withAlpha(get('primary'), 0.55)
  }
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
