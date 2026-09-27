// postinstall：用 @electron/rebuild 针对当前 Electron 版本从源码编译 node-pty。
//
// node-pty 的 binding.gyp 会加载 winpty.gyp，其中执行 `cd shared && GetCommitHash.bat`。
// 如果环境里设置了 NoDefaultCurrentDirectoryInExePath（部分 AI 编程工具的 shell 会设置），
// cmd 不会在当前目录查找 bat，gyp 直接失败。这里在子进程环境中去掉该变量。
import { spawnSync } from 'node:child_process'

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[key]
}

const result = spawnSync('electron-rebuild', ['-f', '-o', 'node-pty'], {
  stdio: 'inherit',
  env,
  shell: true
})

if (result.status !== 0) {
  console.error(
    '\n[agentmanager] node-pty 编译失败。请确认已安装 README「环境要求」一节列出的 VS Build Tools 组件和 Python。\n'
  )
}
process.exit(result.status ?? 1)
