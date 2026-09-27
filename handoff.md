## Completed
- 迭代 1（M0–M6）：项目列表、每项目保活终端、复制粘贴 / 字号 / 自适应、生命周期与进程树清理、NSIS 打包。详见 git 历史与 plans.md。
- M7：设置页（`Ctrl+,` / 侧栏底部）——终端字体（本机等宽字体检测，默认 Maple Mono NF CN）、字号、行高、预览；主题色（预设 + 自定义）；关于。MD3 Expressive 界面（动态配色、Material Symbols 图标、导航抽屉 + FAB、顶部栏、圆角终端卡片、形状变化与弹簧动效、MD3 菜单 / 对话框 / Snackbar / 滑块）；移除项目改为应用内对话框。
- M8：「启动 Claude」按钮（顶部栏 / 未启动面板 / 右键菜单），执行设置中的命令（默认 `claude --permission-mode bypassPermissions`）；通过 `--settings` 注入 hooks，本地 HTTP 服务接收事件；侧栏与顶部栏显示 就绪 / 工作中 / 等待确认 / 已完成。
- 用户反馈修正：应用标志去掉无限旋转，改为悬浮动画，点击弹出「关于」；从 Claude Code 启动时去掉继承的 `NO_COLOR`（终端里 claude 无颜色的原因）；焦点上报不再被当成用户输入。
- 版本号 0.2.0。
- M9（迭代 3）：项目记录改存 SQLite（`userData/agent-desk.db`，`node:sqlite`，零新增依赖）；首次启动自动导入 `projects.json` 并改名为 `.migrated-<时间戳>`；数据库损坏时备份并以空库启动。设置仍在 settings.json。版本号 0.3.0，安装包 `dist/agent-desk-0.3.0-setup.exe`。

- M10（0.4.0）：「启动 Codex」按钮（默认 `codex --dangerously-bypass-approvals-and-sandbox`）与 Codex 工作状态（`-c` 注入 hooks + 环境变量 + try/finally 检测退出）；状态机与 IPC 泛化为 agents（claude / codex）；设置页「AI 助手」分区；设置对话框按视口高度收缩并居中。

- 0.4.1：侧栏第二行固定显示目录路径，状态只用名称前的图形表示（实心小点 = 终端运行中、空心圆环 = 助手就绪、形状变换 = 工作中、举手 = 等待确认、对勾 = 已完成），悬浮提示显示状态文字。dev 自测通过（Playground 实心点 + 路径；项目C 启动 Claude 后空心圆环 + 路径，提示「Claude 就绪」）。

- 1.0.0：版本号定为 1.0.0（功能与 0.4.1 相同）。
- 1.0.0 改名 AgentManager（用户要求）：界面 / 窗口标题 / 安装包 / 快捷方式 / `AgentManager.exe` / 卸载项统一改名，package 名 `agentmanager`；数据目录变为 `%APPDATA%\AgentManager`、数据库 `agentmanager.db`。**不迁移旧数据**（用户决定），projects.json 导入代码一并删除。`appId` 保留 `com.agentdesk.app`，安装时会静默卸载已安装的 Agent Desk。安装包 `dist/agentmanager-1.0.0-setup.exe`（SHA256 4F434DDC…39B0B1），由用户自行安装。`dist/agent-desk-*.exe` 是改名前的旧包，不要再用。
- 代码已推送到 GitHub：https://github.com/programmerAbc/agentmanager （分支 main）。
- 用户环境：0.4.1 已按用户安装到 `%LOCALAPPDATA%\Programs\agent-desk`（开始菜单 / 桌面快捷方式），用户数据在 `%APPDATA%\Agent Desk`。用 AgentManager 安装包升级时，NSIS 会沿用注册表中的旧安装位置；需要先关闭正在运行的应用再运行新安装包。

## In Progress
- 无。

## Next Steps
- 用户安装 `dist/agentmanager-1.0.0-setup.exe`，重新添加项目（空数据）；旧目录 `%APPDATA%\Agent Desk` 可手动删除。
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
- 1.0.0 改名：electron-builder.yml、package.json、package-lock.json、scripts/postinstall.mjs、src/main/{index,projectStore,ptyManager,settingsStore}.ts、src/shared/types.ts（删除 ProjectsFile）、src/renderer/{index.html,main,settingsDialog,sidebar}.ts；README、docs、plans、handoff。

