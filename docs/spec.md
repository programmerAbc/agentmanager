# Spec — AgentManager

原始需求文档是仓库根目录的 [PLAN.md](../PLAN.md)（目标、技术栈、数据模型、IPC 契约、M0–M6 验收标准、UI 规格、代码约定）。**PLAN.md 是需求的权威来源**，本文件只记录对它的澄清、补充和实现时确定的细节，不重复其内容。

## 澄清与补充

### 项目根目录
- PLAN §2 的 `agent-desk/` 即本仓库根目录（`D:\develop\workspace_lab3\agentmanager`），`package.json` 的 name 为 `agentmanager`（1.0.0 之前应用名为 Agent Desk，name 为 `agent-desk`）。

### IPC 返回值（PLAN §4、§7）
- §7 要求错误通过返回值传给渲染进程，因此：
  - `projects.add()` 返回 `DataResult<Project | null>`（`{ok:true,data}` / `{ok:false,error}`），用户取消时 `data === null`。
  - `projects.rename/remove/touch`、`pty.kill` 返回 `OpResult`（`{ok, error?}`）。
- 额外的 IPC（PLAN §4 未列出，但功能需要）：`projects.openInExplorer`、`settings.get/update`、`clipboard.readText/writeText`、`shell.openExternal`、`dialog.confirm`。

### 持久化
- 项目列表：SQLite（见 M9；PLAN §3 的 projects.json 已不再使用）。
- UI 设置：`userData/settings.json`，格式 `{version:1, sidebarWidth, fontSize, lastProjectId, window}`，同样原子写入。字段不合法时逐项回退默认值；顶层结构损坏时备份后使用默认值。
- 字号范围 8–32，默认 14；侧栏宽度 180–400，默认 240。

### 重复添加判定
- 路径 `path.resolve` 后忽略大小写、忽略末尾分隔符比较（Windows 路径不区分大小写）。

### 终端环境变量
- 终端继承 `process.env`，额外设置 `TERM` / `COLORTERM`。
- 仅在未打包（dev）时，去掉 npm / electron-vite 注入的变量（`npm_*`、`NODE_ENV`(electron-vite 注入时)、`ELECTRON_CLI_ARGS` 等），避免干扰用户在终端里运行的命令。
- 始终去掉**父 Claude Code 会话的会话级标记**（`CLAUDECODE`、`CLAUDE_PID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SESSION_*`、`CLAUDE_CODE_MESSAGING_*`）：AgentManager 若是从某个 claude 会话里启动的，这些标记会让终端里的 claude 以为自己是子会话（例如关闭会话记录）。用户配置类变量（`ANTHROPIC_*`、`CLAUDE_CONFIG_DIR` 等）不受影响。
- 检测到从 Claude Code 会话里启动（存在 `CLAUDECODE`）时，同时去掉 `NO_COLOR`（Claude Code 给工具 shell 设置的，否则终端里的 claude 等程序全部没有颜色）；否则保留用户自己的 `NO_COLOR`。

### 渲染进程重载
- 渲染进程重新加载或崩溃时，主进程清理全部 PTY（xterm 实例已不存在，保留 PTY 没有意义）。

## 迭代 2 需求（2026-09-27 用户新增，覆盖 PLAN 中相冲突的部分）

### M7 设置页 / 字体 / MD3 Expressive 界面
- **终端字体可配置**：默认 `Maple Mono NF CN`；未安装时依次回退 `Maple Mono NL NF CN` → `Cascadia Mono` → 内置 `Sarasa Term SC` → `Consolas` / `Microsoft YaHei UI` / `monospace`。设置页列出本机已安装的等宽字体供选择；可调字号（8–32）与行高（1.0–1.6）；修改实时作用于所有终端并持久化。（PLAN §1/§M2 的「更纱黑体为终端字体」改为「内置回退字体」。）
- **设置页**（侧栏底部按钮 / `Ctrl+,` 打开，Esc 或关闭按钮关闭，修改即时保存）：
  - 关于：应用版本、Electron / Chromium / Node / V8 版本、系统版本；打开数据目录、打开日志目录。
  - 终端：字体、字号、行高、预览。
  - 外观：主题色（种子色），预设若干 + 自定义颜色；默认 Claude 橙 `#D97757`。
  - Claude：启动命令（默认 `claude --permission-mode bypassPermissions`），可恢复默认。
