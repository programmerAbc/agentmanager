# Architecture — Agent Desk

## 进程与模块

```
主进程 (src/main)
  index.ts         窗口创建、生命周期、退出确认与清理、窗口状态持久化
  ipc.ts           注册所有 ipcMain handler；参数校验；sessionId → 项目映射
  ptyManager.ts    PTY 创建/写入/resize/kill，以 sessionId 为键；输出批量转发；进程树清理
  projectStore.ts  projects.json 读写（内存为唯一数据源，改动后整体落盘）
  settingsStore.ts settings.json 读写
  jsonFile.ts      原子写（临时文件 + fsync + rename，串行队列）、损坏文件备份
  log.ts           electron-log → userData/logs/main.log；兜底捕获未处理异常
preload (src/preload/index.ts)
  沙箱 preload，contextBridge 暴露 window.api（类型见 shared/types.ts 的 Api）
渲染进程 (src/renderer)
  main.ts          入口，组装各模块
  sidebar.ts       项目列表 UI（M1）
  terminalView.ts  每个项目一个 xterm 实例及其 DOM 容器（M2）
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
| kill 顺序：先 `taskkill /PID <pid> /T /F`，再 `pty.kill()` | 若先 pty.kill，shell 退出后其子进程（claude/node）成为孤儿，taskkill /T 找不到它们。 |
| 退出时 `before-quit` 中 preventDefault，killAll 最多等 2 秒后再 `app.quit()` | PLAN M5：清理但不阻塞退出超过 2 秒。 |
| 所有 invoke handler 在主进程内 try/catch，返回 `OpResult` / `DataResult` | PLAN §7：错误通过返回值传递，主进程不崩溃；另有 electron-log errorHandler 兜底。 |
| 剪贴板、确认框、打开链接都走 IPC 由主进程执行 | 渲染进程开启 sandbox，且不依赖 `navigator.clipboard` 权限。 |
| `Menu.setApplicationMenu(null)` | 使用原生标题栏但不需要菜单栏；同时去掉默认菜单的 Ctrl+= / Ctrl+- / Ctrl+0 页面缩放快捷键（这些键用于终端字号）。dev 下 F12 打开 DevTools。 |
| 窗口禁止导航和 window.open | 安全：只加载应用自身页面，链接统一用 `shell.openExternal`（仅 http/https）。 |
| Vite dev server 绑定 `127.0.0.1` | Vite 默认只监听 `::1`，Electron 在部分环境下以 IPv4 访问 localhost 导致 ERR_CONNECTION_REFUSED。 |
| 字体 TTF 直接提交在 `resources/fonts/`（约 25MB），CSS `@font-face` 相对路径引用，由 Vite 作为资源打包 | 离线可构建；启动时先 `document.fonts.load` 再创建 xterm，避免用回退字体测量字符宽度。 |
| 终端容器两层：外层 `.term-pane` 带 8px padding，内层 `.term-mount` 挂 xterm | FitAddon 用 xterm 父元素的计算尺寸；padding 不能放在 xterm 元素或其直接父元素上（PLAN §6）。 |

## 存储

- `userData/projects.json`：`{version:1, projects: Project[]}`。读取时任一项不合法即视为损坏 → 改名为 `projects.json.bak-YYYYMMDD-HHmmss` → 空列表启动。
- `userData/settings.json`：`{version:1, sidebarWidth, fontSize, lastProjectId, window}`。
- 写入：`<file>.tmp-<pid>-<ts>` → fsync → rename（EPERM/EBUSY/EACCES 时退避重试 5 次）。同一文件的写入串行。

## 依赖

运行时：`node-pty`、`electron-log`（main 中 externalize，由 node_modules 加载）。
构建期：electron、electron-vite 5 + vite 7、typescript 5.9、@electron/rebuild、electron-builder、@xterm/*（渲染进程打包进 bundle）。
