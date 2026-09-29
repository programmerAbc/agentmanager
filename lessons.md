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

## Lesson: 改 productName 但保留 appId，升级安装会装进「旧目录\新名字」
### Problem
Agent Desk 改名 AgentManager（appId 仍为 `com.agentdesk.app`）后，用户用新安装包覆盖安装，程序被装到了 `%LOCALAPPDATA%\Programs\agent-desk\AgentManager`。
### Root Cause
electron-builder 26 的 NSIS 模板：`multiUser.nsh` 的 `setInstallModePerUser` 优先读注册表 `HKCU\Software\<由 appId 派生的 GUID>\InstallLocation`（旧的 `...\Programs\agent-desk`）作为默认目录；`assistedInstaller.nsh` 的 `instFilesPre` 发现目录路径里不含新的 `APP_FILENAME`（AgentManager），就在后面追加 `\AgentManager`。
### Solution
不改代码：让用户卸载 AgentManager（默认不删 `%APPDATA%\AgentManager`，卸载时也会删掉注册表里的 InstallLocation）→ 删掉空的 `Programs\agent-desk` → 重新安装，默认目录变为 `Programs\AgentManager`，以后升级都留在这里。
### Prevention
改 productName 时，如果保留 appId 以便升级替换旧版，要预期安装目录会嵌套：要么提示用户先卸载旧版再装，要么通过 `nsis.include` 的自定义宏处理默认目录。改名后先在测试 appId / 测试可执行名 / 测试快捷方式名下演练一次覆盖安装（不能用真实 appId，否则会卸载用户正在用的应用）。

## Lesson: 被其他窗口完全遮挡的 dev 窗口收不到 CDP 输入
### Problem
自测时 CDP 发送的按键（`Input.dispatchKeyEvent`）突然全部无效，页面 `document.visibilityState` 为 `hidden`，但窗口并没有最小化。
### Root Cause
Chromium 在 Windows 上做原生窗口遮挡检测：窗口被其他窗口完全盖住时被当成隐藏，渲染暂停、输入事件被丢弃。用户在自己的桌面上工作时，dev 窗口很容易被盖住。
### Solution
启动 dev 实例时加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`（放在 `electron-vite dev ... --` 之后传给 Electron）。
### Prevention
所有自测启动命令都带上这两个参数；测试前先用 `document.visibilityState` 确认页面可见，不要去激活或挪动窗口打扰用户。
另：Bash 工具的 heredoc 会吃掉反斜杠，写含 Windows 路径或 `\` 转义的脚本时用 Write 工具生成文件。

## Lesson: 用 UI Automation 找被遮挡窗口上的消息框不可靠
### Problem
自测关闭 dev 实例时，`click-dialog.ps1` 连续两次报「找不到对话框」，看起来像是第一次关闭窗口没有弹出退出确认。
### Root Cause
对话框其实已经弹出（Win32 `EnumWindows` 能看到可见的 `#32770`），是 UI Automation 的 `RootElement.FindAll` 在窗口被其他窗口遮挡时找不到它。应用本身没问题：单次 WM_CLOSE 后 0.5 秒内就有确认框。
### Solution
`click-dialog.ps1` 改用 Win32 `EnumWindows` + `EnumChildWindows` 查找对话框和按钮，再发 `BM_CLICK`；仍然只匹配 dev 进程的 PID。
### Prevention
测试工具报「应用没反应」时，先用另一种手段（Win32 枚举、日志）确认应用状态，再判断是应用 bug 还是工具问题。

## Lesson: 自测启动的窗口会抢走用户的键盘焦点
### Problem
打包版冒烟测试时，用 `Start-Process` 启动的测试窗口成为前台窗口，用户正在键入的内容（拼音 a'p'p）进了测试窗口的搜索框，测试的 Enter 也被输入法吞掉。
### Root Cause
新启动的 GUI 进程会被 Windows 激活到前台；用户同时在自己的窗口里打字时，按键就落进了测试窗口。
### Solution
发现后立即按 PID 关闭测试窗口，并告知用户可能丢了一段输入。
### Prevention
只在必要时启动可见的测试窗口，启动前告诉用户「接下来几十秒会弹出测试窗口，先别打字」；测试尽量短，结束立即按 PID 关闭；截图里出现不是测试发出的输入时，立刻停止测试。
dev 实例用 `AGENTMANAGER_TEST_INACTIVE=1` 启动（窗口 `showInactive()`，不抢焦点），CDP 端开启 `Emulation.setFocusEmulationEnabled`；启动后用 `GetForegroundWindow` 确认前台不是测试窗口。

