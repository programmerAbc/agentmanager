# Architecture — AgentManager

## 进程与模块

```
主进程 (src/main)
  index.ts         窗口创建、生命周期、退出确认与清理、窗口状态持久化
  ipc.ts           注册所有 ipcMain handler；参数校验；sessionId → 项目映射
  ptyManager.ts    PTY 创建/写入/resize/kill，以 sessionId 为键；输出批量转发；进程树清理
  projectStore.ts  项目存储（SQLite：agentmanager.db；含损坏恢复）
  hookServer.ts    接收 claude hooks 上报的本地 HTTP 服务
  settingsStore.ts settings.json 读写
  jsonFile.ts      原子写（临时文件 + fsync + rename，串行队列）、损坏文件备份
  log.ts           electron-log → userData/logs/main.log；兜底捕获未处理异常
preload (src/preload/index.ts)
  沙箱 preload，contextBridge 暴露 window.api（类型见 shared/types.ts 的 Api）
渲染进程 (src/renderer)
  main.ts          入口，组装各模块
  sidebar.ts       项目列表 UI：搜索过滤、选中、行内重命名、右键菜单、宽度拖拽
  fuzzy.ts         模糊匹配与打分（纯函数，无 DOM 依赖）
  terminalView.ts  TerminalView（每个项目一个 xterm 实例 + DOM 容器，状态 idle/starting/running/exited/failed）
                   TerminalManager（按 sessionId 管理视图，切换项目只切换可见性，结束终端 / 移除项目时才 dispose；分发 PTY 输出）
  contextMenu.ts   DOM 右键菜单；toast.ts 右下角提示
共享 (src/shared/types.ts)
  Project / 设置类型、IPC 通道名常量、window.api 接口
```

## 数据流

- 键盘输入：xterm `onData` → `api.pty.write`（ipcRenderer.send）→ `ptyManager.write` → node-pty。
- 输出：node-pty `onData` → 每个会话攒 4ms → `webContents.send('pty:data', id, data)` → 对应 xterm `write`（后台项目同样写入，保证切回来内容完整）。
- 退出：node-pty `onExit` → 先 flush 剩余输出 → `pty:exit`。被主动 kill 的会话先从表中摘除并解绑监听，不会再发 data/exit，渲染进程可以立即用同一 sessionId 重新 open。

## 关键决策

