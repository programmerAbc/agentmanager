import {
  DEFAULT_FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
  type AppSettings,
  type SettingsPatch
} from '../shared/types'
import { button, openDialog } from './dialog'
import { BUNDLED_FONT, effectiveFont, fontStack, isFontAvailable, listMonospaceFonts } from './fonts'
import { icon, type IconName } from './icons'
import { shapeSvg } from './shapes'
import { THEME_PRESETS } from './theme'
import { toast } from './toast'

const api = window.api

export interface SettingsDialogDeps {
  /** 当前（实时）设置 */
  get(): AppSettings
  /** 立即应用并保存 */
  change(patch: SettingsPatch): void
  /** 额外的分区（例如 Claude 设置），插在「外观」之后 */
  extraSections?: (() => HTMLElement)[]
}

let open = false

export function openSettingsDialog(deps: SettingsDialogDeps): void {
  if (open) return
  open = true
  const content = document.createElement('div')
  content.append(terminalSection(deps), appearanceSection(deps))
  for (const make of deps.extraSections ?? []) content.appendChild(make())
  content.appendChild(aboutSection())
  openDialog({
    title: '设置',
    icon: 'settings',
    content,
    className: 'settings-dialog',
    closeButton: true,
    onClose: () => {
      open = false
    }
  })
}

// ---------------- 终端 ----------------

function terminalSection(deps: SettingsDialogDeps): HTMLElement {
  const section = sectionEl('终端', 'terminal')
  const preview = document.createElement('div')
  preview.className = 'font-preview'
  preview.textContent = 'AgentManager 终端预览  0123456789\n() [] {} <= => != ~/.claude  中文等宽对齐 ✓\nclaude --permission-mode bypassPermissions'
  const hint = document.createElement('div')
  hint.className = 'font-hint'

  const refreshPreview = (): void => {
    const s = deps.get()
    preview.style.fontFamily = fontStack(s.fontFamily)
    preview.style.fontSize = `${s.fontSize}px`
    preview.style.lineHeight = String(s.lineHeight)
    const missing = !isFontAvailable(s.fontFamily)
    hint.hidden = !missing
    hint.textContent = missing ? `本机没有「${s.fontFamily}」，当前实际使用「${effectiveFont(s.fontFamily)}」。` : ''
  }

  const fontSelect = fontPicker(deps.get().fontFamily, (family) => {
    deps.change({ fontFamily: family })
    refreshPreview()
  })
  section.appendChild(row('字体', '列出本机已安装的等宽字体', fontSelect))

  section.appendChild(
    row(
      '字号',
      '也可以在终端中按 Ctrl+= / Ctrl+- / Ctrl+0 调整',
      ...slider(deps.get().fontSize, FONT_SIZE.min, FONT_SIZE.max, 1, (v) => `${v}px`, (v) => {
        deps.change({ fontSize: v })
        refreshPreview()
      })
    )
  )
  section.appendChild(
    row(
      '行高',
      '大于 1 时行间更宽松',
      ...slider(deps.get().lineHeight, LINE_HEIGHT.min, LINE_HEIGHT.max, 0.05, (v) => v.toFixed(2), (v) => {
        deps.change({ lineHeight: v })
        refreshPreview()
      })
    )
  )
  section.append(preview, hint)
  refreshPreview()
  return section
}

/** 字体下拉：首次展开时检测本机等宽字体，每个选项用自身字体渲染 */
function fontPicker(initial: string, onPick: (family: string) => void): HTMLElement {
  let current = initial
  const wrap = document.createElement('div')
  wrap.className = 'select'
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'select-trigger'
  const label = document.createElement('span')
  trigger.append(label, icon('expandMore'))
  wrap.appendChild(trigger)

  const renderLabel = (): void => {
    label.textContent = current
    label.style.fontFamily = fontStack(current)
  }
  renderLabel()

  trigger.addEventListener('click', () => {
    void listMonospaceFonts().then((fonts) => {
      const families = fonts.includes(current) ? fonts : [current, ...fonts]
      showSelectMenu(trigger, families, current, (family) => {
        current = family
        renderLabel()
        onPick(family)
      })
    })
  })
  return wrap
}

function showSelectMenu(
  anchor: HTMLElement,
  families: string[],
  current: string,
  onPick: (family: string) => void
): void {
  const menu = document.createElement('div')
  menu.className = 'select-menu'
  menu.setAttribute('role', 'listbox')
  for (const family of families) {
    const opt = document.createElement('button')
    opt.type = 'button'
    opt.className = family === current ? 'select-option selected' : 'select-option'
    opt.setAttribute('role', 'option')
    // 与终端相同的字体栈，未安装的字体会显示为实际使用的回退字体
    opt.style.fontFamily = fontStack(family)
    const text = document.createElement('span')
    text.textContent = family
    opt.append(icon('check'), text)
    const tagText =
      family === BUNDLED_FONT ? '内置' : family === DEFAULT_FONT_FAMILY ? '默认' : isFontAvailable(family) ? '' : '未安装'
    if (tagText) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = tagText
      opt.appendChild(tag)
    }
    opt.addEventListener('click', () => {
      close()
      onPick(family)
    })
    menu.appendChild(opt)
  }
  document.body.appendChild(menu)
  const rect = anchor.getBoundingClientRect()
  menu.style.minWidth = `${rect.width}px`
  const below = window.innerHeight - rect.bottom - 8
  menu.style.left = `${rect.left}px`
  if (below >= 200) menu.style.top = `${rect.bottom + 4}px`
  else menu.style.bottom = `${window.innerHeight - rect.top + 4}px`
  menu.style.maxHeight = `${Math.max(200, Math.min(340, below >= 200 ? below : rect.top - 8))}px`
  menu.querySelector('.selected')?.scrollIntoView({ block: 'center' })

  // 注册在 window 捕获阶段，先于对话框的 Esc 处理，Esc 只关闭菜单
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  const onDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close()
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('mousedown', onDown, true)
  function close(): void {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('mousedown', onDown, true)
    menu.remove()
  }
}