## Lesson: xterm.js 的 Shift / Ctrl + Enter 与 Enter 发的是同一个 `\r`
### Problem
用户在 claude / codex 里无法输入换行：Shift+Enter、Ctrl+Enter 都直接提交，Alt+Enter 在 codex 里也不换行。
### Root Cause
xterm.js 对 Shift/Ctrl+Enter 只发 `\r`，Alt+Enter 发 `ESC \r`。Windows 上程序经 ConPTY 读输入有两种方式：Node / libuv（claude）只取字符，crossterm（codex）与 PSReadLine 读控制台按键记录（带修饰键）。同一段字节在两条路径上的含义不同（实测表见 architecture.md「迭代 5 设计」）。
### Solution
拦截 Shift/Ctrl/Alt+Enter，发送 win32-input-mode 格式的 Shift+Enter 且字符为 LF：`ESC[13;28;10;1;16;1_ESC[13;28;10;0;16;1_`。ConPTY 还原成 VK_RETURN + SHIFT、字符 `\n` 的记录：libuv 给出 `\n`（claude 的 Ctrl+J 换行），crossterm / PSReadLine 看到 Shift+Enter。keydown 时必须 `preventDefault`，否则 Shift+Enter 的 keypress 会被 xterm 再发一个 `\r`。
### Prevention
终端里的按键问题先用两个探针验证（Node 原始模式读 stdin、`[Console]::ReadKey`），再在真实程序里验证；ConPTY 会丢弃不认识的 CSI 序列（如 CSI u），不要假设序列能原样到达程序。

