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

## Lesson: node-pty 1.1 的 kill 顺序与 conhost 残留
### Problem
1) shell 自然退出后 conhost.exe 残留；2) 先 `pty.kill()` 再 taskkill 时 taskkill 报错，claude 以隐藏控制台启动的孙进程会成为孤儿；3) shell 已死时调用 `pty.kill()`，dev 输出里出现 `conpty_console_list_agent.js ... Error: AttachConsole failed`。
### Root Cause
node-pty `src/win/conpty.cc` 的退出线程在 shell 退出时 `remove_pty_baton`，但不调用 ClosePseudoConsole；之后 `PtyKill` 找不到句柄成为空操作。`pty.kill()` 还会 fork 一个 agent 去 AttachConsole 到 shell，shell 已死则该子进程崩溃（无害）。ClosePseudoConsole 会在几毫秒内结束控制台上的所有进程，taskkill 来不及枚举树。
### Solution
先 `taskkill /T /F` 并等待完成（树完整时枚举），失败时才 `pty.kill()` 兜底；接受被结束会话的 conhost 留到应用退出（系统回收，已验证退出后无残留）。
### Prevention
改 kill 逻辑前先用 `children.ps1` 类脚本（按父 PID 列 electron 主进程的子进程）+ 按 PID 检查孙进程验证；升级 node-pty 时复查 conpty.cc 是否已修复，修复后可在退出/kill 后调用 pty.kill() 释放 conhost。

## Lesson: 从 Claude Code 会话里启动 Agent Desk 会把会话标记传给终端里的 claude
### Problem
Agent Desk 终端里运行的 claude 提示 "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker"。
### Root Cause
在 Claude Code 的 shell 里执行 `npm run dev`，`CLAUDECODE`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_CODE_MESSAGING_*` 等会话标记一路继承到 PTY。
### Solution
`ptyManager.buildEnv` 始终剔除这些会话级标记（保留 `ANTHROPIC_*`、`CLAUDE_CONFIG_DIR` 等用户配置）。
### Prevention
新增环境变量处理时区分「会话标记」与「用户配置」。

## Lesson: will-navigate 全拦截会挡住页面刷新，did-start-navigation 会误报
### Problem
dev 下改渲染进程代码后页面并没有刷新，但主进程日志显示「渲染进程重新加载，清理全部 PTY」，渲染进程仍以为终端在运行；之后该实例退出时卡住。
### Root Cause
`will-navigate` 对所有导航 `preventDefault`，连 `location.reload()` 也被取消；而 `did-start-navigation` 在导航被取消之前就触发，据此清理 PTY 造成状态不一致。
### Solution
`will-navigate` 放行与当前页面相同（忽略 hash）的 URL；清理 PTY 改为监听 `did-navigate`（导航已提交）。
### Prevention
基于导航事件做清理时，用「已提交」类事件；验证时对比 `performance.timeOrigin` 确认页面是否真的重载。

## Lesson: 从 Claude Code 里启动时终端全无颜色（NO_COLOR）
### Problem
dev 实例终端里的 claude 全是白字，而开始菜单启动的安装版是彩色的。
### Root Cause
Claude Code 给自己的工具 shell 设置了 `NO_COLOR=1`，在其中执行 `npm run dev` 时一路继承到 PTY。
### Solution
`buildEnv` 在检测到 `CLAUDECODE` 标记时一并去掉 `NO_COLOR`；否则保留用户自己的设置。
### Prevention
排查终端颜色 / 行为差异时先对比环境变量（dev 与安装版的启动来源不同）。

## Lesson: 焦点上报会被误当成用户输入
### Problem
项目 A 的 claude 显示「已完成」，切到项目 B 时 A 的状态立刻变成「就绪」。
### Root Cause
claude 开启了焦点上报（DECSET 1004），xterm 失焦时自动通过 onData 发送 `ESC[O`，被当作用户输入触发了「已查看」。
### Solution
`handleInput` 中 `ESC[I` / `ESC[O` 不触发 `onInput`。
### Prevention
凡是用 onData 推断「用户行为」的逻辑，都要排除终端自动回报的序列（焦点、光标位置、设备属性等）。

## Lesson: claude hooks 的输出会进入上下文
### Problem / Root Cause
`SessionStart`、`UserPromptSubmit` 的 hook 标准输出会被加进 claude 的上下文。
### Solution
hooks 服务对上报请求回 204（无响应体），`curl -s` 因此不输出任何内容。
### Prevention
修改 hookServer 响应时保持无响应体。

## Lesson: Electron 44 可以直接用 node:sqlite
### Problem
需要 SQLite，但不想再引入一个要针对 Electron 编译、打包时 asarUnpack 的原生模块（better-sqlite3）。
### Root Cause / Solution
Electron 44 内置 Node 24.21，`node:sqlite`（`DatabaseSync`，SQLite 3.53）在主进程可用；electron-vite 构建时保持 `require("node:sqlite")` 外部引用，打包后同样可用。
### Prevention
升级 Electron 时确认 `process.versions.sqlite` 仍存在；`node:sqlite` 仍标记为实验特性，系统 Node 下使用会打印 ExperimentalWarning（无害）。

## Lesson: 测试脚本误关了用户正在使用的 Agent Desk
### Problem
自测时用 `close-window.ps1`（按窗口标题「Agent Desk」发 WM_CLOSE）和 `click-dialog.ps1`（点标题为 Agent Desk 的消息框按钮）关闭 dev 实例，结果把用户同时在用的打包版也关了，并在它的「有 N 个终端仍在运行」确认框上点了「退出」，用户的 4 个终端（含 claude 会话）被结束。
### Root Cause
脚本按窗口标题匹配，没有区分进程；dev 实例与用户的应用标题相同。
### Solution
两个脚本改为只匹配本项目 `node_modules\electron\electron.exe` 的进程（或显式传入的测试进程 PID）；绝不按标题操作 `agent-desk.exe`。
### Prevention
任何会关闭窗口 / 点击对话框 / 结束进程的自动化操作，必须先按进程（路径或 PID）限定目标；用户可能同时在用同一个应用。动手前用进程列表确认目标。

## Lesson: codex hooks 的信任与执行方式
### Problem
通过 `-c` 注入的 codex hooks 每次启动都弹「Hooks need review」；hook 命令在 codex 里没有生效。
### Root Cause
codex 按 hook 命令内容的哈希记录信任（写在 `~/.codex/config.toml` 的 `[hooks.state]`，键为 `<session-flags>` + 事件 + 位置），命令文本一变就要重新信任；codex 在 Windows 上用 PowerShell 执行 hook，`@-`、`{{…}}` 等写法在 PowerShell 下不成立。codex 的 SessionStart 在第一轮对话时才触发，且没有 SessionEnd 事件。
### Solution
hook 命令文本固定为 `$null = @($input); curl.exe -s -m 2 -d <事件> $env:AGENT_DESK_HOOK_URL`，会变的地址放在终端环境变量里，整段 hooks 配置放在 `AGENT_DESK_CODEX_HOOKS`；启动命令用 `try { … } finally { 上报 SessionEnd }` 包裹。
### Prevention
改动 `CODEX_HOOK_EVENTS` 的顺序或 hook 命令文本会让所有用户重新信任一次，确有必要才改。

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
