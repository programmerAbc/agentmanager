import { icon, type IconName } from './icons'

// MD3 菜单：同一时间只有一个，点击外部 / Esc / 窗口失焦时关闭

export type MenuItem =
  | { label: string; action: () => void; icon?: IconName; disabled?: boolean; danger?: boolean }
  | { separator: true }

let closeCurrent: (() => void) | null = null

export function closeContextMenu(): void {
  closeCurrent?.()
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu()

  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.setAttribute('role', 'menu')

  for (const item of items) {
    if ('separator' in item) {
      const sep = document.createElement('div')
      sep.className = 'menu-separator'
      menu.appendChild(sep)
      continue
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = item.danger ? 'menu-item danger' : 'menu-item'
    if (item.icon) button.appendChild(icon(item.icon))
    const label = document.createElement('span')
    label.textContent = item.label
    button.appendChild(label)
    button.disabled = item.disabled === true
    button.setAttribute('role', 'menuitem')
    button.addEventListener('click', () => {
      closeContextMenu()
      item.action()
    })
    menu.appendChild(button)
  }

  document.body.appendChild(menu)
  requestAnimationFrame(() => menu.classList.add('open'))
  const rect = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`

  const onPointerDown = (e: PointerEvent): void => {
    if (!menu.contains(e.target as Node)) closeContextMenu()
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeContextMenu()
    }
  }
  const onDismiss = (): void => closeContextMenu()

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('wheel', onDismiss, true)
  window.addEventListener('blur', onDismiss)
  window.addEventListener('resize', onDismiss)

  closeCurrent = () => {
    closeCurrent = null
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('wheel', onDismiss, true)
    window.removeEventListener('blur', onDismiss)
    window.removeEventListener('resize', onDismiss)
    menu.remove()
  }
}
