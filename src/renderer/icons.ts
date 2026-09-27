// Material Symbols Rounded（@material-symbols/svg-400，Apache-2.0），按需打包
import add from '@material-symbols/svg-400/rounded/add.svg?raw'
import checkCircleFill from '@material-symbols/svg-400/rounded/check_circle-fill.svg?raw'
import codeBlocks from '@material-symbols/svg-400/rounded/code_blocks.svg?raw'
import close from '@material-symbols/svg-400/rounded/close.svg?raw'
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg?raw'
import edit from '@material-symbols/svg-400/rounded/edit.svg?raw'
import folderOpen from '@material-symbols/svg-400/rounded/folder_open.svg?raw'
import formatSize from '@material-symbols/svg-400/rounded/format_size.svg?raw'
import frontHandFill from '@material-symbols/svg-400/rounded/front_hand-fill.svg?raw'
import info from '@material-symbols/svg-400/rounded/info.svg?raw'
import palette from '@material-symbols/svg-400/rounded/palette.svg?raw'
import playArrowFill from '@material-symbols/svg-400/rounded/play_arrow-fill.svg?raw'
import restartAlt from '@material-symbols/svg-400/rounded/restart_alt.svg?raw'
import rocketLaunch from '@material-symbols/svg-400/rounded/rocket_launch.svg?raw'
import search from '@material-symbols/svg-400/rounded/search.svg?raw'
import searchOff from '@material-symbols/svg-400/rounded/search_off.svg?raw'
import settings from '@material-symbols/svg-400/rounded/settings.svg?raw'
import terminal from '@material-symbols/svg-400/rounded/terminal.svg?raw'
import check from '@material-symbols/svg-400/rounded/check.svg?raw'
import contentCopy from '@material-symbols/svg-400/rounded/content_copy.svg?raw'
import contentPaste from '@material-symbols/svg-400/rounded/content_paste.svg?raw'
import expandMore from '@material-symbols/svg-400/rounded/arrow_drop_down.svg?raw'

const ICONS = {
  add,
  check,
  checkCircleFill,
  close,
  codeBlocks,
  contentCopy,
  contentPaste,
  delete: deleteIcon,
  edit,
  expandMore,
  folderOpen,
  formatSize,
  frontHandFill,
  info,
  palette,
  playArrowFill,
  restartAlt,
  rocketLaunch,
  search,
  searchOff,
  settings,
  terminal
} as const

export type IconName = keyof typeof ICONS

/** 返回一个 <span class="icon">，内含 SVG；尺寸和颜色由 CSS 控制（fill: currentColor） */
export function icon(name: IconName, className = ''): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = className ? `icon ${className}` : 'icon'
  span.setAttribute('aria-hidden', 'true')
  // 图标内容来自打包进来的静态 SVG 文件，不含用户输入
  span.innerHTML = ICONS[name]
  return span
}