## Verification
- `npm run typecheck`：通过。dev + CDP 自测（隔离 userData）：
  - M7：MD3 界面截图检查；设置页字体下拉列出本机等宽字体（已过滤符号字体与 -Ext 字库），选 Cascadia Mono 后终端即时切换并写入 settings.json；主题色切到紫色后界面与终端配色即时更新；未安装的默认字体显示「当前实际使用 Maple Mono NL NF CN」；关于页显示版本信息。
  - M8：点击「启动 Claude」→ 1.5 秒内 SessionStart →「Claude 就绪」、按钮变「Claude 运行中」禁用；发送最小 prompt → 1 秒内「工作中」（加载指示器）→ 约 3 秒「已完成」；claude 回复不受 hook 影响；切到其他项目「已完成」保留，切回变「就绪」；Ctrl+C 退出 claude → SessionEnd → 状态清除、按钮恢复。
  - 修正后 claude 在 dev 实例中恢复颜色；应用标志静止，点击弹出「关于」。
- 打包：`npm run build:win` 生成 `dist/agent-desk-0.2.0-setup.exe`（118MB）。`dist/win-unpacked` 在带空格的 userData 路径（`ud prod space`）下：添加项目 →「启动 Claude」→ SessionStart →「Claude 就绪」；默认主题 / Maple Mono 字体 / claude 颜色正常；确认退出后无残留进程。
- M9（`npm run typecheck` 通过；构建产物保持 `require("node:sqlite")` 外部引用）：
  - 迁移：测试 userData 中的 projects.json（2 个项目）→ 启动后导入，id / 名称 / 顺序 / 时间戳 / 上次选中项保留，原文件改名为 `projects.json.migrated-20260927-142131`；`PRAGMA user_version = 1`。
  - 增删改：添加 projB（sort_order 2）、再添加 `PROJB\` 不产生重复、重命名为「后端B」、移除 projA，数据库内容与界面一致。
  - 正常退出后只剩 `agent-desk.db`（WAL 已合并）；重启后列表一致。
  - 损坏恢复：把数据库写成垃圾内容 → 启动后备份为 `agent-desk.db.bak-20260927-142238`，空库正常启动。
  - 打包版（0.3.0，`ud prod sqlite` 带空格路径）：旧 projects.json 自动导入，退出无残留。
  - 观察：dev 实例在「退出时结束终端」后偶尔以退出码 9 结束（迭代 1 就出现过，清理与落盘均已完成，不影响功能），原因未查明。
- M10（`npm run typecheck` 通过；dev + CDP 自测，测试 userData 的 Codex 命令临时加了 `-c model=gpt-5.5 -c model_reasoning_effort=low`，因为用户的 codex 0.141 跑不了配置的 gpt-5.6-sol）：
  - 先用独立脚本实测：codex 用 PowerShell 执行 hook；信任记录写在 `~/.codex/config.toml` 的 `[hooks.state]`（测试中已对 Agent Desk 的 5 条 hook 选择信任，与产品中的命令文本完全一致，用户不会再看到审查提示）。
  - 应用内：点「启动 Codex」→「Codex 就绪」、两个启动按钮禁用；发最小 prompt → SessionStart / UserPromptSubmit / Stop →「Codex 已完成」；Ctrl+C 退出 → finally 上报 SessionEnd → 状态清除。
  - Claude 回归：右键菜单「启动 Claude」→ 就绪 → 退出后清除。
  - 设置对话框：视口 863 / 583 高时分别为 52–812 / 24–559，居中不截断，内容区滚动。
  - **事故**：15:00:31 关闭 dev 实例时，测试脚本按窗口标题匹配，把用户正在使用的 0.3.0 也关掉了（4 个终端被结束）。脚本已改为只匹配 dev 进程，见 lessons.md。
- 1.0.0 改名（AgentManager）：`npm run typecheck` 通过；`npm run build:win` 生成 `dist/agentmanager-1.0.0-setup.exe`。`dist/win-unpacked/AgentManager.exe` 在隔离的带空格 userData 下启动：窗口标题 AgentManager，日志「已加载 0 个项目（agentmanager.db）」、hooks 服务启动；按 PID 发 WM_CLOSE 后正常退出，WAL 已合并，settings.json 已写入。未测：在已安装 Agent Desk 的机器上覆盖安装（由用户自行安装）。
- 待人工确认：
  1. 微软拼音输入（候选框位置、上屏不重复不丢字）→ 填 README。
  2. claude 长时间对话显示有无错位 / 闪烁。
  3. 干净机器安装。
  4. 新界面（MD3 Expressive）整体观感、默认字体效果。

## Resume Context
- 需求：PLAN.md（迭代 1）+ docs/spec.md「迭代 2 需求」；设计：docs/architecture.md；坑：lessons.md。
- 自测：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录>` + CDP；dev 下 `window.__agentDesk.terminals()` 读终端缓冲区；原生对话框用 UI Automation + `WM_SETTEXT` / `BM_CLICK`；关闭窗口用 `WM_CLOSE`。
- 注意：在 Claude Code 里启动 dev 实例时，dev 窗口会出现在用户桌面上，用户可能会点击它（曾出现两个终端「自动」启动的假象）。
