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
一次 bash 调用里 `cd node_modules/electron-vite` 后，后续 `npm install` 跑在了依赖包目录里：往里面装了一堆包，而且该包的生命周期脚本（simple-git-hooks）把 electron-vite 自己的 `pre-commit`（`npx lint-staged`）和 `commit-msg` hook 装进了本仓库的 `.git/hooks`，导致后来 `git commit` 失败。
### Root Cause
会话的工作目录在调用之间持久化；simple-git-hooks 会向上查找 git 根目录安装 hook。
### Solution
删除被污染的包目录后在项目根目录重装；删除误装的两个 hook（创建时间与误装时刻一致）。
### Prevention
命令里使用绝对路径，避免 `cd`；必要时在命令开头显式 `Set-Location` 到项目根目录。commit 被陌生 hook 拦截时先查 hook 来源，不要用 `--no-verify` 绕过。

## Lesson: 退出时异步写配置会丢
### Problem
关闭窗口后 settings.json 里 `window` 仍为 null。
### Root Cause
`close` 事件里发起的异步原子写还没完成，`before-quit` 清理完成后进程就退出了。
### Solution
`JsonFileWriter.flush()`；`before-quit` 中与 PTY 清理一起等待两个存储落盘（整体仍受 2 秒上限约束）。
### Prevention
任何在退出路径上发起的异步写都要在 before-quit 里等待。
另：用 CDP 在渲染进程执行 `window.close()` 不会触发 BrowserWindow 的 `close` 事件，测试关闭流程要向窗口发 `WM_CLOSE`（模拟点标题栏关闭按钮）。