| 决策 | 原因 |
|---|---|
| node-pty 1.1.0，postinstall 通过 `scripts/postinstall.mjs` 调用 `electron-rebuild -f -o node-pty` 从源码编译 | PLAN 要求 postinstall 用 @electron/rebuild。node-pty 1.1 已改为 N-API 并自带 prebuilds（已验证在 Electron 44 可直接加载），源码编译产物 `build/Release` 优先于 prebuilds 被加载。包装脚本用于去掉 `NoDefaultCurrentDirectoryInExePath`（见 lessons.md）。 |
| 使用系统 ConPTY（`useConptyDll: false`，node-pty 默认） | 目标平台 Win10 1903+ 均自带 ConPTY；暂不引入捆绑的 OpenConsole.exe。 |
| PTY 以 sessionId 为键，当前 sessionId === projectId，映射集中在 `ipc.ts#projectIdOfSession` | PLAN §9：以后一个项目多会话、守护进程化时不必改 ptyManager 接口。 |
| kill：先 `taskkill /PID <pid> /T /F` 并等待完成；仅当 taskkill 失败时才调用 `pty.kill()` | 实测：若先 `pty.kill()`，ClosePseudoConsole 在几毫秒内结束 shell，taskkill 找不到树；claude 以隐藏控制台启动的孙进程（MCP server 等）不挂在我们的控制台上，会成为孤儿。先 taskkill 能在树完整时枚举。代价见下一行。 |
| 已知限制：shell 退出（自然退出或被 taskkill）后，该会话的 conhost.exe 留到应用退出 | node-pty 1.1 原生退出线程在 shell 退出时丢弃 pseudoconsole 句柄但不调用 ClosePseudoConsole，之后 `pty.kill()` 是空操作。空闲 conhost 约几 MB，应用退出时由系统回收（已验证退出后无残留）。升级 node-pty 修复后可去掉。 |
| 退出时 `before-quit` 中 preventDefault，killAll 最多等 2 秒后再 `app.quit()` | PLAN M5：清理但不阻塞退出超过 2 秒。 |
| 所有 invoke handler 在主进程内 try/catch，返回 `OpResult` / `DataResult` | PLAN §7：错误通过返回值传递，主进程不崩溃；另有 electron-log errorHandler 兜底。 |
| 剪贴板、确认框、打开链接都走 IPC 由主进程执行 | 渲染进程开启 sandbox，且不依赖 `navigator.clipboard` 权限。 |
| 窗口状态：自己跟踪「普通状态」下的 bounds（只在非最大化/最小化/全屏时由 resize/move 更新），关闭时与 `isMaximized()` 一起保存；恢复时校验与某个显示器工作区重叠 ≥100×100，否则只保留尺寸 | 150% 缩放下最大化窗口的 `getNormalBounds()` 每次偏大约 4px，重启会持续漂移。 |
| 退出流程：窗口 `close` 时若有 PTY 运行则弹原生确认框；`before-quit` 中 preventDefault，并行执行 killAll + 两个存储 flush，最多 2 秒后 `app.quit()` | PLAN M5；flush 避免关闭时的最后一次写入丢失。 |
| `Menu.setApplicationMenu(null)` | 使用原生标题栏但不需要菜单栏；同时去掉默认菜单的 Ctrl+= / Ctrl+- / Ctrl+0 页面缩放快捷键（这些键用于终端字号）。dev 下 F12 打开 DevTools。 |
| 窗口禁止导航和 window.open | 安全：只加载应用自身页面，链接统一用 `shell.openExternal`（仅 http/https）。 |
| Vite dev server 绑定 `127.0.0.1` | Vite 默认只监听 `::1`，Electron 在部分环境下以 IPv4 访问 localhost 导致 ERR_CONNECTION_REFUSED。 |
| 字体 TTF 直接提交在 `resources/fonts/`（约 25MB），CSS `@font-face` 相对路径引用，由 Vite 作为资源打包 | 离线可构建；启动时先 `document.fonts.load` 再创建 xterm，避免用回退字体测量字符宽度。 |
| 终端容器两层：外层 `.term-pane` 带 8px padding，内层 `.term-mount` 挂 xterm | FitAddon 用 xterm 父元素的计算尺寸；padding 不能放在 xterm 元素或其直接父元素上（PLAN §6）。 |
| 构建时修补 `@xterm/addon-webgl` 0.19.0 的字形图集（Vite 插件 `scripts/xtermWebglAtlasFix.ts`，只作用于渲染进程；dev 下该包不预构建，否则插件的 transform 不生效） | 0.19.0 的缺陷（上游 xterm.js #4480，0.20 beta 已修、未发正式版）：图集页写满后合并，GlyphRenderer 按「页下标 + 页版本号」决定是否重新上传纹理，而版本号是每页从 0 数起的小整数；第二次合并时新合并页（版本 1）落在第一次合并页原来的下标上且版本同为 1，纹理不重新上传，该页字形全部取错——用户看到终端文字错乱 / 重叠（dev 实测可稳定复现）。修补与上游一致：页版本号全局递增；布局变化改为计数，每个渲染器各自记住看到的值（共用图集的隐藏终端再显示时整屏重建）；一帧更新途中合并则当帧重建；上传纹理不超出纹理单元数。不升级到 beta：xterm 6.1 beta 牵涉面大，已验证的换行 / Esc / 链接行为都要重测。按压缩代码精确替换，任一处不是恰好匹配 1 次就构建失败——升级 addon-webgl 时先确认上游是否已修，已修则删除插件。备选的「改用 DOM 渲染器」性能差，未采用。 |

## 迭代 2 设计（M7 / M8）

