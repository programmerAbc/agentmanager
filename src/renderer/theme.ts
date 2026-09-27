import {
  argbFromHex,
  Hct,
  hexFromArgb,
  MaterialDynamicColors as C,
  SchemeMonochrome,
  SchemeTonalSpot,
  type DynamicColor,
  type DynamicScheme
} from '@material/material-color-utilities'
import type { ITheme } from '@xterm/xterm'
import { THEME_SEED_BLACK, THEME_SEED_WHITE, themeModeOf, type ThemeMode } from '../shared/types'

/** 设置页提供的种子色预设；白色 / 黑色是单色的浅色 / 纯黑主题 */
export const THEME_PRESETS: { name: string; seed: string }[] = [
  { name: 'Claude 橙', seed: '#D97757' },
  { name: 'MD3 紫', seed: '#6750A4' },
  { name: '海蓝', seed: '#0B57D0' },
  { name: '青绿', seed: '#006A6A' },
  { name: '森绿', seed: '#386A20' },
  { name: '玫红', seed: '#B4005F' },
  { name: '琥珀', seed: '#8B5000' },
  { name: '白色', seed: THEME_SEED_WHITE },
  { name: '黑色', seed: THEME_SEED_BLACK }
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

// 终端 ANSI 16 色保持中性（VS Code 深色 / 浅色），只有背景 / 前景 / 光标 / 选区跟随配色方案
const ANSI_DARK = {
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

const ANSI_LIGHT = {
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5'
}

/**
 * 按主题模式覆盖的 surface 色阶（中性色板的 tone）：
 * - 白色：侧栏与终端都是纯白，面板 / 输入框用浅灰区分
 * - 黑色：侧栏与终端都是纯黑，菜单 / 对话框 / 输入框用深灰区分
 */
const SURFACE_TONES: Partial<Record<ThemeMode, Record<string, number>>> = {
  light: { surface: 100, 'surface-bright': 100, 'surface-container-lowest': 100, 'surface-container-low': 100 },
  black: {
    surface: 0,
    'surface-dim': 0,
    'surface-bright': 22,
    'surface-container-lowest': 0,
    'surface-container-low': 0,
    'surface-container': 6,
    'surface-container-high': 10,
    'surface-container-highest': 17
  }
}

export interface TerminalColors {
  theme: ITheme
  /** xterm 的最小对比度：浅色主题下把为深色背景设计的前景色调暗，保证可读 */
  minimumContrastRatio: number
}

/**
 * 由种子色生成 MD3（2025 规范，即 M3 Expressive）配色方案，写入 CSS 变量，返回对应的终端配色。
 * 白色种子 → 单色浅色方案；黑色种子 → 单色深色方案（背景纯黑）；其余 → 动态配色深色方案。
 */
export function applyTheme(seedHex: string): TerminalColors {
  const mode = themeModeOf(seedHex)
  const source = Hct.fromInt(argbFromHex(seedHex))
  const scheme: DynamicScheme =
    mode === 'dark'
      ? new SchemeTonalSpot(source, true, 0, '2025')
      : new SchemeMonochrome(source, mode === 'black', 0, '2025')
  const tones = SURFACE_TONES[mode] ?? {}
  const colors = new Map<string, string>()
  const root = document.documentElement.style
  for (const [role, color] of ROLES) {
    const tone = tones[role]
    const hex = hexFromArgb(tone === undefined ? color.getArgb(scheme) : scheme.neutralPalette.tone(tone))
    colors.set(role, hex)
    root.setProperty(`--md-sys-color-${role}`, hex)
  }
  // 原生控件（滚动条、颜色选择器等）跟随明暗
  root.colorScheme = mode === 'light' ? 'light' : 'dark'

  const get = (role: string): string => colors.get(role) ?? '#000000'
  // 终端背景与卡片背景（surface）一致；2025 规范的暗色 surface-container-lowest 是纯黑，不用它
  const background = get('surface')
  const selectionAlpha = mode === 'light' ? 0.22 : 0.32
  return {
    theme: {
      ...(mode === 'light' ? ANSI_LIGHT : ANSI_DARK),
      background,
      foreground: get('on-surface'),
      cursor: get('primary'),
      cursorAccent: background,
      selectionBackground: withAlpha(get('primary'), selectionAlpha),
      selectionInactiveBackground: withAlpha(get('primary'), selectionAlpha / 2),
      scrollbarSliderBackground: withAlpha(get('on-surface-variant'), 0.22),
      scrollbarSliderHoverBackground: withAlpha(get('on-surface-variant'), 0.4),
      scrollbarSliderActiveBackground: withAlpha(get('primary'), 0.55)
    },
    minimumContrastRatio: mode === 'light' ? 4.5 : 1
  }
}

/** 颜色是否偏亮（用于在色块上选择深色 / 浅色的勾） */
export function isLightColor(hex: string): boolean {
  return Hct.fromInt(argbFromHex(hex)).tone > 70
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
