# Lessons

## Lesson: node-pty 源码编译需要 Spectre 缓解库
### Problem
`electron-rebuild` 编译 node-pty 报 `MSB8040: 此项目需要缓解了 Spectre 漏洞的库`。
### Root Cause
node-pty 的 binding.gyp 为 Windows 目标开启了 `SpectreMitigation`，VS Build Tools 默认不装 Spectre 库。
### Solution
用 VS Installer 补装组件 `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`（命令见 README）。
### Prevention
README「环境要求」列出了该组件；新机器先装齐再 `npm install`。

## Lesson: NoDefaultCurrentDirectoryInExePath 导致 winpty gyp 失败
### Problem
`gyp: Call to 'cmd /c "cd shared && GetCommitHash.bat"' returned exit status 1`。
### Root Cause
环境变量 `NoDefaultCurrentDirectoryInExePath=1`（AI 编程工具的 shell 会设置）让 cmd 不在当前目录查找可执行文件，winpty.gyp 依赖这一行为。
### Solution
`scripts/postinstall.mjs` 在调用 electron-rebuild 的子进程环境中删除该变量。
### Prevention
不要把 postinstall 改回直接调用 `electron-rebuild`。

## Lesson: Electron 44 不在 npm install 时下载二进制
### Problem
`node_modules/electron/dist` 为空，直接运行 electron.exe 失败。
### Root Cause
新版 electron 包没有 postinstall，在首次 `require('electron')`（例如 electron-vite 启动时）才下载二进制。
### Solution
正常走 `npm run dev` 会自动下载；手动需要时运行 `node node_modules/electron/install.js`。
### Prevention
离线/CI 环境需提前准备 Electron 缓存或设置镜像。

## Lesson: pwsh 应用执行别名对 stat/existsSync 不可见
### Problem
`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` 用 `fs.existsSync` 返回 false，`fs.statSync` 报 EACCES。
### Root Cause
应用执行别名是 AppExecLink 类型的重解析点，stat 跟随链接会失败。
### Solution
在 PATH 中查找 shell 时用 `fs.lstatSync` 判断存在；node-pty 可以直接 spawn 该别名。
### Prevention
在 Windows 上检测可执行文件存在性时优先 lstat。

## Lesson: Vite dev server 只监听 ::1 导致 Electron 连接被拒
### Problem
`npm run dev` 后窗口空白，日志 `Failed to load URL: http://localhost:5173/ with error: ERR_CONNECTION_REFUSED`。
### Root Cause
Vite 把 `localhost` 解析为 `::1` 只监听 IPv6，Electron 以 IPv4 访问。
### Solution
`electron.vite.config.ts` 中 `renderer.server.host = '127.0.0.1'`。
### Prevention
保留该配置。

## Lesson: 工具调用中的 `cd` 会改变后续命令的工作目录
### Problem
一次 bash 调用里 `cd node_modules/electron-vite` 后，后续 `npm install` 跑在了依赖包目录里，往里面装了一堆包。
### Root Cause
会话的工作目录在调用之间持久化。
### Solution
删除被污染的包目录后在项目根目录重装。
### Prevention
命令里使用绝对路径，避免 `cd`；必要时在命令开头显式 `Set-Location` 到项目根目录。
