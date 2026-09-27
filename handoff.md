## Completed
- M0：electron-vite + TS 工程骨架；node-pty 通过 @electron/rebuild 源码编译（补装 VS Spectre 缓解库）；最小页面。
- M1：项目列表（添加 / 同路径去重 / 行内重命名 / 移除确认 / 在资源管理器中打开 / 侧栏宽度拖拽持久化 / 最后选中项持久化 / 窗口标题）。
- M2：每项目一个 xterm + 容器；pwsh 优先；WebGL / Unicode11 / web-links；启动时只选中不启动 PTY；重启终端；退出提示 + Enter 重启；taskkill 整棵树。
- M3：切换只改可见性；显示时 fit → pty.resize → focus；隐藏时不 fit；后台输出照常写入。
- M4：复制/粘贴快捷键与右键菜单、ResizeObserver 50ms 防抖、字号快捷键（全局、持久化）；修复 dev 下页面刷新被拦截且 PTY 被误清理。
- M5：移除/重启/退出清理整棵进程树；退出确认；before-quit ≤2 秒；窗口状态与最后选中项持久化（修复高 DPI 尺寸漂移）。
- M6：electron-builder NSIS 安装包（`dist/agent-desk-0.1.0-setup.exe`，118MB），node-pty asarUnpack。

## In Progress
- 无。本期 M0–M6 全部完成，等待用户人工确认项。

## Next Steps
- 用户确认下方「待人工确认」三项；输入法结果填入 README。
- 后续迭代见 PLAN §9 与 plans.md「可选改进」。

## Risks
- node-pty 源码编译依赖 VS Build Tools + Spectre 缓解库 + Python（README 已写明）。
- 字体文件 25MB 直接提交在仓库中。
- 已知限制：shell 退出（自然退出 / 重启 / 移除）后该会话的 conhost.exe 留到应用退出（node-pty 1.1 缺陷，见 lessons.md）；应用退出后无残留。
- `npm run dev` 在 shell 已死时调用 `pty.kill()` 的兜底路径会在 dev 输出打印 `AttachConsole failed`（node-pty agent 的无害噪音）。

## Changed Files
- M6：electron-builder.yml（新增）、README.md、docs/architecture.md、plans.md、handoff.md。
- 全部源码：src/main/{index,ipc,ptyManager,projectStore,settingsStore,jsonFile,log}.ts、src/preload/index.ts、src/renderer/{main,sidebar,terminalView,contextMenu,toast}.ts、styles.css、index.html、env.d.ts、src/shared/types.ts、scripts/postinstall.mjs。

## Verification
- 每个里程碑：`npm run typecheck` 通过；`npm run dev` 启动正常。自测方式为 dev + CDP（操作、截图、读取终端缓冲区）+ UI Automation（原生对话框）+ 按 PID 检查进程。
- M0：`npm install` 通过（`✔ Rebuild Complete`）；`dir`、`echo 中文测试` 正常。
- M1：原生对话框添加 3 个项目；`PROJA\` 不重复；重命名 Enter/Esc；侧栏 180–400 并持久化；移除确认取消/确认；关闭后重启全部恢复。
- M2：启动时不创建 PTY；`pwd` 为项目目录；中文/emoji 对齐；WebGL 生效；claude 信任框与主界面正常；exit 后 Enter 重启；重启终端结束 shell + 子进程 + 隐藏控制台孙进程。
- M3：后台 30 行输出切回后完整；claude 切走切回完整；隐藏期间宽度变化，切回后 xterm 与 pwsh 都是 160 列。
- M4：Ctrl+C 有选区复制并清除选区、无选区中断；Ctrl+Shift+C 始终复制；Ctrl+V / Ctrl+Shift+V 粘贴一次；claude 中多行粘贴为一次整体输入、未提交；claude 中 Ctrl+C 清空输入并可退出；字号 ±/重置并持久化，焦点在侧栏时也生效；拖动侧栏后 xterm 与 pwsh 都是 131 列；模拟 IME 组合上屏不重复不丢字。
- M5：claude 多级子进程（cmd → node → cmd → node → node）场景下关闭 → 确认退出，记录的 17 个 PID 与主进程全部消失（233ms）；重启后最大化、选中项恢复且不启动 PTY；窗口尺寸 5 轮重启稳定。
- M6：`npm run build:win` 成功；`dist/win-unpacked` 与静默安装后的程序：添加项目、pwsh、claude、中文/emoji、更纱字体、重启终端、退出零残留均正常；日志写入 userData/logs/main.log；静默卸载后安装目录、卸载项、快捷方式全部清除；原生模块只依赖系统 DLL（dumpbin）。所有测试都使用隔离的 `--user-data-dir`，未写入真实 `%APPDATA%\Agent Desk`。
- 待人工确认：
  1. 微软拼音在 pwsh / claude 中输入：候选框位置是否跟随光标、上屏是否重复或丢字（结果填到 README「中文输入法测试记录」）。
  2. claude TUI 长时间对话中有无错位/闪烁（自测只覆盖启动画面、空闲界面和输入框）。
  3. 在未安装 Node 的干净 Windows 机器上安装并走一遍 M1–M5。

## Resume Context
- 项目根目录即仓库根；需求在 PLAN.md，补充澄清在 docs/spec.md，设计在 docs/architecture.md，坑在 lessons.md。
- 自测方式：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录>`，再用 CDP（Runtime.evaluate / Input.* / Page.captureScreenshot）操作和截图；dev 模式下 `window.__agentDesk.terminals()` 返回各终端状态与缓冲区文本；原生对话框用 UI Automation 找窗口 + `WM_SETTEXT` / `BM_CLICK`；关闭窗口用 `WM_CLOSE`（渲染进程 `window.close()` 不触发 close 事件）。打包版同理：`dist\win-unpacked\agent-desk.exe --user-data-dir=<临时目录> --remote-debugging-port=<端口>`。
