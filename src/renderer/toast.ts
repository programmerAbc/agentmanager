// 右下角的简单提示，几秒后自动消失

const DURATION_MS = 4000

export function toast(message: string, kind: 'error' | 'info' = 'error'): void {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  const el = document.createElement('div')
  el.className = `toast toast-${kind}`
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  el.textContent = message
  container.appendChild(el)
  window.setTimeout(() => {
    el.classList.add('leaving')
    window.setTimeout(() => el.remove(), 200)
  }, DURATION_MS)
}