| 决策 | 原因 |
|---|---|
| 配色用 `@material/material-color-utilities`（Google 官方，Apache-2.0）在渲染进程从种子色生成 MD3 暗色方案，写成 `:root` 上的 `--md-sys-color-*` CSS 变量，并同步到 xterm 主题 | MD3 动态配色依赖 HCT 色彩空间，自己实现容易偏离规范；库纯 TS、只进渲染进程 bundle |
| 图标用 `@material-symbols/svg-400`（Apache-2.0）的 Rounded SVG，经 Vite `?raw` 按需导入 | 官方 MD3 图标；只打包用到的几个 |
| MD3 Expressive 动效用 CSS `cubic-bezier` 近似弹簧（带回弹的 spatial 曲线 + 无回弹的 effects 曲线）；加载指示器为 SVG SMIL 在多个圆角多边形之间做路径变换并旋转 | 不引入动画库；路径由极坐标采样同样点数生成，保证可插值 |
| 字体检测：渲染进程 `queryLocalFonts()` 取已安装字体族，canvas 比较 `i` 与 `W` 宽度过滤等宽字体；失败时只提供默认列表 | Chromium 内置 API，无需主进程枚举注册表 |
| 设置扩展为 `{sidebarWidth, fontSize, fontFamily, lineHeight, themeSeed, claudeCommand, codexCommand, lastProjectId, window}`，主进程校验与限幅 | 单一持久化入口 |
| Claude 状态：主进程 `hookServer` 监听 `127.0.0.1:0`（随机端口）+ 随机 token；启动 Claude 时为会话写 `userData/claude-hooks/<sessionId>.json`（端口、token、sessionId 直接写进 hook 命令），命令追加 `--settings "<该文件>"`；hook 命令为 `curl.exe -s -m 2 -X POST --data-binary "@-" http://127.0.0.1:<port>/hook/<token>/<sessionId>/<event>` | 用户选择不改全局配置；实测 claude 在 Windows 上用 Git Bash 执行 hook，该命令在 bash / cmd / PowerShell 下都成立，且不依赖环境变量展开；curl.exe 为系统自带 |
| 状态机放在渲染进程（`claudeStatus.ts`）：idle / working / waiting / done / none；「已完成」在项目被查看后转空闲 | 「是否被查看」只有渲染进程知道 |
| 启动命令由主进程拼接并直接写入 PTY（`agents.launch(sessionId, agent)`） | 命令、hooks 文件路径、端口都在主进程，渲染进程只负责确保终端已启动 |
| **Codex（M10）**：终端启动时注入 `AGENT_DESK_HOOK_URL`（`…/hook/<token>/<sessionId>/codex`）和 `AGENT_DESK_CODEX_HOOKS`（固定的 hooks TOML）；启动命令 `try { <命令> -c $env:AGENT_DESK_CODEX_HOOKS } finally { curl.exe -s -m 2 -d SessionEnd $env:AGENT_DESK_HOOK_URL \| Out-Null }`；hook 命令 `$null = @($input); curl.exe -s -m 2 -d <事件> $env:AGENT_DESK_HOOK_URL`，服务端从请求体读事件名 | codex 对 hook 命令文本做信任校验（变化即需重新信任），所以文本必须固定；codex 在 Windows 用 PowerShell 执行 hook（实测）；codex 无 SessionEnd，靠 PowerShell finally（Ctrl+C 也会执行）上报退出 |
| 状态机 `AgentStatusTracker`：每个终端只跟踪一个助手 `{agent, status}`；claude 启动后等 SessionStart（30 秒超时），codex 启动后直接「就绪」（其 SessionStart 在第一轮对话才触发） | 两种助手的事件时序不同 |

## 迭代 4 设计（M11 / M12）

