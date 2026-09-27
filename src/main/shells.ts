import fs from 'node:fs'
import path from 'node:path'
import type { ShellId, ShellInfo } from '../shared/types'
import { SHELL_IDS } from '../shared/types'
import log from './log'

/** 决定「启动 Claude / Codex」命令写法的 shell 家族 */
export type ShellFamily = 'powershell' | 'cmd' | 'bash'

export interface ResolvedShell {
  id: Exclude<ShellId, 'auto'>
  file: string
  args: string[]
  family: ShellFamily
  /** 额外的环境变量 */
  env: Record<string, string>
}

/** 本机各 shell 的位置；未安装为 null。auto 为它实际会用的 shell。 */
export function detectShells(): ShellInfo[] {
  const found: Record<ShellId, string | null> = {
    auto: null,
    pwsh: findPwsh(),
    powershell: findWindowsPowerShell(),
    cmd: findCmd(),
    gitbash: findGitBash()
  }
  found.auto = found.pwsh ?? found.powershell
  return SHELL_IDS.map((id) => ({ id, path: found[id] }))
}

/** 按设置解析要启动的 shell；所选的找不到时回退到 auto（pwsh → Windows PowerShell） */
export function resolveShell(id: ShellId): ResolvedShell {
  if (id === 'cmd') {
    const file = findCmd()
    if (file) return { id, file, args: [], family: 'cmd', env: {} }
  } else if (id === 'gitbash') {
    const file = findGitBash()
    // --login -i：与 Git Bash 窗口一致加载 profile；CHERE_INVOKING=1 让 profile 不切换到 HOME，保持在项目目录
    if (file) return { id, file, args: ['--login', '-i'], family: 'bash', env: { CHERE_INVOKING: '1' } }
  } else if (id === 'powershell') {
    const file = findWindowsPowerShell()
    if (file) return { id, file, args: ['-NoLogo'], family: 'powershell', env: {} }
  } else if (id === 'pwsh') {
    const file = findPwsh()
    if (file) return { id, file, args: ['-NoLogo'], family: 'powershell', env: {} }
  }
  if (id !== 'auto') log.warn(`[pty] 找不到所选的终端 ${id}，改用自动选择`)
  const pwsh = findPwsh()
  if (pwsh) return { id: 'pwsh', file: pwsh, args: ['-NoLogo'], family: 'powershell', env: {} }
  return {
    id: 'powershell',
    file: findWindowsPowerShell() ?? 'powershell.exe',
    args: ['-NoLogo'],
    family: 'powershell',
    env: {}
  }
}

function findPwsh(): string | null {
  return findInPath('pwsh.exe') ?? existing(path.join(programFiles(), 'PowerShell', '7', 'pwsh.exe'))
}

function findWindowsPowerShell(): string | null {
  return (
    existing(path.join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')) ??
    findInPath('powershell.exe')
  )
}

function findCmd(): string | null {
  return existing(process.env.ComSpec ?? '') ?? existing(path.join(systemRoot(), 'System32', 'cmd.exe'))
}

/**
 * Git for Windows 的 bin\bash.exe。不在 PATH 里找 bash.exe：System32\bash.exe 是 WSL 的启动器。
 * 先看常见安装位置，再从 PATH 里的 git.exe 反推（<Git>\cmd\git.exe 或 <Git>\mingw64\bin\git.exe）。
 */
function findGitBash(): string | null {
  const candidates = [
    path.join(programFiles(), 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
  ]
  const git = findInPath('git.exe')
  if (git) {
    const dir = path.dirname(git)
    candidates.push(path.join(dir, '..', 'bin', 'bash.exe'), path.join(dir, '..', '..', 'bin', 'bash.exe'))
  }
  for (const c of candidates) {
    const file = existing(path.resolve(c))
    if (file) return file
  }
  return null
}

export function findInPath(exe: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter)
  for (const raw of dirs) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const file = existing(path.join(dir, exe))
    if (file) return file
  }
  return null
}

/** 应用执行别名（WindowsApps 下的 pwsh.exe）对 stat/existsSync 会报 EACCES，只能用 lstat 判断存在 */
function existing(file: string): string | null {
  if (!file) return null
  try {
    fs.lstatSync(file)
    return file
  } catch {
    return null
  }
}

function systemRoot(): string {
  return process.env.SystemRoot ?? 'C:\\Windows'
}

function programFiles(): string {
  return process.env.ProgramFiles ?? 'C:\\Program Files'
}

/** 启动时记录一次检测结果，便于排查用户环境 */
export function logDetectedShells(): void {
  const shells = detectShells()
    .map((s) => `${s.id}=${s.path ?? '-'}`)
    .join(' ')
  log.info(`[pty] 可用终端 ${shells}`)
}
