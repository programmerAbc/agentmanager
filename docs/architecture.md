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
                   TerminalManager（按 sessionId 管理视图，只切换可见性不 dispose，分发 PTY 输出）
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

## 打包（electron-builder.yml）

- 目标：NSIS x64，`oneClick: false`、`perMachine: false`、允许修改安装目录。
- `files`：`out/**` + `package.json`；生产依赖自动带上。node-pty 排除 `src/deps/third_party/scripts/typings`、编译中间文件、`*.pdb`、`*.test.js` 以及非 win32-x64 的 prebuilds。
- `asarUnpack: node_modules/node-pty/**`：原生 `.node` 需要在磁盘上加载；node-pty 的 conout Worker 和 console list agent 通过 `__dirname` 定位脚本（已验证打包后可正常工作）。
- `npmRebuild: false`：避免 electron-builder 再次编译 node-pty（postinstall 已编译）。
- 生产构建里 `import.meta.env.DEV` 为 false，渲染进程的自测钩子 `window.__agentDesk` 被移除。

## 存储

- **项目**：`userData/agentmanager.db`（SQLite，Electron 44 内置 Node 24 的 `node:sqlite` / `DatabaseSync`，SQLite 3.53；迭代 3 起）。
  - 表 `projects(id TEXT PK, name, path, path_key TEXT UNIQUE, sort_order INTEGER, created_at INTEGER, last_opened_at INTEGER)`；`path_key` 为小写、去末尾分隔符的路径，用唯一约束去重；按 `sort_order` 排序（添加顺序）。
  - `PRAGMA journal_mode=WAL`、`synchronous=FULL`；schema 版本用 `PRAGMA user_version`（当前 1），升级在 `migrateSchema` 中按版本递增处理。
  - 打开时执行 `PRAGMA quick_check`；打开失败或检查不通过 → 把 `.db` / `-wal` / `-shm` 改名为 `*.bak-YYYYMMDD-HHmmss` → 新建空库；连备份都失败时用内存数据库保证能启动。
  - 所有写操作同步执行，返回时已落盘；退出时 `close()` 合并 WAL。
  - 选择 `node:sqlite` 而非 better-sqlite3：零新增依赖，不需要再编译 / 打包一个原生模块（已验证打包版可用）。
- **设置**：`userData/settings.json`：`{version:1, sidebarWidth, fontSize, fontFamily, lineHeight, themeSeed, claudeCommand, lastProjectId, window}`。写入：`<file>.tmp-<pid>-<ts>` → fsync → rename（EPERM/EBUSY/EACCES 时退避重试 5 次），同一文件的写入串行；顶层结构损坏时备份为 `.bak-<时间戳>`。

## 依赖

运行时：`node-pty`、`electron-log`（main 中 externalize，由 node_modules 加载）。
构建期：electron、electron-vite 5 + vite 7、typescript 5.9、@electron/rebuild、electron-builder、@xterm/*（渲染进程打包进 bundle）。