- **Material Design 3 Expressive 风格**（覆盖 PLAN §6 的固定配色）：由种子色生成 MD3 暗色配色方案（surface / container 层级、primary / secondary / tertiary 及其 container）；大圆角与按压时的形状变化、弹簧动效；侧栏为导航抽屉（扩展 FAB「添加项目」、胶囊形选中指示）；顶部栏；MD3 菜单、对话框、Snackbar、滑块、文本框。终端背景、光标、选区颜色跟随配色方案。PLAN §6 中仍保留：原生标题栏、4px 拖拽条（悬停高亮）、终端容器 8px 内边距、中文界面。
- 移除项目的确认改为应用内 MD3 对话框；退出确认仍用原生对话框（窗口关闭流程中）。
- 装饰性图形不做无限循环动画（用户要求）：应用标志与空状态图形静止，鼠标悬浮时转动；点击侧栏顶部的应用名弹出「关于」对话框（版本等信息）。只有「工作中」的加载指示器持续动画。
- 应用版本号 0.2.0（迭代 2）。

### M8 启动 Claude 按钮与工作状态
- **启动 Claude 按钮**（用户选择按钮而非快捷键）：顶部栏按钮；空闲面板、项目右键菜单中也提供。在当前项目的终端里执行设置中的命令；终端未启动（或已退出）时先启动；若检测到该终端里通过按钮启动的 Claude 仍在运行，则不重复执行，只聚焦终端并提示。
- **状态检测只对通过按钮启动的 claude 生效**：命令的第一个词是 `claude` 时，自动追加 `--settings "<userData>/claude-hooks/<sessionId>.json"`，该文件只包含 AgentManager 的 hooks（`curl.exe` 把事件 POST 到主进程本地端口）。**不修改** `~/.claude/settings.json`；手动输入的 `claude` 没有状态。
- **状态与显示**（侧栏项目、顶部栏状态标签）：
  - 工作中：`UserPromptSubmit`、`PostToolUse` → MD3 Expressive 形状变换加载指示器。
  - 等待确认：`Notification` 且 `notification_type` 为 `permission_prompt` / `elicitation_dialog`。
  - 已完成：`Stop`；一直保持，直到用户切换到该项目或在该终端里输入（焦点上报、鼠标上报序列不算输入）后转为空闲。
  - 空闲（Claude 已就绪）：`SessionStart`；`Notification(idle_prompt)` 时若仍是「工作中」则回落为空闲（用户中断时不会触发 Stop）。
  - 结束：`SessionEnd`、终端退出 / 结束 / 移除 → 清除状态。
- 非目标：快捷键启动、修改全局 claude 配置、系统通知。

## 迭代 3 需求（2026-09-27 用户新增）

### M9 项目记录存入 SQLite（覆盖 PLAN §1「持久化」与 §3 中 projects.json 的约定）
- 项目列表保存在 `userData/agentmanager.db`（1.0.0 之前为 `agent-desk.db`）（SQLite，使用 Electron 内置 Node 的 `node:sqlite`，不新增依赖），表 `projects`。
- 行为不变：按添加顺序排列；同一路径（忽略大小写与末尾分隔符）不重复添加；重命名 / 移除 / 更新打开时间立即落盘。
- 损坏处理：数据库无法打开或完整性检查失败时，把数据库文件（及 `-wal` / `-shm`）改名为 `*.bak-<时间戳>`，以空库启动，不崩溃。
- 设置仍保存在 `settings.json`（本次只迁移项目记录）。