| 决策 | 原因 |
|---|---|
| 项目搜索在渲染进程内存中完成：`fuzzy.ts` 实现 fzy 式动态规划（子序列最优对齐；连续命中 +1.0，开头 / 分隔符后 +0.9，`-_` 空格后 +0.8，驼峰 +0.7，`.` 后 +0.6；间隔每字符 -0.01，开头前 -0.005），同时回溯出命中位置供高亮 | 项目数量小（几十个），无需索引或依赖；自己实现可以同时拿到得分和位置，且下标统一按码点计算（中文 / emoji 不错位） |
| 多个词按空格拆分、全部命中才保留；每个词先匹配名称（加 10000 分，保证名称命中排在前面），再匹配**侧栏显示的缩写路径**的某一级目录名（不跨 `\`） | 整条长路径做子序列匹配几乎能匹配任何短词；只匹配显示出来的路径，每个命中都看得见、能高亮（测试中隐藏目录名导致全部项目「莫名其妙」匹配，因此改为此规则） |
| 过滤只重建 `<ul>` 内容，项目状态（运行 / 助手状态）保存在 Sidebar 的 Map 里，渲染时重新应用；搜索词不持久化 | 与原有的 setProjects 渲染路径一致，状态不会因过滤丢失 |
| `Ctrl+Shift+F` 由 document 捕获阶段监听处理，终端的 `attachCustomKeyEventHandler` 对它返回 false | 与 `Ctrl+,` 等应用快捷键相同的模式：焦点在终端里也生效，且不发给 PTY；对话框打开时不响应 |
| 输入法：`input` 事件 `isComposing` 时跳过，`compositionend` 再过滤 | 避免拼音组字过程中列表闪烁 |
| 白色 / 黑色主题仍以种子色保存（`#FFFFFF` / `#000000`，`shared/types.ts` 的 `themeModeOf`），不新增设置字段 | 设置格式与校验不变；自定义颜色选到这两个值时行为一致 |
| 白 / 黑用 `SchemeMonochrome`（浅 / 深，2025 规范），其余用 `SchemeTonalSpot` 深色；再按模式用中性色板 tone 覆盖 surface 系列（白：surface / lowest / low / bright = 100；黑：surface / dim / lowest / low = 0，container 6、high 10、highest 17、bright 22） | 单色方案给出无彩色强调；规范默认的 surface（98 / 6）不是纯白 / 纯黑，而用户要的是白底 / 纯黑界面，面板仍需与背景拉开层次 |
| 浅色终端：VS Code Light 的 ANSI 16 色 + xterm `minimumContrastRatio: 4.5`（深色为 1，保持原样）；`applyTheme` 返回 `{theme, minimumContrastRatio}` 并入 `TerminalAppearance` | claude 等程序默认按深色背景输出颜色（包括 24 位真彩色），最小对比度让 xterm 自动调暗过浅的前景色 |
| 防闪烁：主进程按主题设置 `BrowserWindow.backgroundColor`（`WINDOW_BACKGROUND`），设置更新时 `setBackgroundColor`；`<html class="booting">` 期间页面透明、`#app` 隐藏，App 构造完成（已应用主题）后移除 | 窗口在首次绘制（ready-to-show）时显示，那时主题还没应用，CSS 默认深色会先闪一下 |
| `document.documentElement.style.colorScheme` 随模式切换 | 原生滚动条、颜色选择器等跟随明暗 |

## 迭代 5 设计（M13）

**换行按键**。实测（dev 实例，pwsh 下分别用 Node 原始模式读 stdin 与 `Console.ReadKey` 读控制台记录）：

| 终端发送 | Node / libuv（claude 的读法） | 控制台记录（codex / crossterm、PSReadLine 的读法） |
|---|---|---|
| xterm 默认 Shift/Ctrl+Enter：`\r` | `\r`（提交） | Enter，无修饰键 |
| xterm 默认 Alt+Enter：`ESC \r` | `ESC \r`（claude 换行） | Alt+Enter（codex 不换行） |
| `\n` | `\n`（claude Ctrl+J 换行） | Ctrl+Enter |
| CSI u `ESC[13;2u` | 原样字符（claude 认作 Shift+Enter） | 被 ConPTY 丢弃 |
| win32-input-mode Shift+Enter，字符 CR | `\r` | Shift+Enter |
| **win32-input-mode Shift+Enter，字符 LF**：`ESC[13;28;10;1;16;1_ESC[13;28;10;0;16;1_` | **`\n`** | **Shift+Enter** |

