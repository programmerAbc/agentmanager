import { shell } from 'electron'
import { promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import log from './log'

/** 允许用 shell.openExternal 打开的协议：网页，以及编辑器的「打开文件」协议（codex 等工具会生成） */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'vscode:', 'vscode-insiders:', 'cursor:', 'windsurf:'])

/**
 * 双击 / 默认程序打开会被执行的扩展名。终端输出不可信（例如 cat 一个恶意文件里的 OSC 8 链接），
 * 这些文件只在资源管理器中定位，不直接打开。
 */
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.msi', '.msp', '.msc', '.scr', '.hta', '.cpl', '.lnk', '.url', '.reg', '.jar', '.pif', '.scf', '.inf',
  '.application', '.appref-ms', '.gadget', '.settingcontent-ms', '.library-ms', '.website'
])

/** 终端里 Ctrl+单击的链接：OSC 8 超链接或识别出的网址 */
export async function openLink(url: string): Promise<void> {
  const parsed = new URL(url)
  if (EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    await shell.openExternal(parsed.toString())
    return
  }
  if (parsed.protocol === 'file:') {
    // 带主机名的 file 链接指向网络共享：访问时 Windows 会自动发送登录凭据（NTLM），不打开
    if (parsed.hostname) throw new Error('不打开网络位置上的文件')
    await openLocalPath(fileURLToPath(parsed))
    return
  }
  throw new Error(`不支持的链接：${parsed.protocol}`)
}

/**
 * 用系统默认程序打开本机文件或目录。可执行文件 / 脚本只在资源管理器中定位；
 * 没有关联程序的文件也改为定位。
 */
export async function openLocalPath(target: string): Promise<void> {
  const abs = path.resolve(target)
  if (isNetworkPath(abs)) throw new Error('不打开网络位置上的文件')
  let isDirectory: boolean
  try {
    isDirectory = (await fs.stat(abs)).isDirectory()
  } catch {
    throw new Error(`文件不存在：${abs}`)
  }
  if (!isDirectory && EXECUTABLE_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
    log.info(`[links] 可执行文件只定位不打开 ${abs}`)
    shell.showItemInFolder(abs)
    return
  }
  log.info(`[links] 打开 ${abs}`)
  const error = await shell.openPath(abs)
  if (error) {
    log.info(`[links] 默认程序打开失败，改为在资源管理器中定位 ${abs}：${error}`)
    shell.showItemInFolder(abs)
  }
}

/**
 * 把终端文本里识别出的路径解析成本机绝对路径：相对路径以项目目录为基准；
 * 不存在或位于网络位置的返回 null（只有存在的文件才显示为链接）。
 */
export function resolveLocalPaths(baseDir: string, candidates: string[]): (string | null)[] {
  return candidates.map((raw) => {
    if (!raw) return null
    try {
      const abs = path.resolve(baseDir, raw)
      if (isNetworkPath(abs)) return null
      statSync(abs)
      return abs
    } catch {
      return null
    }
  })
}

function isNetworkPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//')
}