### M10 Codex CLI 启动与工作状态；设置对话框位置
- **启动 Codex**：与「启动 Claude」并列的按钮（顶部栏 / 未启动面板 / 项目右键菜单）。执行设置中的 Codex 命令，默认 `codex --dangerously-bypass-approvals-and-sandbox`（与 Claude 的 bypassPermissions 对应）。同一终端同时只跟踪一个助手；有助手在运行时两个启动按钮都禁用。
- **Codex 状态**（只对按钮启动的 codex 生效，不修改 codex 的配置文件）：
  - 通过 codex 的 hooks（`-c` 注入）上报：SessionStart / UserPromptSubmit / PostToolUse → 工作中，PermissionRequest → 等待确认，Stop → 已完成。
  - codex 的 SessionStart 在第一轮对话时才触发，所以点击启动后直接显示「Codex 就绪」。
  - codex 没有退出事件：启动命令用 PowerShell `try { … } finally { 上报 SessionEnd }` 包裹，codex 退出（含 Ctrl+C）时清除状态。
  - codex 会对新增 / 变化的 hook 弹出「Hooks need review」，用户选择信任一次后不再提示（codex 把信任记录写在自己的 config.toml 的 `[hooks.state]`）。因此 hook 命令文本必须固定：会变的端口 / token / 会话 id 通过终端环境变量 `AGENT_DESK_HOOK_URL` 传入，hooks 配置本身放在 `AGENT_DESK_CODEX_HOOKS` 环境变量里。
  - codex 在 Windows 上用 PowerShell 执行 hook（实测），hook 命令为 `$null = @($input); curl.exe -s -m 2 -d <事件> $env:AGENT_DESK_HOOK_URL`（不含引号，事件名放在请求体里）。
- 状态文字带助手名：「Claude 工作中…」/「Codex 工作中…」等（顶部栏状态标签）。
- **侧栏**（用户要求）：项目第二行固定显示目录路径，状态只用名称前的图形表示——实心小点 = 终端运行中、空心圆环 = 助手就绪、形状变换动画 = 工作中、举手 = 等待确认、对勾 = 已完成；悬浮提示中显示路径与状态文字。
- **设置对话框**：窗口较矮时对话框按窗口高度收缩并垂直居中，内容区滚动，不再被截断在底部。

### 1.0.0 应用改名：Agent Desk → AgentManager
- 界面、窗口标题、安装包、快捷方式、可执行文件（`AgentManager.exe`）、卸载项名称统一改为 **AgentManager**；package 名 `agentmanager`。
- **不迁移旧数据**（用户决定）：数据目录随应用名变为 `%APPDATA%\AgentManager`，数据库为 `agentmanager.db`，首次启动是空的项目列表与默认设置。旧目录 `%APPDATA%\Agent Desk` 不读取也不删除。迭代 3 的 projects.json 导入逻辑一并删除。
- **安装升级**：`appId` 保持 `com.agentdesk.app` 不变，NSIS 安装包会识别已安装的 Agent Desk，静默卸载旧版（保留旧数据目录）后安装 AgentManager，不会出现两个应用。
- **不改**：codex hooks 使用的环境变量名 `AGENT_DESK_HOOK_URL` / `AGENT_DESK_CODEX_HOOKS`（出现在 hook 命令文本中，改名会让 codex 要求重新信任）；原始需求文档 PLAN.md 保持原样。

## 迭代 4 需求（2026-09-27 用户新增）

应用版本号 1.1.0（M11 + M12）。

