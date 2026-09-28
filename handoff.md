## Completed
- 1.3.2（文字错乱修复）：按用户要求提交并打包（未推送），安装包 `D:\agnent_manager_release\agentmanager-1.3.2-setup.exe`（SHA256 86DEA055…BC9CEC1B，与 dist 中一致）。为不打扰用户正在运行的 1.3.1，未启动打包版 GUI，改为解包 app.asar 静态检查。请用户安装后留意长时间 claude 会话里文字是否还会错乱。注：打包时 release 目录里只剩这一个安装包（以前的 1.0.0–1.3.1 已不在，非本次操作所致）。
- 修复（2026-09-28，用户截图反馈）：终端文字错乱（部分字显示成别的字 / 重叠碎片）。根因是 @xterm/addon-webgl 0.19.0 的图集缺陷（上游 #4480）：图集页合并后「页下标 + 页版本号」撞号，纹理不重新上传。新增 Vite 插件 `scripts/xtermWebglAtlasFix.ts` 在构建时按上游 beta 的思路修补（全局页版本号、每个渲染器各自跟踪布局变化、更新途中合并当帧重建、纹理上传不越界），dev 下不预构建该包。已随 1.3.2 提交并打包。用户正在运行的 1.3.1 未被触碰；已错乱的终端可按 Ctrl+= 再 Ctrl+0 恢复显示。
- 1.3.1（Esc 修复）：按用户要求提交、推送并打包，安装包 `D:\agnent_manager_release\agentmanager-1.3.1-setup.exe`（SHA256 B783E4DC…4DC211B9，与 dist 中一致）。为不抢焦点未启动打包版 GUI，改为解包 app.asar 静态检查。请用户安装后实测：终端里按过 Shift+Enter 后，claude `/resume` 选择器按 Esc 能取消。
- 修复：用户反馈 claude `/resume` 界面里 Esc 没用。根因：终端用过 Shift/Ctrl/Alt+Enter（M13 发 win32-input-mode 序列）后，ConPTY 会吞掉单独的 ESC，Esc / Ctrl+[ 在 claude、codex、PowerShell 里都失效直到终端重启。修法：`terminalView.ts` 记录当前 PTY 是否发过换行序列，之后单独的 `\x1b` 改发 win32-input-mode Esc（`ESC_KEY`），PTY 启动时复位。
- 迭代 1（M0–M6）：项目列表、每项目保活终端、复制粘贴 / 字号 / 自适应、生命周期与进程树清理、NSIS 打包。详见 git 历史与 plans.md。
- M7：设置页（`Ctrl+,` / 侧栏底部）——终端字体（本机等宽字体检测，默认 Maple Mono NF CN）、字号、行高、预览；主题色（预设 + 自定义）；关于。MD3 Expressive 界面（动态配色、Material Symbols 图标、导航抽屉 + FAB、顶部栏、圆角终端卡片、形状变化与弹簧动效、MD3 菜单 / 对话框 / Snackbar / 滑块）；移除项目改为应用内对话框。
- M8：「启动 Claude」按钮（顶部栏 / 未启动面板 / 右键菜单），执行设置中的命令（默认 `claude --permission-mode bypassPermissions`）；通过 `--settings` 注入 hooks，本地 HTTP 服务接收事件；侧栏与顶部栏显示 就绪 / 工作中 / 等待确认 / 已完成。
- 用户反馈修正：应用标志去掉无限旋转，改为悬浮动画，点击弹出「关于」；从 Claude Code 启动时去掉继承的 `NO_COLOR`（终端里 claude 无颜色的原因）；焦点上报不再被当成用户输入。
- 版本号 0.2.0。
- M9（迭代 3）：项目记录改存 SQLite（`userData/agent-desk.db`，`node:sqlite`，零新增依赖）；首次启动自动导入 `projects.json` 并改名为 `.migrated-<时间戳>`；数据库损坏时备份并以空库启动。设置仍在 settings.json。版本号 0.3.0，安装包 `dist/agent-desk-0.3.0-setup.exe`。

- M10（0.4.0）：「启动 Codex」按钮（默认 `codex --dangerously-bypass-approvals-and-sandbox`）与 Codex 工作状态（`-c` 注入 hooks + 环境变量 + try/finally 检测退出）；状态机与 IPC 泛化为 agents（claude / codex）；设置页「AI 助手」分区；设置对话框按视口高度收缩并居中。

- 0.4.1：侧栏第二行固定显示目录路径，状态只用名称前的图形表示（实心小点 = 终端运行中、空心圆环 = 助手就绪、形状变换 = 工作中、举手 = 等待确认、对勾 = 已完成），悬浮提示显示状态文字。dev 自测通过（Playground 实心点 + 路径；项目C 启动 Claude 后空心圆环 + 路径，提示「Claude 就绪」）。

- 1.0.0：版本号定为 1.0.0（功能与 0.4.1 相同）。
- 1.0.0 改名 AgentManager（用户要求）：界面 / 窗口标题 / 安装包 / 快捷方式 / `AgentManager.exe` / 卸载项统一改名，package 名 `agentmanager`；数据目录变为 `%APPDATA%\AgentManager`、数据库 `agentmanager.db`。**不迁移旧数据**（用户决定），projects.json 导入代码一并删除。`appId` 保留 `com.agentdesk.app`，安装时会静默卸载已安装的 Agent Desk。安装包 `dist/agentmanager-1.0.0-setup.exe`，由用户自行安装。按用户要求从干净工作区（commit e472b15）重新打包，并复制到 `D:\agnent_manager_release\agentmanager-1.0.0-setup.exe`（SHA256 608CE6F5…40ED911B，与 dist 中一致）。`dist/agent-desk-*.exe` 是改名前的旧包，不要再用。
- 代码已推送到 GitHub：https://github.com/programmerAbc/agentmanager （分支 main，含 1.1.0）。以后的推送需用户要求。
- M11（迭代 4）：侧栏项目模糊搜索——搜索框（`Ctrl+Shift+F`），输入即过滤，匹配名称与显示的缩写路径，多词与，按匹配度排序并高亮；↑↓ / Enter / Esc；输入法组字时不过滤。
- M12（迭代 4）：主题色新增「白色」（单色浅色界面，白底终端 + 浅色 ANSI + 最小对比度 4.5）与「黑色」（单色纯黑界面）；色块描边；启动时窗口底色与主题一致、主题应用前页面透明，避免闪烁。
- 1.3.0（M14 + M15）：按用户要求推送并打包，安装包 `D:\agnent_manager_release\agentmanager-1.3.0-setup.exe`（SHA256 DC0C685B…09EC03555，与 dist 中一致）。同样为不抢焦点未启动打包版 GUI，改为解包 app.asar 静态检查（版本 1.3.0；主进程含 FORCE_HYPERLINK、CHERE_INVOKING、cmd 版 codex 启动命令、link:resolve-paths、showItemInFolder、「可用终端」日志；渲染进程含 allowNonHttpProtocols、「按住 Ctrl 单击打开」、换行序列、Git Bash 选项）。请用户安装后实测：Ctrl+单击 claude 对话里的「[Image #N]」。
- M14（用户要求）：设置「默认终端」自动 / PowerShell 7 / Windows PowerShell / 命令提示符 / Git Bash（只列本机已安装的），对新开或重启的终端生效；助手启动命令按 shell 家族生成。
- M15（用户反馈）：助手运行时隐藏顶部栏两个启动按钮；终端里 Ctrl+单击打开 OSC 8 链接（claude 的图片附件 / 文件引用，靠 `FORCE_HYPERLINK=1` 让 claude 输出）、网址和识别出的本机文件路径；可执行文件只定位、网络位置不打开。
- 自测工具与数据改放在项目内 `.devtest/`（已加入 .gitignore，不提交）：cdp.mjs、hover.mjs（把鼠标移到终端文字上、可 Ctrl+单击）、pick-shell.mjs、close-dev.ps1、seed.mjs（测试项目 / userData / 假 codex）。原会话 scratchpad 已不可用。
- 1.2.0（M13）：按用户要求推送并打包，安装包 `D:\agnent_manager_release\agentmanager-1.2.0-setup.exe`（SHA256 5435C3B2…38F6CDA8，与 dist 中一致）。为不抢用户焦点，打包版未启动 GUI 冒烟，改为静态检查（见 Verification）。
- M13（用户实际使用中反馈）：`Shift+Enter` / `Ctrl+Enter` / `Alt+Enter` 在 claude、codex 输入框里换行，在 PowerShell 里续行；设置新增「光标」竖线（默认）/ 下划线 / 方块。开发模式 `AGENTMANAGER_TEST_INACTIVE=1` 时窗口不激活显示（自测不抢焦点）。
- 1.1.0（M11 + M12）：按用户要求版本号改为 1.1.0，安装包 `D:\agnent_manager_release\agentmanager-1.1.0-setup.exe`（SHA256 0FE53C70…58A2A8FA，与 dist 中一致；同目录的 1.0.0 安装包保留）。已推送到 GitHub。
- 用户环境：用户已用 AgentManager 1.0.0 覆盖安装了旧的 Agent Desk 0.4.1，结果装到了 `%LOCALAPPDATA%\Programs\agent-desk\AgentManager`（沿用旧 InstallLocation 并追加新名字，见 lessons.md）。已告知用户：卸载 → 删除空的 `Programs\agent-desk` → 重新安装，即可装到 `Programs\AgentManager`（数据在 `%APPDATA%\AgentManager`，卸载不删）。安装包无需重新打包。

## In Progress
- 无。

## Next Steps
- 用户安装 1.3.2（安装会结束正在运行的 AgentManager 及其终端，由用户选时机）；安装后留意长时间 claude 会话里文字是否还会错乱。推送需用户要求。
- 上游发布 @xterm/addon-webgl 0.20 正式版后：升级（xterm 同步升级）→ 构建会因插件匹配失败而中止 → 确认 #4480 已修后删除插件与 optimizeDeps.exclude。
- 用户安装 `D:\agnent_manager_release\agentmanager-1.0.0-setup.exe`，重新添加项目（空数据）；旧目录 `%APPDATA%\Agent Desk` 可手动删除。
- 待人工确认项见下方。

## Risks
- 构建时修补第三方包（@xterm/addon-webgl 0.19.0）：只按压缩代码精确替换，版本变化即构建失败（有意）；修补覆盖的是上游 beta 的主要修复，未移植 beta 里「凑不齐 4 张同尺寸页时清空图集」的极端分支（需要约十几张 8192 大页，实际不会出现）。
- node-pty 源码编译依赖 VS Build Tools + Spectre 缓解库 + Python（README 已写明）。
- 字体文件 25MB 直接提交在仓库中。
- 已知限制：shell 退出后该会话的 conhost.exe 留到应用退出（node-pty 1.1 缺陷，见 lessons.md）。
- Claude 状态依赖 `curl.exe`（Win10 1803+ 自带）与 claude 的 hooks 机制；用户按 Esc 中断时没有 Stop 事件，「工作中」要等约 60 秒后的 idle_prompt 通知或下一次事件才会回落。
- 「启动 Claude」把命令直接写进终端：若终端前台正运行别的程序（不是 PowerShell 提示符），命令会被输入给那个程序。

## Changed Files
- 文字错乱修复：scripts/xtermWebglAtlasFix.ts（新）、electron.vite.config.ts（渲染进程插件 + optimizeDeps.exclude）、tsconfig.node.json（include scripts/**/*.ts）；docs/architecture.md、docs/spec.md、plans.md、lessons.md、handoff.md。自测工具（不提交）：.devtest/atlas-stress.mjs、atlas-test.mjs、atlas-multi.mjs、atlas-run.sh。
- Esc 修复：src/renderer/terminalView.ts（WIN32_INPUT_KEYS、ESC_KEY、win32InputSent）；docs/spec.md、docs/architecture.md、plans.md、lessons.md、handoff.md。`.devtest/cdp.mjs` 新增 `[` 按键（不提交）。
- M7：src/shared/types.ts、src/main/{settingsStore,ipc}.ts、src/preload/index.ts、src/renderer/{main,sidebar,terminalView,contextMenu,dialog,settingsDialog,theme,fonts,icons,shapes}.ts、styles.css、index.html、env.d.ts；package.json（新增 @material/material-color-utilities、@material-symbols/svg-400）。
- M8：src/main/{hookServer,ipc,index,ptyManager}.ts、src/renderer/{claudeStatus,main,sidebar,terminalView,settingsDialog}.ts、styles.css；文档。
- 1.0.0 改名：electron-builder.yml、package.json、package-lock.json、scripts/postinstall.mjs、src/main/{index,projectStore,ptyManager,settingsStore}.ts、src/shared/types.ts（删除 ProjectsFile）、src/renderer/{index.html,main,settingsDialog,sidebar}.ts；README、docs、plans、handoff。
- M11：src/renderer/fuzzy.ts（新）、sidebar.ts、main.ts、terminalView.ts、icons.ts、styles.css；spec、architecture、README、plans、handoff、lessons。
- M14 / M15：src/main/shells.ts（新）、src/main/links.ts（新）、src/renderer/pathLinks.ts（新）、src/main/{ptyManager,ipc,hookServer,settingsStore,index}.ts、src/preload/index.ts、src/shared/types.ts、src/renderer/{terminalView,settingsDialog,main}.ts、styles.css、.gitignore（.devtest/）；spec、architecture、README、plans、handoff、lessons。
- M13：src/renderer/terminalView.ts（NEWLINE_KEY、cursorOptions）、src/shared/types.ts（CursorStyle）、src/main/{settingsStore,ipc,index}.ts、src/renderer/{main,settingsDialog}.ts、styles.css（分段按钮）；spec、architecture、README、plans、handoff、lessons。
- M12：src/shared/types.ts（THEME_SEED_WHITE / BLACK、themeModeOf、WINDOW_BACKGROUND）、src/main/{index,ipc}.ts（窗口底色）、src/renderer/{theme,terminalView,main,settingsDialog}.ts、index.html（booting）、styles.css；spec、architecture、README、plans、handoff、lessons。

## Verification
- 1.3.2 打包：`npm run build:win`（含 typecheck）通过。解包 app.asar（`.devtest/asar-check.cjs`）：package.json 版本 1.3.2；渲染进程 bundle 含全局页版本号 6 处、`_amSeenLayout` 3 处、纹理上传上限 1 处，无 `_requestClearModel=!0`，Esc 序列仍在；node-pty 原生模块在 app.asar.unpacked 中。electron-builder.yml 自 1.3.1 以来未变。
- 文字错乱修复（`npm run typecheck` 通过；`npm run build` 通过，产物 out/renderer/assets/index-*.js 中含全局页版本号 6 处、`_amSeenLayout` 3 处，无残留的 `_requestClearModel=!0`）：
  - 复现（未修补，全新 dev 实例，隔离 userData，窗口不激活；DPR 1.5、终端 122×36）：`atlas-stress.mjs 16000` 逐屏打印 16000 个不同汉字后打印探针屏，截图中多行汉字错乱 / 重叠、出现别行的字，与用户截图一致；连续两个全新实例都复现。同一实例里第二次运行未复现（图集状态已变，见 lessons）。
  - 修补后：全新实例 16000（两次）、30000 各一次，探针截图 A 与「换字号重建图集后重印同一屏」的截图 B 逐像素比较只差 105 像素（即 `round=1` / `round=2` 这几个字），目视无错乱。
  - 多终端（p1 隐藏期间 p2 打印 30000 字，再切回 p1）：修补前后都只差 105 像素——该场景没能在未修补版本上触发，不能作为修复证据，仅说明修补后无回归。
  - 插件自检：对原文件替换成功；对其他文件不处理；源码中任一处不匹配、或重复修补时抛错（构建失败）。
  - Ctrl+= / Ctrl+0 恢复：未修补实例上换字号往返后画面正确（atlas-test 的截图 B）。
  - 全程只操作 dev electron.exe（node_modules 下）的进程，用户的 AgentManager.exe（4 个进程）始终在运行。
  - 未测：打包安装版（未打包）；真实 claude 长会话（用压力脚本代替）。
- 1.3.1 打包：`npm run build:win`（含 typecheck）通过。解包 app.asar：package.json 版本 1.3.1；渲染进程 bundle 含 win32-input-mode Esc 序列 `[27;1;27;1;0;1_`、`win32InputSent` 与换行序列；node-pty 原生模块在 app.asar.unpacked 中。打包配置自 1.3.0 以来未变。
- Esc 修复（`npm run typecheck` 通过）：
  - 复现（修复前代码路径，直接用 node-pty + 原始模式读 stdin 的 Node 子进程，Electron 以 `ELECTRON_RUN_AS_NODE=1` 运行脚本）：发换行序列前 `\x1b` → 收到 `1b`；发换行序列后 `\x1b` 收不到（`\x1b\x1b`、`\x1b[`、`\x1bO` 同样收不到），方向键 / Ctrl+↑ / Home / F1 / F5 / Alt+b / 粘贴正常；win32-input-mode Esc 在发换行序列前后都收到 `1b`。
  - dev 实例（`AGENTMANAGER_TEST_INACTIVE=1`、userData `.devtest/ud`，前台窗口确认仍是用户的程序；CDP 真实按键）：探针依次 Esc → `1b`、Shift+Enter → `0a`、Esc → `1b`、Ctrl+[ → `1b`；同一 PTY 中 PowerShell 输入 `echo abc` 后 Esc 清除整行，`echo one` Shift+Enter `echo two` 后 Esc 清除两行；claude 中输入 abc Shift+Enter def → 两行，Esc Esc 清空输入框，`/resume` 打开选择器后 Esc 关闭回到输入框，`/exit` 退出。测试结束用 close-dev.ps1 关闭，无残留 dev 进程。
  - 副作用：测试在 agentmanager 目录启动过一次 claude（会话 9c3dd801…，没有发送消息），可能出现在该项目的 `/resume` 列表里。
  - 未测：codex 里的 Esc（改发的是标准 VK_ESCAPE 记录，与 PSReadLine 同一读法）；Windows 10（build < 22000 不发 win32-input-mode，不受影响）。
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
- M11（`npm run typecheck` 通过）：
  - `fuzzy.ts` 用 esbuild 打包的临时脚本做了 18 项断言（子序列、词首 / 连续加分、大小写、中文、emoji 码点下标、多词与、不跨分隔符、名称优先、路径命中下标），全部通过。
  - dev + CDP（隔离 userData，7 个测试项目，启动参数加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`）：`Ctrl+Shift+F` 从终端聚焦搜索框并全选，终端缓冲区不变；`agm` → 只剩 agentmanager 且 a/g/m 高亮；`lab3` → 路径命中两个项目（整段命中的排前）；`api ser` 多词；`ge` → GameEngine（词首）排在 agentmanager（连续）之前；`xyz` → 「没有匹配的项目」；↓↓↑ 移动当前项、Enter 打开 notes 并聚焦其终端、搜索词保留；Esc 清空、再按 Esc 焦点回到终端；拼音组字 `qian'duan` 时列表不变，上屏「前端」后只剩「前端项目」；过滤状态下 F2 重命名为「前端控制台」→ 仍在结果中并重新高亮，数据库已更新。截图检查搜索栏、高亮与当前项描边。
  - 空数据目录启动：没有项目时搜索框隐藏（display:none），`Ctrl+Shift+F` 不抢焦点。未走「逐个移除到 0 个」的 UI 流程（同一个 setProjects 代码路径）。
- M12（`npm run typecheck` 通过；dev + CDP，同一测试 userData）：
  - 在 pwsh 里打印 ANSI 0–15、dim / bold、真彩色白 `38;2;255;255;255` 与灰 `38;2;200;200;200`，分别截图：原深色主题不变；白色主题——侧栏 / 终端纯白、`color-scheme: light`、浅色 ANSI、真彩色白字被调暗为可读的深色（最小对比度生效）、PSReadLine 语法高亮可读；黑色主题——surface / container-low 均为 #000000、container-high #1b1b1b、白色强调。设置页白 / 黑色块带描边，白色块上为黑勾。
  - 选白色后 settings.json 写入 `#FFFFFF`；重启后直接是白色主题（`booting` 已移除，body 背景 rgb(255,255,255)），日志无错误。
  - 白色主题下「启动 Claude」：claude 的目录信任提示在白底上清晰可读，随后选「No, exit」退出。
  - 关闭流程：有终端时单次 WM_CLOSE 后 0.5 秒内出现退出确认框（之前两次「找不到对话框」是测试脚本的 UI Automation 问题，已改用 Win32 枚举，见 lessons.md）。
  - 未测：启动瞬间是否闪烁无法用 CDP 截到，只验证了窗口底色 / booting 的代码路径与最终状态；请用户实际启动时留意。
- 1.1.0 打包：`npm run build:win`（含 typecheck）通过。`dist/win-unpacked/AgentManager.exe` 在隔离的带空格 userData（7 个测试项目、settings 仅含 `themeSeed: #FFFFFF`）下启动：日志 `version=1.1.0`，白色主题直接生效（`color-scheme: light`，body 白色），生产构建没有 `window.__agentDesk`；`Ctrl+Shift+F` + `api` → 只剩 api-server 并高亮。随后测试窗口因抢到键盘焦点收到了用户的键入（见 lessons.md），立即按 PID 关闭，Enter 打开终端这一步未在打包版上完成（dev 已验证）。
- M13（`npm run typecheck` 通过；dev 实例以 `AGENTMANAGER_TEST_INACTIVE=1` 启动，确认前台窗口仍是用户的 AgentManager；全程未碰用户进程）：
  - 探针：Node 原始模式读 stdin / `Console.ReadKey` 读控制台记录，各候选序列结果见 architecture.md 表格。
  - 选定序列直接写 PTY：claude 2.1.283 输入框 abc / def 两行；codex 0.157.1（用临时 CODEX_HOME，复制 config.toml 与 auth.json，`--no-daemon`，测试后已删除；用户真实 config.toml 未写入信任记录）输入框 abc / def 两行。
  - 真实按键（CDP）：Enter → `\r`；Shift / Ctrl / Alt+Enter → 各一次 `\n`（Node）/ Shift+Enter 字符 0x0a（ReadKey），无重复发送；PowerShell 里 `echo one` Shift+Enter `echo two` Enter → `>>` 续行后两条都执行；claude 中三种组合依次得到 abc / def / ghi / jkl 四行，未提交。
  - 光标：设置页分段按钮（竖线默认选中）；依次切到下划线 / 方块 / 竖线，settings.json 同步保存，截图裁剪对比三种形状正确；claude 输入框使用的是终端光标（竖线）。
  - 顺带验证：按钮启动的 claude 用 `/exit` 或两次 Ctrl+C 退出，SessionEnd 均到达、按钮恢复；此前「状态卡在就绪」是测试时第三次 Ctrl+C 打断了 hook 的 curl（已记入 spec Open）。
  - 事故：一次用 Bash 工具传 `/exit` 参数时被 MSYS 改写成 `C:/Program Files/Git/exit`，作为提示词发给了 claude（一次很小的请求，claude 只回复了说明，没有执行操作）。见 lessons.md。
  - 未测：真实键盘上的输入法状态下按 Shift+Enter；Windows 10 上的回退分支。
- M14 / M15（`npm run typecheck` 通过；dev 实例以 `AGENTMANAGER_TEST_INACTIVE=1` 启动、userData 在 `.devtest/ud`；全程未碰用户的安装版进程）：
  - 检测：日志「可用终端」列出 pwsh（WindowsApps）、powershell、cmd、Git Bash；设置页下拉 5 项，「自动」标注 PowerShell 7。
  - cmd：在项目目录启动；按钮启动 claude → SessionStart（双引号 `--settings` 路径可用），`/exit` → SessionEnd、按钮恢复；按钮启动真实 codex（临时 CODEX_HOME，测试后已删除，用户 config.toml 未写入信任记录）→ 两次 Ctrl+C 退出后 `&` 上报 SessionEnd、状态清除。
  - Git Bash：`pwd` 为项目目录、MSYSTEM=MINGW64；假 codex（打印参数）收到完整的 hooks TOML 作为一个参数，`;` 上报 SessionEnd；claude 按钮启动 → SessionStart（单引号 Windows 路径可用），`/exit` → SessionEnd。空提示符下 Shift+Enter 执行命令（bash 行为）。
  - Windows PowerShell 5.1（5.1.26100）：假 codex（codex.cmd）收到完整 TOML，`finally` 上报 SessionEnd。PowerShell 7（自动）：claude 启动 / 退出上报正常，终端内 `FORCE_HYPERLINK=1`。
  - 顶部栏：claude 运行时两个启动按钮 hidden、只剩「Claude 就绪」（截图确认），退出后恢复。
  - 链接：`pathLinks` 识别用 esbuild 打包的临时脚本做了 11 项断言（中文路径、`:行:列`、`#L`、反引号、句末标点、网址 / 版本号不识别），全部通过。dev 中 pwsh 打印 3 个 OSC 8 链接与 2 个纯文本相对路径：悬浮提示分别为 file:// / 主机名 file:// / ms-settings: 与解析后的绝对路径；普通单击不打开；Ctrl+单击（先删除目标文件）→「文件不存在」、主机名 → 「不打开网络位置上的文件」、ms-settings → 「不支持的链接」；纯文本路径 Ctrl+单击（删除后）→「文件不存在」，说明整条链路到达主进程。claude 头部的目录路径由纯文本识别成链接。
  - 未测：真正用默认程序打开（会弹出记事本 / 资源管理器等窗口，可能复用用户的窗口，故未做；`shell.openPath` 为 Electron 标准 API）；claude 对话记录中「[Image #N]」的 OSC 8 链接（需要实际发送一条带图片的消息；输入框里的「[Image #1]」不是链接，按 claude 代码它在消息里才输出链接，且 `FORCE_HYPERLINK=1` 时其判断为真）；所选终端被卸载后的回退。
- 1.2.0 打包：`npm run build:win`（含 typecheck）通过。用户正在使用安装版，打包版若启动会抢焦点（`showInactive` 只在开发模式生效），因此没有启动 GUI，改为解包 `app.asar` 静态检查：package.json 版本 1.2.0；渲染进程 bundle 含换行序列 `[13;28;10;1;16;1_` 与 `cursorInactiveStyle`；主进程含 `cursorStyle` 校验；`AGENTMANAGER_TEST_INACTIVE` 编译结果带 `!app.isPackaged` 判断；node-pty 原生模块在 app.asar.unpacked 中。打包配置自 1.1.0（已做 GUI 冒烟）以来未变。
- 覆盖安装数据：数据在 `%APPDATA%\AgentManager`（与安装目录分开），NSIS 升级时以 `/S /KEEP_APP_DATA` 运行旧卸载程序；数据库 schema 未变（user_version 1）；settings.json 缺少新字段 `cursorStyle` 时按字段回退默认值（竖线），其他设置保留。
- 待人工确认：
  1. 微软拼音输入（候选框位置、上屏不重复不丢字）→ 填 README。
  2. claude 长时间对话显示有无错位 / 闪烁。
  3. 干净机器安装。
  4. 新界面（MD3 Expressive）整体观感、默认字体效果。

## Resume Context
- 需求：PLAN.md（迭代 1）+ docs/spec.md「迭代 2 需求」；设计：docs/architecture.md；坑：lessons.md。
- 自测：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录> --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` + CDP（后两个参数防止窗口被遮挡时收不到输入，见 lessons.md）；命令前加 `AGENTMANAGER_TEST_INACTIVE=1` 让窗口不激活显示，cdp.mjs 每次调用会开启焦点模拟；自测工具在 `.devtest/`（先 `node .devtest/seed.mjs` 建测试数据，userData 用 `--user-data-dir=<项目>/.devtest/ud`，关闭用 `.devtest/close-dev.ps1`）；用户的安装版 AgentManager 可能正在使用，只能按 dev / 测试 PID 操作；dev 下 `window.__agentDesk.terminals()` 读终端缓冲区；原生对话框用 UI Automation + `WM_SETTEXT` / `BM_CLICK`；关闭窗口用 `WM_CLOSE`。
- 图集自测：`sh .devtest/atlas-run.sh [字数] [标签]` 从全新 dev 实例跑一次压力 + 截图比较（输出 `A vs B {diffPixels}`，约 105 为正常）；在 Bash 工具里用 run_in_background 运行。
- 注意：在 Claude Code 里启动 dev 实例时，dev 窗口会出现在用户桌面上，用户可能会点击它（曾出现两个终端「自动」启动的假象）。