## Lesson: 向 ConPTY 发过 win32-input-mode 序列后，单独的 ESC 会被吞掉
### Problem
1.3.0 用户反馈：claude 的 `/resume` 选择器里按 Esc 没反应。实际是该终端用过 Shift+Enter 之后，Esc / Ctrl+[ 在 claude、codex、PowerShell 里全部失效，直到终端重启。
### Root Cause
ConPTY 收到过一次 win32-input-mode 序列（M13 的换行键）就认为终端的所有按键都会用这种格式发送，之后一段输入末尾的单独 `ESC` 不再按超时当作 Esc 键，而是当成未完成序列的开头吞掉。用 node-pty 直接写入复现：发换行序列前 `\x1b` 正常到达，之后 `\x1b`、`\x1b\x1b`、`\x1b[`、`\x1bO` 都到不了程序，完整序列（方向键、F 键、Alt+字母、粘贴）不受影响。M13 只测了换行本身，没有测「之后其他按键是否还正常」。
### Solution
每个 PTY 记录是否发过换行序列；之后 xterm 发来的单独 `\x1b` 改写为 win32-input-mode 的 Esc（`ESC[27;1;27;1;0;1_ESC[27;1;27;0;0;1_`），PTY 重启时复位。
### Prevention
向 ConPTY 注入 win32-input-mode（或任何改变其输入解析状态的）序列后，要回归测试其他按键，尤其是 Esc 这类单字节、靠超时判断的按键；复现脚本用 node-pty + 原始模式读 stdin 的子进程最快（见 handoff 验证记录）。

## Lesson: Bash 工具（Git Bash）会把以 / 开头的参数改写成 Windows 路径
### Problem
自测时 `node cdp.mjs 9223 type "/exit"` 实际输入的是 `C:/Program Files/Git/exit`，claude 把它当成提示词发出了一次请求。
### Root Cause
MSYS 的参数路径转换：传给原生 Windows 程序的、以 `/` 开头的参数会被改写成 Git 安装目录下的路径。
### Solution
这类命令前加 `MSYS_NO_PATHCONV=1`；向 claude / codex 输入斜杠命令前先读屏确认输入框内容和补全列表，再按 Enter。
### Prevention
凡是经 Bash 工具传给 node / exe 的参数含前导 `/`（斜杠命令、Unix 风格路径），一律加 `MSYS_NO_PATHCONV=1`。
另：bash 双引号里的 `\\` 会变成 `\`，拼进 JS 表达式的 Windows 路径会丢反斜杠（`\t` 还会变成制表符）；这类路径用正斜杠，或用 Write 工具写成文件。

## Lesson: 终端里的文件链接点不开——xterm 忽略非 http 链接，claude 也不输出链接
### Problem
用户在 claude 里 Ctrl+单击「[Image #N]」图片附件和文件引用打不开（在 Windows Terminal 里可以）。
### Root Cause
两层原因：1）claude 用 supports-hyperlinks 加终端白名单判断是否输出 OSC 8 超链接，Windows Terminal 靠 `WT_SESSION` 命中，我们的终端没有这些标记，claude 只输出纯文本；2）即使有 OSC 8 链接，xterm.js 默认只激活 http(s)，file 等协议的链接被直接忽略（`linkHandler.allowNonHttpProtocols` 默认 false），且默认激活方式是 `window.open`，被窗口的打开限制拦下。
### Solution
终端环境变量 `FORCE_HYPERLINK=1`；xterm `linkHandler` 开启 `allowNonHttpProtocols` 并把链接交给主进程按白名单打开；另加纯文本路径识别给 codex 等不输出超链接的程序用。
### Prevention
链接功能要分别验证「程序是否输出链接」和「终端是否接受并处理该协议」；测试时用 `printf '\e]8;;URL\e\\文字\e]8;;\e\\'` 之类手工打印 OSC 8 链接，打开类动作用「目标已删除 / 被拒绝」的用例验证整条链路，避免在用户桌面上弹出窗口。

## Lesson: 会话的 scratchpad 可能中途失效，可复用的自测工具放进项目里的忽略目录
### Problem
自测进行到一半，会话 scratchpad 被宣布不可用，里面的 CDP 脚本、关闭窗口脚本和测试数据都不能再用，只能临时重写。
### Solution
自测工具和测试数据统一放在项目内 `.devtest/`（已加入 .gitignore）：cdp.mjs、hover.mjs、pick-shell.mjs、close-dev.ps1、seed.mjs。
### Prevention
含凭据的临时文件（如复制的 codex auth.json）用完立即删除；能不复制凭据就不复制（例如用打印参数的假 codex 验证启动命令）。

## Lesson: 终端文字错乱是 xterm WebGL 字形图集的缺陷，不是字体或编码问题
### Problem
用户反馈：长时间运行 claude 的终端里，部分字符显示成别的字或重叠的碎片（汉字、英文都有），只有部分颜色的字受影响。
### Root Cause
`@xterm/addon-webgl` 0.19.0（上游 xterm.js #4480）：字形图集页写满后把 4 页合并成 1 页，其余页下标前移；GlyphRenderer 按「页下标 + 页版本号」决定是否重新上传纹理，而版本号是每页从 0 数起的小整数。第二次合并时新合并页（版本 1）正好落在第一次合并页原来的下标上、版本也是 1，纹理不重新上传，这一页上的字形全部从旧纹理取样。所有终端共用同一个图集（同字体 / 字号 / 配色），汉字多、颜色多时很快写满。
### Solution
Vite 插件 `scripts/xtermWebglAtlasFix.ts` 在构建时按上游 beta 的思路修补压缩后的 addon：页版本号全局递增、布局变化计数由每个渲染器各自比较、更新途中合并则当帧重建、纹理上传不越界。任一替换没有恰好匹配一次就构建失败。dev 下必须把 `@xterm/addon-webgl` 排除出 `optimizeDeps`，预构建的依赖不经过插件 transform。已经错乱的旧版本：`Ctrl+=` 再 `Ctrl+0` 换一次字号即可恢复（重建图集并重新上传纹理）。
### Prevention
渲染类问题先在 dev 里用可重复的压力脚本复现（`.devtest/atlas-stress.mjs` 逐屏打印上万个不同汉字，`atlas-test.mjs` 截图后换字号、重印同一屏、逐像素比较）。复现要从全新启动的实例开始：图集状态跨运行累积，同一实例里第二次运行不一定触发。升级 xterm / addon 时查看上游是否已修，已修就删除插件。给依赖打补丁优先在构建时做精确替换并校验匹配次数，不要手改 node_modules。

## Lesson: 类选择器设置了 display 时，`hidden` 属性不生效
### Problem
给顶部栏的 `.icon-btn`（「结束终端」）设置 `hidden = true`，按钮仍然显示。
### Root Cause
`hidden` 只是 UA 样式表里的 `[hidden] { display: none }`，优先级低于作者样式；`.icon-btn { display: inline-grid }` 把它覆盖了。
### Solution
styles.css 里补 `.icon-btn[hidden] { display: none }`（与已有的 `.status-chip[hidden]`、`.launch-agent[hidden]` 等放在一起）。
### Prevention
用 `hidden` 控制显示前，先查该元素的类有没有设置 `display`；自测时用 `getComputedStyle(el).display` 确认，而不是只看 `el.hidden`。

## Lesson: CDP 里的 `element.click()` 不会移动焦点
### Problem
验证「切到没有终端的项目后，键盘输入不会进入上一个项目隐藏的终端」时，用 `Runtime.evaluate` 执行 `li.click()`，焦点仍留在隐藏终端的输入框里，看起来像是缺陷。
### Root Cause
脚本调用的 `click()` 只派发 click 事件，不经过 mousedown 的默认行为，焦点不会转移；真实鼠标点击会把焦点移到可聚焦的 `li`（tabIndex=0）。
### Solution
焦点相关的验证用 `Input.dispatchMouseEvent` 发真实的按下 / 抬起：`node .devtest/mouse.mjs 9223 "<选择器>"`（点元素中心）。
### Prevention
只关心事件逻辑时可以用 `click()`；凡是结论依赖焦点、hover、选区的，一律用真实输入事件验证。