### M11 项目列表模糊搜索
- 侧栏「项目」列表上方有搜索框（MD3 搜索栏：前置搜索图标，有内容时显示清除按钮）；没有项目时不显示。
- **实时生效**：每次输入立即过滤；输入法组字过程中（拼音还没上屏）不过滤，上屏后再过滤。
- **匹配规则**：不区分大小写的模糊（子序列）匹配。输入按空格拆成多个词，每个词都要匹配上（与）。每个词匹配项目名，或匹配**侧栏上显示的缩写路径**（盘符 + 最后两级，如 `D:\…\workspace_lab3\agentmanager`）中的某一级目录名；不跨 `\` 匹配，缩写成 `…` 的部分不参与匹配（避免看不见的原因造成匹配，也避免长路径几乎匹配一切）。
- **排序**：有搜索词时按匹配度排序——名称匹配排在只有路径匹配的前面；连续字符、词首（开头、`-_. \/` 之后、驼峰大写处）命中得分更高；同分保持原顺序。搜索词为空时恢复原顺序。
- **高亮**：名称与路径中命中的字符高亮（主色、加粗、下划线）。
- **键盘**：`Ctrl+Shift+F` 聚焦搜索框并全选（终端里也生效，不发给终端）；搜索框中 `↓` / `↑` 移动当前项，`Enter` 打开当前项（默认第一项）并聚焦其终端；`Esc` 先清空搜索词，已为空时把焦点还给终端。
- 无结果时列表处显示「没有匹配的项目」。搜索词不持久化；切换项目、增删改项目时保持搜索词并重新过滤。
- 非目标：拼音 / 拼音首字母匹配（需要额外依赖，另议）。

### M12 白色 / 黑色主题
- 设置 →「外观」主题色预设增加 **白色** 与 **黑色**（用户选择：白 = 浅色界面，黑 = 纯黑界面）。其他颜色保持现有的深色界面。
- 仍以种子色保存，不改设置格式：`#FFFFFF` = 白色主题，`#000000` = 黑色主题（自定义颜色选到这两个值也一样）。
- **白色**：MD3 单色（Monochrome）浅色方案，侧栏与终端背景纯白、浅灰面板、黑色强调；终端深色字，ANSI 16 色改用适合浅色背景的一套，并开启最小对比度（4.5），让为深色背景设计的程序输出（例如 claude 默认的深色主题配色）在白底上仍可读。
- **黑色**：MD3 单色深色方案，侧栏与终端背景纯黑，灰阶面板，白色强调，没有彩色点缀。
- 原生控件（滚动条、颜色选择器等）跟随明暗（`color-scheme`）；所有色块带细描边，白色 / 黑色色块在任何背景上都可见；白色色块上的勾为黑色。
- 启动时不闪烁：窗口底色与主题一致（白 / 黑 / 深灰），页面在主题应用前保持透明；切换主题时同步更新窗口底色（拖大窗口时露出的颜色）。

## 迭代 5 需求（2026-09-27 用户实际使用中反馈）

应用版本号 1.2.0（M13）。

### M13 换行按键与光标样式
- **换行**：在终端里按 `Shift+Enter` / `Ctrl+Enter` / `Alt+Enter` 输入换行而不是提交——claude 与 codex 的输入框里换行，PowerShell 里续行（`>>`）。`Enter` 行为不变。输入法组字时的 Enter 交给输入法。
- 用过换行键之后 `Esc`（与 `Ctrl+[`）必须照常可用（claude 的 `/resume` 等选择器取消、清空输入框，PowerShell 清除当前行）。（修复：用户反馈用过换行键后 Esc 失效，见 architecture.md 迭代 5 设计；应用版本号 1.3.1。）
- **光标样式**：设置 → 终端 →「光标」三选一：竖线（默认，用户偏好「普通的光标」）/ 下划线 / 方块；立即作用于所有终端并保存。失焦时保持同一形状（方块失焦为空心）。程序自己用转义序列设置的光标形状（DECSCUSR）优先。claude 输入框使用的就是终端光标，因此同样生效。

应用版本号 1.3.0（M14 + M15）。

