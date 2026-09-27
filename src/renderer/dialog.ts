import { closeContextMenu } from './contextMenu'
import { icon, type IconName } from './icons'

export interface DialogAction {
  label: string
  variant?: 'text' | 'filled' | 'tonal'
  danger?: boolean
  /** 返回 false 时不关闭对话框 */
  action?: () => void | boolean
}

export interface DialogOptions {
  title: string
  icon?: IconName
  content: HTMLElement
  actions?: DialogAction[]
  /** 额外的 class，用于调整尺寸（如设置页） */
  className?: string
  /** 标题栏右侧显示关闭按钮 */
  closeButton?: boolean
  onClose?: () => void
}

export interface DialogHandle {
  close(): void
}

/** MD3 对话框：遮罩 + 容器；Esc / 点击遮罩关闭，关闭后焦点还给打开前的元素 */
export function openDialog(options: DialogOptions): DialogHandle {
  closeContextMenu()
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null

  const scrim = document.createElement('div')
  scrim.className = 'dialog-scrim'
  const dialog = document.createElement('div')
  dialog.className = options.className ? `dialog ${options.className}` : 'dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.tabIndex = -1

  const header = document.createElement('div')
  header.className = 'dialog-header'
  if (options.icon) header.appendChild(icon(options.icon, 'dialog-icon'))
  const title = document.createElement('h2')
  title.className = 'dialog-title'
  title.textContent = options.title
  header.appendChild(title)
  if (options.closeButton) {
    const closeBtn = iconButton('close', '关闭', () => handle.close())
    closeBtn.classList.add('dialog-close')
    header.appendChild(closeBtn)
  }

  const body = document.createElement('div')
  body.className = 'dialog-body'
  body.appendChild(options.content)
  dialog.append(header, body)

  if (options.actions?.length) {
    const actions = document.createElement('div')
    actions.className = 'dialog-actions'
    for (const a of options.actions) {
      const btn = button(a.label, a.variant ?? 'text')
      if (a.danger) btn.classList.add('danger')
      btn.addEventListener('click', () => {
        if (a.action?.() === false) return
        handle.close()
      })
      actions.appendChild(btn)
    }
    dialog.appendChild(actions)
  }

  scrim.appendChild(dialog)
  document.body.appendChild(scrim)
  requestAnimationFrame(() => scrim.classList.add('open'))

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handle.close()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) handle.close()
  })

  let closed = false
  const handle: DialogHandle = {
    close() {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKeyDown, true)
      scrim.classList.remove('open')
      scrim.classList.add('closing')
      window.setTimeout(() => scrim.remove(), 200)
      options.onClose?.()
      previousFocus?.focus()
    }
  }

  // 默认聚焦最后一个（主要）按钮，否则聚焦对话框本身
  const primary = dialog.querySelector<HTMLButtonElement>('.dialog-actions button:last-child')
  ;(primary ?? dialog).focus()
  return handle
}

/** 确认对话框；确认返回 true */
export function confirmDialog(options: {
  title: string
  message: string
  detail?: string
  confirmLabel: string
  danger?: boolean
  icon?: IconName
}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false
    const content = document.createElement('div')
    const message = document.createElement('p')
    message.className = 'dialog-message'
    message.textContent = options.message
    content.appendChild(message)
    if (options.detail) {
      const detail = document.createElement('p')
      detail.className = 'dialog-detail'
      detail.textContent = options.detail
      content.appendChild(detail)
    }
    openDialog({
      title: options.title,
      icon: options.icon,
      content,
      actions: [
        { label: '取消', variant: 'text' },
        {
          label: options.confirmLabel,
          variant: 'filled',
          danger: options.danger,
          action: () => {
            result = true
          }
        }
      ],
      onClose: () => resolve(result)
    })
  })
}

/** MD3 普通按钮 */
export function button(label: string, variant: 'text' | 'filled' | 'tonal' | 'outlined', leading?: IconName): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `btn btn-${variant}`
  if (leading) btn.appendChild(icon(leading))
  const text = document.createElement('span')
  text.textContent = label
  btn.appendChild(text)
  return btn
}

/** MD3 图标按钮 */
export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'icon-btn'
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.appendChild(icon(name))
  btn.addEventListener('click', onClick)
  return btn
}
