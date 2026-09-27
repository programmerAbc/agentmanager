## Completed
- M0：electron-vite + TS 工程骨架；node-pty 通过 @electron/rebuild 源码编译；最小页面。
- M1：项目列表（添加 / 同路径去重 / 行内重命名 / 移除确认 / 在资源管理器中打开 / 侧栏宽度拖拽持久化 / 最后选中项持久化 / 窗口标题）。
- M2：每项目一个 xterm + 容器；pwsh 优先；WebGL / Unicode11 / web-links；启动时只选中不启动 PTY；重启终端；退出提示 + Enter 重启；taskkill 整棵树。
- M3：切换只改可见性；显示时 fit → pty.resize → focus；隐藏时不 fit；后台输出照常写入。
- M4：复制/粘贴快捷键与右键菜单、ResizeObserver 50ms 防抖、字号快捷键（全局、持久化）；修复 dev 下页面刷新被 will-navigate 拦截且 PTY 被误清理的问题。

## In Progress
- M5 生命周期与清理。

## Next Steps
- M4 → M6，见 plans.md。

## Risks
- node-pty 源码编译依赖 VS Build Tools + Spectre 缓解库 + Python（README 已写明）。
- 字体文件 25MB 直接提交在仓库中。
- 已知限制：shell 退出（自然退出 / 重启 / 移除）后该会话的 conhost.exe 留到应用退出（node-pty 1.1 缺陷，见 lessons.md）。
- 150% 缩放下 `getNormalBounds()` 返回 1281×801（默认 1280×800），需观察重启后是否逐次增长 1px。

## Changed Files
- M2/M3：src/renderer/{terminalView.ts,main.ts,styles.css,env.d.ts}；src/main/ptyManager.ts（kill 顺序、会话标记剔除、dev 变量剔除）；docs/spec.md、docs/architecture.md、lessons.md。

## Verification
- M0：`npm install` 通过（`✔ Rebuild Complete`）；`npm run typecheck` 通过；dev 中 `dir`、`echo 中文测试` 正常。
- M1：原生对话框添加 3 个项目；`PROJA\` 不重复；重命名 Enter/Esc；侧栏 180–400 限制并持久化；移除确认取消/确认；WM_CLOSE 关闭后重启全部恢复（含窗口位置）。
- M2（`npm run typecheck` 通过，dev + CDP 自测）：
  - 启动时恢复选中项但未创建 PTY（日志无「创建」）；点击面板后启动。
  - `pwd` 为项目目录；`echo "中文对齐|😀|emoji|ab"` 与数字行对齐正确（截图）；WebGL 渲染生效；侧栏运行圆点出现。
  - 运行 `claude`：信任对话框与主界面显示正常（截图）；Ctrl+C 两次正常退出 claude。
  - `exit` 后显示「进程已退出 (code 0)，按 Enter 重启」，Enter 后在同一 xterm 重新启动。
  - 「重启终端」：shell、其 node 子进程、以隐藏控制台启动的 node 孙进程均被结束（按 PID 确认），日志 `taskkill 已结束进程树`。
  - 退出确认：3 个终端运行时关闭窗口弹出「有 3 个终端仍在运行，确定退出？」，取消不退出，退出后所有 shell/conhost 均不存在。
- M3：A 中运行 30 行定时输出后切到 B，切回 A 30 行完整；claude 主界面切走再切回完整；A 隐藏期间侧栏变窄，切回后 fit 为 160 列且 pwsh 报告 `WindowSize.Width = 160`。
- M4（`npm run typecheck` 通过，dev + CDP 自测）：
  - 拖选后 `Ctrl+C` → 剪贴板为选中文本、未发送 ^C、选区清除（再按 `Ctrl+C` 即发送中断）；`Ctrl+Shift+C` 复制且保留选区；无选区 `Ctrl+C` → `abc^C` 新提示符。
  - `Ctrl+V` / `Ctrl+Shift+V` 在 pwsh 中粘贴一次（无重复）；claude 中粘贴 3 行文本作为一次整体输入出现在输入框、未被逐行提交（截图）；claude 中 `Ctrl+C` 清空输入，再按两次退出。
  - 终端右键菜单「复制 / 粘贴」，无选区时复制置灰，Esc 关闭。
  - 字号：14 → 16 → 15（列数 161 → 134 → 147），settings.json 持久化 15；`Ctrl+0` 回到 14；焦点在侧栏时同样生效。
  - 拖动侧栏：终端经 ResizeObserver 自动 fit 为 131 列，pwsh `WindowSize.Width = 131`。
  - 模拟输入法组合上屏「中文测试」不重复、不丢字。
  - Vite 整页刷新：页面确实重载（timeOrigin 变化），主进程清理全部 PTY。
- 待人工确认：
  1. 微软拼音在 pwsh / claude 中输入：候选框位置是否跟随光标、上屏是否重复或丢字（结果请填到 README「中文输入法测试记录」）。
  2. claude TUI 长时间对话中有无错位/闪烁（自测只覆盖启动画面、空闲界面和输入框）。

## Resume Context
- 项目根目录即仓库根；需求在 PLAN.md，补充澄清在 docs/spec.md，设计在 docs/architecture.md。
- 自测方式：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录>`，再用 CDP（Runtime.evaluate / Input.* / Page.captureScreenshot）操作和截图；dev 模式下 `window.__agentDesk.terminals()` 返回各终端状态与缓冲区文本；原生对话框用 UI Automation 找窗口 + `WM_SETTEXT` / `BM_CLICK`；关闭窗口用 `WM_CLOSE`（渲染进程 `window.close()` 不触发 close 事件）。