### M14 默认终端（用户要求）
- 设置 → 终端 →「默认终端」：**自动**（默认，保持原行为：有 PowerShell 7 用 pwsh，否则 Windows PowerShell）/ **PowerShell 7**（pwsh）/ **Windows PowerShell**（5.1）/ **命令提示符**（cmd）/ **Git Bash**。
- 只列出本机检测到的（未安装的显示为不可选并标注「未安装」）。Git Bash 从 Git for Windows 的安装位置找 `bin\bash.exe`（不用 PATH 里的 `bash.exe`，那可能是 WSL 的启动器）。
- 对**新打开或重启**的终端生效，已打开的终端不变。所选终端启动时找不到（例如被卸载）则回退为「自动」并记日志。
- Git Bash 以登录交互模式启动（`--login -i`），并保持在项目目录（`CHERE_INVOKING=1`）。
- 「启动 Claude / 启动 Codex」按该终端实际使用的 shell 生成命令：PowerShell 用现有写法（`try/finally`），cmd 用 `&` 串联退出上报，bash 用 `;`；hooks 本身不变（codex 无需重新信任）。
- 非目标：WSL、自定义 shell 路径 / 参数（另议）。
- Git Bash 里在空提示符下按 Shift+Enter 与 Enter 相同（执行命令，bash 本身没有多行编辑键）；claude / codex 输入框里仍是换行。

