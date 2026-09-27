## Completed
- 迭代 1（M0–M6）：项目列表、每项目保活终端、复制粘贴 / 字号 / 自适应、生命周期与进程树清理、NSIS 打包。详见 git 历史与 plans.md。
- M7：设置页（`Ctrl+,` / 侧栏底部）——终端字体（本机等宽字体检测，默认 Maple Mono NF CN）、字号、行高、预览；主题色（预设 + 自定义）；关于。MD3 Expressive 界面（动态配色、Material Symbols 图标、导航抽屉 + FAB、顶部栏、圆角终端卡片、形状变化与弹簧动效、MD3 菜单 / 对话框 / Snackbar / 滑块）；移除项目改为应用内对话框。
- M8：「启动 Claude」按钮（顶部栏 / 未启动面板 / 右键菜单），执行设置中的命令（默认 `claude --permission-mode bypassPermissions`）；通过 `--settings` 注入 hooks，本地 HTTP 服务接收事件；侧栏与顶部栏显示 就绪 / 工作中 / 等待确认 / 已完成。
- 用户反馈修正：应用标志去掉无限旋转，改为悬浮动画，点击弹出「关于」；从 Claude Code 启动时去掉继承的 `NO_COLOR`（终端里 claude 无颜色的原因）；焦点上报不再被当成用户输入。
- 版本号 0.2.0。

## In Progress
- 无。

## Next Steps
- 用户安装 `dist/agent-desk-0.2.0-setup.exe` 试用新界面与 Claude 状态，反馈观感。
- 待人工确认项见下方。

## Risks
- node-pty 源码编译依赖 VS Build Tools + Spectre 缓解库 + Python（README 已写明）。
- 字体文件 25MB 直接提交在仓库中。
- 已知限制：shell 退出后该会话的 conhost.exe 留到应用退出（node-pty 1.1 缺陷，见 lessons.md）。
- Claude 状态依赖 `curl.exe`（Win10 1803+ 自带）与 claude 的 hooks 机制；用户按 Esc 中断时没有 Stop 事件，「工作中」要等约 60 秒后的 idle_prompt 通知或下一次事件才会回落。
- 「启动 Claude」把命令直接写进终端：若终端前台正运行别的程序（不是 PowerShell 提示符），命令会被输入给那个程序。

## Changed Files
- M7：src/shared/types.ts、src/main/{settingsStore,ipc}.ts、src/preload/index.ts、src/renderer/{main,sidebar,terminalView,contextMenu,dialog,settingsDialog,theme,fonts,icons,shapes}.ts、styles.css、index.html、env.d.ts；package.json（新增 @material/material-color-utilities、@material-symbols/svg-400）。
- M8：src/main/{hookServer,ipc,index,ptyManager}.ts、src/renderer/{claudeStatus,main,sidebar,terminalView,settingsDialog}.ts、styles.css；文档。

## Verification
- `npm run typecheck`：通过。dev + CDP 自测（隔离 userData）：
  - M7：MD3 界面截图检查；设置页字体下拉列出本机等宽字体（已过滤符号字体与 -Ext 字库），选 Cascadia Mono 后终端即时切换并写入 settings.json；主题色切到紫色后界面与终端配色即时更新；未安装的默认字体显示「当前实际使用 Maple Mono NL NF CN」；关于页显示版本信息。
  - M8：点击「启动 Claude」→ 1.5 秒内 SessionStart →「Claude 就绪」、按钮变「Claude 运行中」禁用；发送最小 prompt → 1 秒内「工作中」（加载指示器）→ 约 3 秒「已完成」；claude 回复不受 hook 影响；切到其他项目「已完成」保留，切回变「就绪」；Ctrl+C 退出 claude → SessionEnd → 状态清除、按钮恢复。
  - 修正后 claude 在 dev 实例中恢复颜色；应用标志静止，点击弹出「关于」。
- 打包验证见下一次提交记录（build:win + 打包版在带空格的 userData 路径下启动 Claude）。
- 待人工确认：
  1. 微软拼音输入（候选框位置、上屏不重复不丢字）→ 填 README。
  2. claude 长时间对话显示有无错位 / 闪烁。
  3. 干净机器安装。
  4. 新界面（MD3 Expressive）整体观感、默认字体效果。

## Resume Context
- 需求：PLAN.md（迭代 1）+ docs/spec.md「迭代 2 需求」；设计：docs/architecture.md；坑：lessons.md。
- 自测：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录>` + CDP；dev 下 `window.__agentDesk.terminals()` 读终端缓冲区；原生对话框用 UI Automation + `WM_SETTEXT` / `BM_CLICK`；关闭窗口用 `WM_CLOSE`。
- 注意：在 Claude Code 里启动 dev 实例时，dev 窗口会出现在用户桌面上，用户可能会点击它（曾出现两个终端「自动」启动的假象）。
