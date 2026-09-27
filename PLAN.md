# PLAN.md — Agent Desk（项目终端管理器）

## 0. 目标

做一个 Windows 桌面应用，交互形态参考 Codex App：

- **左侧**：项目列表。用户手动添加本地目录作为项目，可以重命名、移除。
- **右侧**：点击项目后显示一个嵌入式终端，工作目录就是该项目的目录。用户在终端里手动输入 `claude` 等命令。
- 切换项目时，**终端和其中运行的进程保持存活**，切回来后状态和输出都还在。

本期**不做**：
- 自动运行 claude
- agent 状态检测（hooks）
- 一个项目开多个终端
- 应用关闭后保持会话（后台守护进程）

这些在第 9 节列为后续迭代。

## 1. 技术栈（已确定，不要替换）

| 层 | 选型 |
|---|---|
| 框架 | Electron（最新稳定版） |
| 构建 | electron-vite + TypeScript |
| 前端 | 原生 TS + DOM + CSS，**不引入 React/Vue** |
| 终端仿真 | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` + `@xterm/addon-unicode11` + `@xterm/addon-web-links` |
| PTY | `node-pty`（Windows 下走 ConPTY） |
| 原生模块编译 | `@electron/rebuild`（在 postinstall 中执行） |
| 持久化 | 使用 `app.getPath('userData')/projects.json`，手写读写，写入时先写临时文件再 rename，保证原子性 |
| 打包 | electron-builder，目标为 Windows NSIS 安装包 |
| 字体 | 打包 Sarasa Term SC（更纱黑体）的 Regular 字重，通过 `@font-face` 加载；如果获取不到字体文件，先回退到 `Consolas, 'Microsoft YaHei UI', monospace`，并在 README 中注明 |

目标平台：Windows 10 1903 及以上（ConPTY 的最低要求）、Windows 11。代码不要写死 Windows 专属逻辑以外的平台分支，但也不需要保证 macOS/Linux 可用。

## 2. 目录结构

```
agent-desk/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ resources/fonts/            # Sarasa Term SC
├─ src/
│  ├─ shared/types.ts          # Project 类型、IPC 通道名常量
│  ├─ main/
│  │  ├─ index.ts              # 创建窗口、生命周期
│  │  ├─ projectStore.ts       # projects.json 读写
│  │  ├─ ptyManager.ts         # PTY 创建/写入/resize/销毁、进程树清理
│  │  └─ ipc.ts                # 注册所有 ipcMain handler
│  ├─ preload/index.ts         # contextBridge 暴露 window.api
│  └─ renderer/
│     ├─ index.html
│     ├─ main.ts               # 入口
│     ├─ sidebar.ts            # 项目列表 UI
│     ├─ terminalView.ts       # xterm 实例管理（每个项目一个）
│     └─ styles.css
└─ README.md
```

## 3. 数据模型

```ts
interface Project {
  id: string;          // crypto.randomUUID()
  name: string;        // 默认取目录名，可以重命名
  path: string;        // 绝对路径
  createdAt: number;
  lastOpenedAt?: number;
}
```

`projects.json` 的内容格式为 `{ "version": 1, "projects": Project[] }`。

读取时如果文件损坏，将原文件备份为 `projects.json.bak-<时间戳>`，然后以空列表启动，不要崩溃。

## 4. IPC 契约（preload 暴露为 `window.api`）

| 方法 | 方向 | 说明 |
|---|---|---|
| `projects.list(): Promise<Project[]>` | invoke | |
| `projects.add(): Promise<Project \| null>` | invoke | 主进程弹出 `showOpenDialog({properties:['openDirectory']})`。用户取消时返回 null；同一路径已存在时返回已有的项目，不重复添加 |
| `projects.rename(id, name)` | invoke | |
| `projects.remove(id)` | invoke | 如果该项目有正在运行的 PTY，先杀掉 |
| `projects.touch(id)` | invoke | 更新 lastOpenedAt |
| `pty.open(id, cols, rows): Promise<{ok, error?}>` | invoke | 已存在则直接返回 ok；目录不存在时返回错误 |
| `pty.write(id, data)` | send | |
| `pty.resize(id, cols, rows)` | send | |
| `pty.kill(id)` | invoke | |
| `pty.onData(cb(id, data))` | 主进程 → 渲染进程 | |
| `pty.onExit(cb(id, exitCode))` | 主进程 → 渲染进程 | |

安全要求：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。渲染进程只能通过 `window.api` 访问主进程能力。IPC 通道名统一定义在 `shared/types.ts` 中。

## 5. 功能需求与验收标准

### M0 — 工程骨架 + node-pty 验证（先做这个，跑通再往下走）
- 用 electron-vite 创建 TS 工程，配置 `@electron/rebuild`。
- 写一个最小页面：一个 xterm 连接一个 PowerShell，能输入命令并看到输出。
- **验收**：`npm i && npm run dev` 能启动；在终端中执行 `dir`、`echo 中文测试` 都显示正常。
- 如果 node-pty 编译失败，在 README 中写清楚需要的前置条件（VS Build Tools 的具体工作负载、Python 版本），**不要换成别的 PTY 库**。

### M1 — 项目列表
- 左侧栏宽度默认 240px，可拖动调整（范围 180–400px），宽度需要持久化。
- 顶部有"＋ 添加项目"按钮。
- 列表项显示项目名和缩短的路径；鼠标悬停时 tooltip 显示完整路径。
- 当前选中的项目高亮显示；PTY 正在运行的项目在名称前显示一个小圆点。
- 右键菜单包含：重命名（行内编辑，Enter 确认，Esc 取消）、在资源管理器中打开（`shell.openPath`）、重启终端、移除项目（弹出确认框）。
- 列表排序：按添加顺序排列。
- **验收**：添加、重命名、移除项目后重启应用，列表保持一致；重复添加同一目录不会产生重复项。

### M2 — 嵌入式终端
- 点击项目时：如果该项目还没有 xterm 实例，就创建一个并调用 `pty.open`；如果已有，直接显示。
- 默认 shell 的选择顺序：先查 PATH 中是否有 `pwsh.exe`，有则用它，否则用 `powershell.exe`。启动参数带 `-NoLogo`。
- 环境变量继承 `process.env`，额外设置 `TERM=xterm-256color` 和 `COLORTERM=truecolor`。
- 终端配置：字体为 Sarasa Term SC，字号 14，`scrollback: 10000`，`cursorBlink: true`，深色主题。
- 加载 WebGL addon。加载失败或 context lost 时，回退到默认渲染器，并调用 `dispose` 释放 addon。
- 加载 Unicode11 addon，并设置 `term.unicode.activeVersion = '11'`。
- 加载 web-links addon，点击链接时调用 `shell.openExternal`。
- 右侧没有选中任何项目时，显示一个空状态提示，引导用户添加项目。
- **验收**：在项目终端中执行 `claude`，Claude Code 的 TUI 正常显示，没有明显错位或闪烁；中文和 emoji 对齐正确；执行 `pwd` 显示的是项目目录。

### M3 — 切换保活
- 每个项目对应一个 xterm 实例和它的 DOM 容器。切换项目时只切换容器的 `display`，**不要 dispose**。
- 容器显示后，先调用 `fit()`，再把新的 cols/rows 通过 `pty.resize` 发给主进程，然后让终端获得焦点。
- **不要对隐藏状态的终端调用 fit**，否则尺寸会被算成 0。
- 在后台运行的项目，其 PTY 输出照常写入对应的 xterm 实例，保证切回来时内容完整。
- **验收**：在项目 A 中运行 `claude` 并开始对话，切换到项目 B 执行一些命令，再切回 A，对话内容和运行状态完整保留。

### M4 — 终端交互细节
- **复制**：有选中内容时，Ctrl+C 复制选中内容并清除选区；没有选中内容时，Ctrl+C 正常发送给 PTY（作为中断信号）。Ctrl+Shift+C 始终执行复制。
- **粘贴**：Ctrl+V 和 Ctrl+Shift+V 通过 `term.paste()` 粘贴，这样 bracketed paste 模式能正常工作。右键菜单中也提供复制和粘贴。
- 以上逻辑用 `attachCustomKeyEventHandler` 实现，只拦截 keydown 事件。
- **缩放**：用 `ResizeObserver` 监听终端区域的尺寸变化，做 50ms 防抖后只对当前可见的终端执行 fit 和 resize。拖动侧栏宽度时同样生效。
- **中文输入法**：输入过程中候选框位置正确，上屏后不重复、不丢字。需要在 README 中记录用微软拼音测试的结果。
- **进程退出**：PTY 退出时，在终端内输出一行灰色提示"进程已退出 (code X)，按 Enter 重启"。此时用户按 Enter，就在同一个 xterm 实例中重新创建 PTY（先调用 `term.reset()`）。
- 字号快捷键：Ctrl+= 放大，Ctrl+- 缩小，Ctrl+0 重置。字号全局生效并持久化。
- **验收**：在 claude 中粘贴多行文本，会作为一次整体输入，而不是逐行提交；在 claude 运行中按 Ctrl+C 能正常中断。

### M5 — 生命周期与清理
- 移除项目、选择"重启终端"、退出应用时，都需要杀掉 PTY。
- Windows 下 `pty.kill()` 不一定能结束子进程（claude 会启动 node 等子进程），因此还需要执行 `taskkill /PID <pid> /T /F` 清理整棵进程树，并忽略报错。
- 在 `before-quit` 中清理所有 PTY，但不要阻塞退出超过 2 秒。
- 退出时，如果有 PTY 仍在运行，弹出确认框："有 N 个终端仍在运行，确定退出？"
- 窗口的位置、大小、是否最大化需要持久化，最后选中的项目也要持久化，下次启动时自动选中它（但**不自动启动 PTY**，等用户第一次点击或聚焦时再启动）。
- **验收**：在任务管理器中确认，退出应用后没有残留的 `claude`、`node`、`pwsh`、`OpenConsole`/`conhost` 进程。

### M6 — 打包
- 使用 electron-builder 打包 NSIS 安装包；node-pty 必须被正确打包，并放在 asarUnpack 中。
- 在一台干净的 Windows 机器上（未安装 Node）安装后，功能正常。
- **验收**：用 `npm run build:win` 生成安装包，安装后完整走一遍 M1 到 M5 的验收项。

## 6. UI 规格

- 深色主题。侧栏背景 `#1e1f22`，终端背景 `#181818`，选中项背景 `#2b2d31`，强调色 `#d97757`。
- 窗口使用系统原生标题栏，标题为"Agent Desk — <当前项目名>"。
- 侧栏与终端之间有一条 4px 的拖拽条，鼠标悬停时高亮。
- 终端区域四周留 8px 内边距（padding 设置在容器上，不要设置在 xterm 元素上，否则 fit 的计算会出错）。
- 界面文字统一使用中文。

