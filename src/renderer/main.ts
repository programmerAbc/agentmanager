import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

// M0：一个 xterm 连接一个 PowerShell，验证 node-pty + xterm 链路
const SESSION_ID = 'm0'
const FONT_FAMILY = "'Sarasa Term SC', Consolas, 'Microsoft YaHei UI', monospace"

async function bootstrap(): Promise<void> {
  const host = document.getElementById('terminal-host')
  if (!host) throw new Error('缺少 #terminal-host')

  try {
    await document.fonts.load(`14px "Sarasa Term SC"`)
  } catch {
    // 字体加载失败时 xterm 会用回退字体
  }

  const pane = document.createElement('div')
  pane.className = 'term-pane'
  const mount = document.createElement('div')
  mount.className = 'term-mount'
  pane.appendChild(mount)
  host.appendChild(pane)

  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    scrollback: 10000,
    cursorBlink: true,
    theme: { background: '#181818' }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(mount)
  fit.fit()

  window.api.pty.onData((id, data) => {
    if (id === SESSION_ID) term.write(data)
  })
  window.api.pty.onExit((id, code) => {
    if (id === SESSION_ID) term.write(`\r\n进程已退出 (code ${code})\r\n`)
  })
  term.onData((data) => window.api.pty.write(SESSION_ID, data))
  term.onResize(({ cols, rows }) => window.api.pty.resize(SESSION_ID, cols, rows))
  window.addEventListener('resize', () => fit.fit())

  const result = await window.api.pty.open(SESSION_ID, term.cols, term.rows)
  if (!result.ok) term.write(`启动失败：${result.error}\r\n`)
  term.focus()
}

void bootstrap()