### M15 用户反馈：顶部栏按钮、Ctrl+单击打开文件
- **顶部栏**：终端里有助手（claude / codex）运行时，隐藏「启动 Claude」「启动 Codex」两个按钮，只显示状态标签（例如「Codex 就绪」）；助手退出后按钮恢复。项目右键菜单里的两项仍为禁用（菜单里保留禁用项是常规做法）。
- **Ctrl+单击打开**（与 VS Code 一致，普通单击不打开，留给选择文本）：
  - 程序输出的 **OSC 8 超链接**：`file://` → 用系统默认程序打开；`http(s)://` 与编辑器协议（`vscode:` `vscode-insiders:` `cursor:` `windsurf:`）→ 交给系统打开；其他协议拒绝并提示。
  - claude 只有在认为终端支持超链接时才把「[Image #N]」图片附件、文件引用输出为链接：终端环境变量设置 `FORCE_HYPERLINK=1`（用户自己设置了则保留）。
  - 文本里的**本机文件路径**（codex 等不输出超链接的程序）：Windows 绝对路径（`C:\a\b.png`、`D:/x/y.ts:12`）与相对路径 / 文件名（`src/main/ipc.ts:147`、`handoff.md`，相对项目目录）；只有存在的文件 / 目录才显示为链接；`:行号`、`#L20` 后缀忽略；不支持含空格的纯文本路径（OSC 8 链接不受此限）。
  - 网址（原有）同样改为 Ctrl+单击。
  - 悬浮时终端的提示显示目标和「按住 Ctrl 单击打开」。
- **安全**：终端输出不可信。可执行文件 / 脚本（`.exe .bat .cmd .ps1 .vbs .js .msi .lnk` 等）只在资源管理器中定位、不直接打开；没有关联程序的文件也改为定位；不打开网络位置（`\\server\share`、带主机名的 `file://`，访问时 Windows 会自动发送登录凭据）。

### 缺陷修复：终端文字错乱（2026-09-28 用户反馈）
- 用户截图：长时间运行 claude 的终端里，部分字符显示成别的字或重叠的碎片（汉字与英文都有），新输出的行也可能受影响。
- 要求：大量中文 / 多种颜色 / 长会话 / 多个终端同时使用时，终端文字始终正确显示；修复不能改变其他终端行为。
- 应用版本号 1.3.2。
- 已经错乱的正在运行的旧版本：按 `Ctrl+=` 再按 `Ctrl+0`（换一次字号会重建字形图集）即可恢复显示，无需重启终端。

## 迭代 6 需求（2026-09-29 用户反馈）

### M16 结束终端；点击项目不自动启动终端
- **结束终端**（替换原「重启终端」，位置不变：顶部栏图标按钮、项目右键菜单）：结束该项目终端的 PTY 及整棵进程树（其中运行的 claude / codex 一并结束，工作状态清除），丢弃终端内容，项目回到「终端尚未启动」面板，可再点「启动终端 / 启动 Claude / 启动 Codex」。不弹确认（与原「重启终端」一致）。
  - 顶部栏按钮只在当前项目有终端（运行中或已退出）时显示；右键菜单项在该项目没有终端时禁用。右键菜单可以结束非当前项目的终端。
  - 不再提供「重启终端」；终端里的进程自己退出后，仍可在终端里按 Enter 重新启动（原行为）。
- **点击项目不启动终端**（覆盖 PLAN M2「点击项目时创建 xterm 并调用 pty.open」）：单击、键盘 Enter、搜索框 Enter 选中项目时，已有终端则显示并聚焦；没有则显示「终端尚未启动」面板，由用户点面板（或其中的按钮）或顶部栏「启动 Claude / 启动 Codex」来启动。新添加的项目同样不自动启动。
- 非目标：结束前确认、「重启终端」（结束后再启动即可）。
- 应用版本号 1.4.0。

## 迭代 7 需求（2026-09-30 用户新增）

### M17 项目星标 / 收藏
- 目的（用户原话）：项目多了以后，给当前高频维护的热点项目加星标方便查找，维护期过了再取消。
- **收藏分组**（用户选择「移到收藏里」）：加了星标的项目显示在侧栏列表最上方的「收藏」分组中，并从下方「项目」分组中移出，同一个项目不出现两次；取消星标后回到「项目」分组中原来的位置。两个分组内都按添加顺序排列。
  - 没有星标项目时不显示「收藏」分组（与之前一样只有「项目」）；全部项目都加了星标时不显示「项目」分组。
- **入口**（用户选择「项目行上的星标按钮 + 右键菜单」）：
  - 鼠标移到项目行上（或该行有键盘焦点）时，行的右侧出现空心星按钮，点击加星标；已加星标的项目一直显示实心星，点击取消。点击星标按钮只切换星标，不选中项目。星标按钮的悬浮提示为「加星标」/「取消星标」。
  - 项目右键菜单「加星标」/「取消星标」。
- **搜索**：两个分组分别过滤、各自按匹配度排序，空的分组不显示；「收藏」在前，所以搜索框 Enter（默认打开第一个结果）优先打开匹配的星标项目。
- 列表键盘 `↑` / `↓` 在项目之间移动（跳过分组标题）。
- 星标保存在项目数据库里，重启后保留；加 / 取消星标不影响终端和助手状态。
- 非目标：收藏分组内拖动排序、星标快捷键、顶部栏星标按钮。

### M18 分组折叠（2026-09-30 用户新增）
- 点击分组标题（「收藏」/「项目」）折叠或展开该分组；标题右侧的箭头表示状态（展开朝下、折叠朝右）。标题可用键盘 Tab 聚焦，Enter / 空格切换。
- **折叠后完全隐藏**（用户选择）：只显示标题和项目数量，例如「项目 (9)」；不显示其中的任何项目（包括当前选中的项目），也不在标题上提示助手状态。展开时标题不显示数量。
- 折叠状态保存在 settings.json，重启后保留；分组暂时为空（标题不显示）时折叠状态也保留。
- **搜索时**：有搜索词时所有分组临时展开，显示全部匹配结果（标题不可点、不显示箭头）；清空搜索后恢复原来的折叠状态。搜索不改变保存的折叠状态。
- 加 / 取消星标后项目进入折叠的分组时，该分组的标题闪一下（代替项目行的闪烁），数量随之更新。
- 列表键盘 `↑` / `↓` 只在显示出来的项目之间移动（折叠分组里的项目跳过）。
- 非目标：折叠 / 展开动画（只有箭头旋转）、折叠时显示选中项或需要处理的项目、标题上的状态提醒。

应用版本号 1.5.0（M17 + M18）。

### M19 Codex 全部生命周期 hooks（2026-09-30 用户要求）
- 用户要求「把事件都加上」，并接受 codex 再提示一次「Hooks need review」、重新信任。
- codex 0.159.2 支持 12 个 hook 事件（从 codex 二进制与官方文档 learn.chatgpt.com/docs/hooks 确认），全部注入，状态对应：

| 事件 | 状态 |
|---|---|
| SessionStart | 刚启动时 → 就绪（resume / clear / compact 触发的不改变状态；0.159.2 实测仍在第一轮对话时才触发，所以点击启动后直接显示就绪） |
| UserPromptSubmit、PreToolUse、PostToolUse | 工作中 |
| PermissionRequest | 等待确认 |
| PreCompact | 工作中（手动 `/compact` 与自动压缩都是） |
| PostCompact | 手动 `/compact` 结束 → 就绪；自动压缩（一轮对话中间）不改变状态 |
| SubagentStart、SubagentStop | 不改变状态（主线程的事件已经反映工作状态；子代理可能在后台运行，不能据此判断整体完成），只记日志 |
| Stop | 已完成 |
| Interrupt | 用户中断一轮（Esc）→ 就绪（官方文档：中断后不会有 Stop） |
| SessionEnd | 清除状态（codex 原生事件）；启动命令外层的 try/finally 仍然保留上报，覆盖崩溃 / 被结束 |

- 实测（0.159.2）：`/new` 不触发 SessionEnd / SessionStart（状态保持就绪）；退出时每个对话线程各触发一次 SessionEnd，加上 finally 的上报，重复的都是空操作。
- 每个 hook 都会启动一次 PowerShell，codex 同步等待：实测每次约 0.1–0.3 秒（Windows PowerShell 约 0.13 秒、pwsh 约 0.3 秒），新增的 PreToolUse 让每次工具调用多等这么久。
- SessionEnd / Interrupt 是同步执行的 hook，codex 默认只等 1 秒，PowerShell 冷启动可能超过，这两个设置 `timeout = 3`（官方上限）。
- 要求 codex 支持这些事件（已验证 0.159.2）；更老的 codex 可能不认识新事件名，按钮启动会失败，届时升级 codex。
- 非目标：用 `--dangerously-bypass-hook-trust` 跳过信任（会连同用户 / 仓库自己的 hooks 一起免审，不安全）；改用 `~/.codex/hooks.json` 全局配置（沿用 M10 决定，不改 codex 的配置文件）。

### M20 等待确认时按键视为已处理（2026-09-30 用户要求）
- 背景：批准权限后到工具执行完之间，claude 与 codex 都没有事件（codex 的 PreToolUse 在 PermissionRequest 之前），状态一直显示「等待确认」，要等 PostToolUse 才回到「工作中」。
- 规则（用户原话「等待确认时你在终端里按了键，就算已处理」）：状态为「等待确认」时，用户在该终端里按键 → 「工作中」。claude 与 codex 相同。
  - 不算：只在确认框里移动选择的按键——方向键、Tab / Shift+Tab、Home / End / PageUp / PageDown（按了之后确认框仍在等待）；焦点上报与鼠标上报序列（不是按键）。
  - 算：其余一切输入，包括 Enter、Esc、数字、y / n、输入文字、粘贴、Ctrl+C。
- 只有按键才算，切换到该项目不会让「等待确认」变化（「已完成」仍是切换到项目即视为已查看）。
- 已知限制：claude 的 permission_prompt 通知若在用户已经作答之后才到，状态会回到「等待确认」，直到 PostToolUse。

应用版本号 1.6.0（M19 + M20）。

### 缺陷修复：输入法组字时终端画面横向跳动（2026-09-30 用户录屏）
- 现象（录屏逐帧确认）：claude 工作中（spinner 不停重绘）时用微软拼音在输入框里打字，整个终端画面（连同内边距）时不时向左跳 1–4 列、一两帧后恢复；候选窗从输入框跳到窗口右下角，组字文字画到终端右边缘外。
- 要求：组字时终端画面不能横移；候选窗与组字框跟随输入框，不随重绘中途的光标乱跳；没有程序重绘时的组字行为不变。
- 应用版本号 1.6.1。

## AI Dashboard（2026-10-06，M21，1.7.0）
- 用户授权先制作 HTML 设计稿：在现有顶部栏展示 Claude / Codex 指标，采用 MD3 Expressive，保留侧栏与终端；项目名 / workspace 路径编排进 Dashboard。
- 最新反馈：去掉右上角重复状态、结束终端和打开目录入口（项目列表已有）；Dashboard 增加 Agent 权限、会话名称、当前工作目录，以及该目录所属 Git 工作树的当前分支。
- 项目名称 / workspace 路径来自 AgentManager 项目记录；会话名称 / cwd / 权限来自绑定的实际 Agent 会话，两组信息独立，不用 workspace 冒充 cwd。分支按 Agent cwd 查询（含工作树子目录）；非 Git 目录不显示分支，未确认数据明确显示未就绪。
- 目标：模型、推理档位、上下文与额度易读；支持当前项目切换和窄窗口。设计稿使用明确标注的示例数据。
- 设计反馈：上下文、5 小时、每周采用更紧凑的统一指标组，使用 MD3 Expressive 波浪式确定值进度。波浪表示剩余比例，默认不持续滚动，保留文字数值、缺数据与低上下文状态。
- 编排反馈：顶部统一为同一surface，不再混用无背景项目区、高会话卡片和矮指标卡片；以三行共同基线对齐项目 / 会话 / 指标，窄窗口按整组换行。
- 最新方向：Dashboard 改为右侧常驻栏，形成项目列表 / 终端 / AI 仪表板三栏；纵向展示会话、目录、权限、波浪指标与项目workspace信息。窄窗口可收起 / 打开仪表板，避免终端被过度挤窄。顶部信息带方案被此方案替代。
- 用户已确认三栏设计并授权实现。当前运行的 AgentManager 与终端进程必须保留，不进行升级安装、关闭、重启或当前会话输入；验证使用隔离 userData 与测试进程。
- 用户取消Token/s：本次不显示生成速率，不启用OTel，不保留平均输出或速率采集代码。
- 真实数据按绑定会话隔离；更换会话清空旧指标，停止 / 移除终端清理采集。没有名称 / 权限 / 用量时显示未就绪，不从项目数据推测。
- Claude仅通过当前启动命令的 --settings 注入statusLine和hooks；Codex原有状态hook文本不变，新增SessionStart / UserPromptSubmit元数据handler（下次启动需信任新增两条）。不改全局配置。Codex原生底部statusline暂保留，Claude会话级statusLine将指标交给仪表板。
- 指标默认展示剩余比例，详情显示Token、重置时间和数据更新时间；Git按会话cwd读取，非Git隐藏分支、detached HEAD显示短提交。
- 仪表板收起偏好持久化；小窗口按需展开，不结束终端，ResizeObserver继续处理终端fit / PTY resize。

## Open
- codex 一轮对话出错（例如模型不可用）时不会有 Stop，状态停留在「工作中」直到下一次事件或 codex 退出。
- 退出 claude 时连按三次以上 Ctrl+C：多出来的 Ctrl+C 会广播给控制台里的所有进程，可能打断正在上报 SessionEnd 的 `curl.exe`，状态停在「就绪」、启动按钮保持禁用（结束终端可恢复）。正常的两次 Ctrl+C 或 `/exit` 已验证能清除状态。可选改进：像 codex 一样用 PowerShell `try/finally` 兜底上报。
- 用户按 Esc 中断 claude 时 `Stop` 不触发，状态会停留在「工作中」，直到下一次事件或约 60 秒后的 `idle_prompt` 通知。