function slider(
  value: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
  onChange: (v: number) => void
): [HTMLInputElement, HTMLElement] {
  const input = document.createElement('input')
  input.type = 'range'
  input.className = 'slider'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  const out = document.createElement('span')
  out.className = 'setting-value'
  const update = (): void => {
    const v = Number(input.value)
    input.style.setProperty('--value', `${((v - min) / (max - min)) * 100}%`)
    out.textContent = format(v)
  }
  update()
  input.addEventListener('input', () => {
    update()
    onChange(Number(input.value))
  })
  return [input, out]
}

// ---------------- 外观 ----------------

function appearanceSection(deps: SettingsDialogDeps): HTMLElement {
  const section = sectionEl('外观', 'palette')
  const list = document.createElement('div')
  list.className = 'seed-list'

  const chips: HTMLButtonElement[] = []
  const markSelected = (): void => {
    const seed = deps.get().themeSeed.toUpperCase()
    let matched = false
    for (const chip of chips) {
      const isMatch = chip.dataset.seed === seed
      chip.classList.toggle('selected', isMatch)
      matched ||= isMatch
    }
    custom.classList.toggle('selected', !matched)
  }

  for (const preset of THEME_PRESETS) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'seed-chip'
    chip.dataset.seed = preset.seed.toUpperCase()
    chip.title = `${preset.name} ${preset.seed}`
    chip.style.background = preset.seed
    chip.appendChild(icon('check'))
    chip.addEventListener('click', () => {
      deps.change({ themeSeed: preset.seed })
      markSelected()
    })
    chips.push(chip)
    list.appendChild(chip)
  }

  // 自定义颜色：透明的 <input type=color> 覆盖在彩虹色块上
  const custom = document.createElement('label')
  custom.className = 'seed-chip seed-custom'
  custom.title = '自定义颜色'
  const picker = document.createElement('input')
  picker.type = 'color'
  picker.value = deps.get().themeSeed
  picker.addEventListener('input', () => {
    deps.change({ themeSeed: picker.value })
    markSelected()
  })
  custom.append(picker, icon('check'))
  list.appendChild(custom)

  markSelected()
  section.appendChild(row('主题色', '界面配色由种子色按 Material 3 规则生成', document.createElement('span')))
  section.appendChild(list)
  return section
}

// ---------------- 关于 ----------------

function aboutSection(): HTMLElement {
  const section = sectionEl('关于', 'info')
  section.append(...aboutContent())
  return section
}

/** 「关于」对话框（点击侧栏顶部的应用名打开） */
export function openAboutDialog(onOpenSettings: () => void): void {
  const content = document.createElement('div')
  content.className = 'about-dialog-content'
  content.append(...aboutContent())
  openDialog({
    title: '关于',
    icon: 'info',
    content,
    actions: [
      { label: '打开设置', variant: 'text', action: () => onOpenSettings() },
      { label: '好', variant: 'filled' }
    ]
  })
}

function aboutContent(): HTMLElement[] {
  const head = document.createElement('div')
  head.className = 'about-app'
  const logo = document.createElement('span')
  logo.className = 'hero-shape about-logo'
  logo.appendChild(shapeSvg('cookie9', 'shape'))
  const names = document.createElement('div')
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = 'AgentManager'
  const version = document.createElement('div')
  version.className = 'version'
  version.textContent = '版本 …'
  names.append(name, version)
  head.append(logo, names)

  const grid = document.createElement('div')
  grid.className = 'about-grid'
  const actions = document.createElement('div')
  actions.className = 'about-actions'
  const openData = button('打开数据目录', 'tonal', 'folderOpen')
  const openLogs = button('打开日志目录', 'outlined', 'folderOpen')
  openData.addEventListener('click', () => void openDir('userData'))
  openLogs.addEventListener('click', () => void openDir('logs'))
  actions.append(openData, openLogs)

  void api.app.info().then((info) => {
    version.textContent = `版本 ${info.appVersion}`
    const rows: [string, string][] = [
      ['Electron', info.electron],
      ['Chromium', info.chrome],
      ['Node.js', info.node],
      ['V8', info.v8],
      ['系统', info.os],
      ['数据目录', info.userDataDir],
      ['日志目录', info.logsDir]
    ]
    for (const [k, v] of rows) {
      const kEl = document.createElement('div')
      kEl.className = 'k'
      kEl.textContent = k
      const vEl = document.createElement('div')
      vEl.className = 'v'
      vEl.textContent = v
      grid.append(kEl, vEl)
    }
  })
  return [head, grid, actions]
}

async function openDir(kind: 'userData' | 'logs'): Promise<void> {
  const result = await api.app.openDir(kind)
  if (!result.ok) toast(result.error)
}

// ---------------- 通用 ----------------

export function sectionEl(title: string, iconName: IconName): HTMLElement {
  const section = document.createElement('section')
  section.className = 'settings-section'
  const h = document.createElement('h3')
  h.append(icon(iconName), document.createTextNode(title))
  section.appendChild(h)
  return section
}

export function row(name: string, desc: string, ...controls: HTMLElement[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'setting-row'
  const label = document.createElement('div')
  label.className = 'setting-label'
  const n = document.createElement('div')
  n.className = 'name'
  n.textContent = name
  const d = document.createElement('div')
  d.className = 'desc'
  d.textContent = desc
  label.append(n, d)
  el.append(label, ...controls)
  return el
}