## 7. 代码约定

- 开启 TypeScript strict 模式；除 IPC 边界上的类型断言外，不使用 `any`。
- 主进程中的所有文件和 PTY 操作都要 try/catch。错误通过返回值传给渲染进程，渲染进程用简单的 toast 提示，不要让主进程崩溃。
- 日志用 `electron-log` 写到 userData 目录下的 logs 文件夹，记录 PTY 的创建、退出、kill 和错误。
- 不要引入与上述功能无关的依赖。

## 8. 执行顺序

严格按照 M0 → M6 的顺序推进。**每完成一个里程碑**：
1. 运行一次 `npm run typecheck` 和 `npm run dev`，确认没有报错；
2. 对照该里程碑的验收项逐条自检。需要人工验证的项（输入法、显示效果）列出来交给我确认；
3. 提交一次 git commit，提交信息格式为 `M<n>: <简述>`。

遇到与本计划冲突的技术问题时，**先停下来说明问题和备选方案**，不要擅自改变技术栈或删减需求。

## 9. 后续迭代（本期不做，但设计时不要堵死）

- 项目设置中增加选项"打开时自动运行命令"（例如 `claude -c`）。
- 接入 Claude Code 的 hooks（Notification/Stop），在侧栏显示 运行中 / 等待确认 / 已完成 的状态，并在需要处理时发送系统通知。
- 一个项目支持多个终端 tab。
- 支持 WSL 作为 shell（`wsl.exe --cd <path>`）。
- 把 PTY 移到独立的守护进程中，实现关闭窗口后会话不中断、重新打开时回放输出。

为此，`ptyManager` 的接口要以 **sessionId** 为键，而不是 projectId；目前两者是一一对应的，但要保留以后一个项目对应多个会话的空间。