| 决策 | 原因 |
|---|---|
| `Shift` / `Ctrl` / `Alt` + `Enter` 在 `attachCustomKeyEventHandler` 里拦截，发送上表最后一行（按下 + 抬起两条记录），keydown 时 `preventDefault` 且对 keypress / keyup 也返回 false | 唯一在三条路径上都成立的序列：claude 收到 `\n`（Ctrl+J）换行；codex 与 PSReadLine 收到真正的 Shift+Enter（codex 界面提示「Shift+⏎ newline」，PSReadLine 为 AddLine）。已在 claude 2.1.283、codex 0.157.1、pwsh 7.6 实测。不 preventDefault 时 Shift+Enter 还会产生 keypress，被 xterm 当成 `\r` 再发一次 |
| Windows build < 22000 时退回只发 `\n` | 老版本 ConPTY 是否解析 win32-input-mode 未验证；`\n` 至少在 claude 里是换行 |
| 当前 PTY 发过换行序列后，单独的 `ESC`（Esc、Ctrl+[）改发 win32-input-mode 的 Esc：`ESC[27;1;27;1;0;1_ESC[27;1;27;0;0;1_`；每次 PTY 启动时复位 | ConPTY 收到过一次 win32-input-mode 序列后，认为终端所有按键都会这样发，此后一段输入末尾的单独 `ESC` 被当成未完成序列吞掉（node-pty 实测，直到该 PTY 结束都不恢复）——Esc 在 claude（如 `/resume` 选择器）、codex、PSReadLine 里全部失效。改发的 Esc 在三条路径上都是 Esc（libuv 得到 `\x1b`，控制台记录为 VK_ESCAPE）。只在发过换行序列后才改写，保持从未按过换行键的会话与原来完全一致。仍受影响（未处理，罕见）：`Alt+[`、`Alt+Shift+O`、`Alt+Esc` 这类以不完整序列结尾的输入 |
| 光标样式存在设置 `cursorStyle`（bar / underline / block，默认 bar），映射到 xterm `cursorStyle`，`cursorInactiveStyle` 取同一形状（block 失焦为 outline），竖线宽 2px | 用户不喜欢默认方块；xterm 默认失焦时画空心方块，与竖线不一致；1px 在高 DPI 下太细 |
| 开发模式下环境变量 `AGENTMANAGER_TEST_INACTIVE=1` 时窗口用 `showInactive()` 显示 | 自测时不抢用户的键盘焦点（见 lessons.md）；打包版不受影响 |

## 迭代 5 设计（M14 / M15）

| 决策 | 原因 |
|---|---|
| `src/main/shells.ts` 集中检测与解析 shell：pwsh（PATH → `Program Files\PowerShell\7`）、Windows PowerShell（`System32\WindowsPowerShell\v1.0`）、cmd（`ComSpec`）、Git Bash（常见安装目录 → 由 PATH 里的 `git.exe` 反推 `<Git>\bin\bash.exe`）；设置 `shell`（auto / pwsh / powershell / cmd / gitbash，默认 auto）在 `pty.open` 时解析，找不到回退 auto；启动时把检测结果写日志 | 用户要求可选终端；Git Bash 不能从 PATH 找 `bash.exe`（System32 下的是 WSL 启动器）；应用执行别名只能用 lstat 判断存在 |
| Git Bash 以 `bin\bash.exe --login -i` 启动并设置 `CHERE_INVOKING=1` | 与 Git Bash 窗口一致加载 profile；profile 默认会 cd 到 HOME，该变量让它留在项目目录（实测） |
| PtyManager 为每个会话记录 shell 家族（powershell / cmd / bash），`launchLine` 据此生成助手启动命令：claude 的 `--settings` 路径在 PowerShell / bash 用单引号（`''` / `'\''` 转义）、cmd 用双引号；codex 分别用 `try/finally`、`&`、`;` 串联退出上报，hooks 配置都从 `AGENT_DESK_CODEX_HOOKS` 取（`"%VAR%"` / `"$VAR"`） | hooks 的 TOML 里没有双引号，放进双引号安全；hook 命令文本不变，codex 不会要求重新信任。实测 codex 在 cmd 里以原始模式读 Ctrl+C，不会中断 `&` 后面的上报 |
| 设置页下拉菜单通用化为 `showSelectMenu(options)`（value / label / tag / disabled / fontFamily），字体与默认终端共用；未安装的终端显示为禁用项 | 避免复制一套菜单 |
| 助手运行时隐藏顶部栏的两个启动按钮（`hidden`），只留状态标签 | 用户反馈禁用的按钮多余 |
| 链接统一 Ctrl（或 Cmd）+ 单击：xterm `linkHandler`（`allowNonHttpProtocols: true`，否则 xterm 直接忽略 file 等非 http 的 OSC 8 链接）、WebLinksAddon、自定义 `PathLinkProvider` 三处共用 `activateLink`；悬浮时设置终端容器的 `title` 作为提示 | xterm 6 的 Linkifier 在元素上直接监听鼠标，程序开启鼠标上报时链接仍可用 |
| `PathLinkProvider`（`src/renderer/pathLinks.ts`）：按单元格重建逻辑行（含自动换行续行，宽字符按 2 格映射），正则识别路径，再经 IPC `links.resolvePaths` 让主进程以项目目录为基准判断存在，只返回存在的 | 路径常被自动换行截断；只链接存在的文件避免把「node.js」「v1.2」之类误判成链接 |
| 主进程 `links.ts` 负责打开：协议白名单；file 链接拒绝主机名；本机路径拒绝 UNC；可执行扩展名只 `showItemInFolder`；`shell.openPath` 失败（无关联程序）时也改为定位 | 终端输出不可信：恶意文本里的 OSC 8 链接不应能直接运行程序或触发访问网络共享（NTLM 凭据泄露） |
| 终端环境变量 `FORCE_HYPERLINK=1`（`??=`，尊重用户设置） | claude 的超链接判断（supports-hyperlinks + 终端白名单，Windows Terminal 靠 `WT_SESSION`）在我们的终端里为否，不会输出 OSC 8；该变量是 supports-hyperlinks 的标准开关 |

## 迭代 6 设计（M16）

| 决策 | 原因 |
|---|---|
| 「结束终端」= `TerminalManager.end(id)`：先把视图从管理器摘除（之后到达的输出 / 退出事件被丢弃）→ `setState('idle')`（运行中时触发 `onRunningChange(false)`：侧栏圆点、助手状态清除）→ dispose xterm → 异步 `pty.kill`（taskkill 整棵进程树，失败时 toast）。界面立即回到未启动面板，不等 taskkill | 与「移除项目」同一条清理路径；销毁而不是保留旧内容，使「有终端 ⇔ 有 TerminalView」成立，顶部栏按钮的显示与右键菜单项的禁用都只看 `terminals.has(id)`（已退出的终端也算有，可以结束） |
| 启动中（`pty.open` 未返回）也照常结束 | open 请求已先发出，主进程按顺序处理 IPC 且 open 的 handler 是同步的，kill 到达时会话已创建；`doStart` 返回后发现已 dispose 直接返回。dev 实测 open 后 1 ms kill，shell 进程已结束 |
| `select(id, start)`：侧栏单击 / Enter、搜索框 Enter、添加项目都用 `start=false`；只有未启动面板与「启动 Claude / Codex」（`ensureRunning`）会创建终端 | 用户要求点击项目不启动终端；已有终端时 `start=false` 也会显示并聚焦它，切换体验不变 |
| 顶部栏「结束终端」用 `hidden` 隐藏；`.icon-btn` 设置了 `display: inline-grid`，所以 styles.css 里补 `.icon-btn[hidden] { display: none }` | 类选择器的 display 会覆盖 UA 样式里 `[hidden]` 的 `display: none`（见 lessons.md） |

## 迭代 7 设计（M17 星标 / 收藏）

| 决策 | 原因 |
|---|---|
| 星标存为 `projects.starred`（INTEGER 0/1），schema 版本 1 → 2：`ALTER TABLE projects ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`；`Project.starred: boolean`；新增 IPC `projects:set-starred`（`projects.setStarred(id, starred)` → `OpResult`） | 星标是项目的属性，和项目记录一起存、一起删；加列带默认值，旧数据无需改写。旧版本（schema 1）打开新库只记一条警告，照常工作：它只查询显式列出的列，插入时 starred 取默认值 |
| 分组只在渲染进程做：数据库仍按 `sort_order` 返回全部项目，`Sidebar.visibleGroups()` 拆成「收藏」「项目」两组，每组各自过滤 / 按得分排序，空组不显示 | 「取消星标回到原位」天然成立（两组都按添加顺序）；搜索、状态、选中沿用原来的整列表重建路径 |
| 分组标题是 `<ul>` 里的 `li.list-label`（与项目一起滚动），列表键盘 ↑↓ 改为在 `li.project-item` 之间移动 | 原来的「项目」标题在列表外面，两个分组需要跟随列表滚动；标题不能被当成项目行 |
| 星标按钮绝对定位在行的右侧：已加星标的行一直显示，并给文字留出右边距；未加星标的行悬浮 / 聚焦时才显示，文字右端用 `mask-image` 渐隐，不改变文字宽度 | 不给每一行都预留按钮宽度（侧栏本来就窄，路径已经在截断），悬浮时也不会让文字截断位置跳动 |
| 星标按钮 `tabIndex=-1`，点击 `stopPropagation`；键盘用户用右键菜单（菜单键 / Shift+F10） | 每行只有一个 Tab 停靠点；点星标不应该同时选中项目 |
| **M18 折叠**：设置新增 `collapsedGroups: SidebarGroup[]`（`'starred' \| 'projects'`，settings.json，主进程校验：只保留已知 id 并去重）；分组标题改为 `li.list-label > button.group-header`（`aria-expanded`），折叠的分组不渲染项目行 | 折叠是界面偏好，与侧栏宽度同类，放 settings.json 而不是项目数据库；不渲染而不是隐藏，`visibleIds`、列表 ↑↓、搜索 ↑↓ 自然只作用于看得见的项目 |
| 有搜索词时忽略折叠（全部展开、标题按钮 disabled），不修改保存的状态 | 搜索命中藏在折叠分组里会被误以为「没有匹配」 |
| 加 / 取消星标后若项目落进折叠的分组，`highlight` 改为闪该分组标题 | 项目行不渲染，没有东西可闪；标题数量变化 + 闪烁说明它去了哪里 |

## 迭代 7 设计（M19 Codex 全部 hooks）

| 决策 | 原因 |
|---|---|
| `CODEX_HOOK_EVENTS` 扩展为 codex 0.159.2 的全部 12 个事件；hook 命令文本格式不变（`$null = @($input); curl.exe -s -m 2 -d <标记> $env:AGENT_DESK_HOOK_URL`），原有 5 个事件的命令逐字不变 | codex 按「事件 + 分组下标 + hook 下标」记录每条 hook 的哈希，原有条目保持不变就仍是已信任，只有新增的需要审查一次 |
| PreCompact / PostCompact 各注册两个分组：`matcher='manual'` / `matcher='auto'`，上报 `PreCompact:manual` 这样的标记；服务端按 `事件[:trigger]` 解析，`AgentEvent.trigger` 传给状态机 | 手动 `/compact` 结束后没有 Stop，需要知道是不是手动的才能回到「就绪」；不转发 stdin 的 JSON：PostToolUse 的 `tool_response` 可能很大（超过 64KB 上限会被丢弃），而且 Windows PowerShell 5.1 管道给原生程序会把非 ASCII 改成 `?` |
| SessionEnd / Interrupt 的 hook 设置 `timeout=3` | 官方：这两个事件同步执行，默认超时 1 秒、上限 3 秒；PowerShell 冷启动 + curl 可能超过 1 秒 |
| Subagent 事件只记日志、不改状态 | 主线程的 UserPromptSubmit / 工具事件 / Stop 已反映工作状态；子代理可能在主线程结束后仍在后台，用它们推断状态容易卡在「工作中」 |
| 原生 SessionEnd 与 try/finally 的上报并存（第二次是空操作） | finally 覆盖 codex 崩溃、被结束等不触发 hook 的情况 |
| **M20**：`TerminalHooks.onInput(sessionId, data)` 只在用户输入时调用——排除焦点上报（`ESC[I` / `ESC[O`）与鼠标上报（SGR `ESC[<b;x;yM/m`、URXVT `ESC[b;x;yM`）；`AgentStatusTracker.markInput(id, data)`：已完成 → 就绪；等待确认 → 工作中，但导航键（方向键、Tab、Shift+Tab、Home、End、PageUp、PageDown，含修饰键与应用光标模式的写法）不算 | 批准权限后没有事件；按键是渲染进程唯一能看到的「用户已处理」信号。导航键只移动确认框里的选择；鼠标上报在程序开启鼠标跟踪时滚轮 / 移动都会产生，不是作答 |

## 打包（electron-builder.yml）

- 目标：NSIS x64，`oneClick: false`、`perMachine: false`、允许修改安装目录。
- `files`：`out/**` + `package.json`；生产依赖自动带上。node-pty 排除 `src/deps/third_party/scripts/typings`、编译中间文件、`*.pdb`、`*.test.js` 以及非 win32-x64 的 prebuilds。
- `asarUnpack: node_modules/node-pty/**`：原生 `.node` 需要在磁盘上加载；node-pty 的 conout Worker 和 console list agent 通过 `__dirname` 定位脚本（已验证打包后可正常工作）。
- `npmRebuild: false`：避免 electron-builder 再次编译 node-pty（postinstall 已编译）。
- 生产构建里 `import.meta.env.DEV` 为 false，渲染进程的自测钩子 `window.__agentDesk` 被移除。

## 存储

- **项目**：`userData/agentmanager.db`（SQLite，Electron 44 内置 Node 24 的 `node:sqlite` / `DatabaseSync`，SQLite 3.53；迭代 3 起）。
  - 表 `projects(id TEXT PK, name, path, path_key TEXT UNIQUE, sort_order INTEGER, created_at INTEGER, last_opened_at INTEGER, starred INTEGER NOT NULL DEFAULT 0)`；`path_key` 为小写、去末尾分隔符的路径，用唯一约束去重；按 `sort_order` 排序（添加顺序）。
  - `PRAGMA journal_mode=WAL`、`synchronous=FULL`；schema 版本用 `PRAGMA user_version`（当前 2：1 建表，2 加 `starred`），升级在 `migrateSchema` 中按版本逐级处理，每级一个事务。
  - 打开时执行 `PRAGMA quick_check`；打开失败或检查不通过 → 把 `.db` / `-wal` / `-shm` 改名为 `*.bak-YYYYMMDD-HHmmss` → 新建空库；连备份都失败时用内存数据库保证能启动。
  - 所有写操作同步执行，返回时已落盘；退出时 `close()` 合并 WAL。
  - 选择 `node:sqlite` 而非 better-sqlite3：零新增依赖，不需要再编译 / 打包一个原生模块（已验证打包版可用）。
- **设置**：`userData/settings.json`：`{version:1, sidebarWidth, fontSize, fontFamily, lineHeight, cursorStyle, shell, themeSeed, claudeCommand, codexCommand, collapsedGroups, lastProjectId, window}`。写入：`<file>.tmp-<pid>-<ts>` → fsync → rename（EPERM/EBUSY/EACCES 时退避重试 5 次），同一文件的写入串行；顶层结构损坏时备份为 `.bak-<时间戳>`。

## 依赖

运行时：`node-pty`、`electron-log`（main 中 externalize，由 node_modules 加载）。
构建期：electron、electron-vite 5 + vite 7、typescript 5.9、@electron/rebuild、electron-builder、@xterm/*（渲染进程打包进 bundle）。
`@xterm/addon-webgl` 在构建时被修补（见「关键决策」）：升级它时构建会失败，这是有意的。
