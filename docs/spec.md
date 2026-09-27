# Spec — Agent Desk

原始需求文档是仓库根目录的 [PLAN.md](../PLAN.md)（目标、技术栈、数据模型、IPC 契约、M0–M6 验收标准、UI 规格、代码约定）。**PLAN.md 是需求的权威来源**，本文件只记录对它的澄清、补充和实现时确定的细节，不重复其内容。

## 澄清与补充

### 项目根目录
- PLAN §2 的 `agent-desk/` 即本仓库根目录（`D:\develop\workspace_lab3\agentmanager`），`package.json` 的 name 为 `agent-desk`。

### IPC 返回值（PLAN §4、§7）
- §7 要求错误通过返回值传给渲染进程，因此：
  - `projects.add()` 返回 `DataResult<Project | null>`（`{ok:true,data}` / `{ok:false,error}`），用户取消时 `data === null`。
  - `projects.rename/remove/touch`、`pty.kill` 返回 `OpResult`（`{ok, error?}`）。
- 额外的 IPC（PLAN §4 未列出，但功能需要）：`projects.openInExplorer`、`settings.get/update`、`clipboard.readText/writeText`、`shell.openExternal`、`dialog.confirm`。

### 持久化
- 项目列表：`userData/projects.json`（PLAN §3）。
- UI 设置：`userData/settings.json`，格式 `{version:1, sidebarWidth, fontSize, lastProjectId, window}`，同样原子写入。字段不合法时逐项回退默认值；顶层结构损坏时备份后使用默认值。
- 字号范围 8–32，默认 14；侧栏宽度 180–400，默认 240。

### 重复添加判定
- 路径 `path.resolve` 后忽略大小写、忽略末尾分隔符比较（Windows 路径不区分大小写）。

### 终端环境变量
- 终端继承 `process.env`，额外设置 `TERM` / `COLORTERM`。
- 仅在未打包（dev）时，去掉 npm / electron-vite 注入的变量（`npm_*`、`NODE_ENV`(electron-vite 注入时)、`ELECTRON_CLI_ARGS` 等），避免干扰用户在终端里运行的命令。
- 始终去掉**父 Claude Code 会话的会话级标记**（`CLAUDECODE`、`CLAUDE_PID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SESSION_*`、`CLAUDE_CODE_MESSAGING_*`）：Agent Desk 若是从某个 claude 会话里启动的，这些标记会让终端里的 claude 以为自己是子会话（例如关闭会话记录）。用户配置类变量（`ANTHROPIC_*`、`CLAUDE_CONFIG_DIR` 等）不受影响。
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
- **状态检测只对通过按钮启动的 claude 生效**：命令的第一个词是 `claude` 时，自动追加 `--settings "<userData>/claude-hooks/<sessionId>.json"`，该文件只包含 Agent Desk 的 hooks（`curl.exe` 把事件 POST 到主进程本地端口）。**不修改** `~/.claude/settings.json`；手动输入的 `claude` 没有状态。
- **状态与显示**（侧栏项目、顶部栏状态标签）：
  - 工作中：`UserPromptSubmit`、`PostToolUse` → MD3 Expressive 形状变换加载指示器。
  - 等待确认：`Notification` 且 `notification_type` 为 `permission_prompt` / `elicitation_dialog`。
  - 已完成：`Stop`；一直保持，直到用户切换到该项目或在该终端里输入（焦点上报序列不算输入）后转为空闲。
  - 空闲（Claude 已就绪）：`SessionStart`；`Notification(idle_prompt)` 时若仍是「工作中」则回落为空闲（用户中断时不会触发 Stop）。
  - 结束：`SessionEnd`、终端退出 / 重启 / 移除 → 清除状态。
- 非目标：快捷键启动、修改全局 claude 配置、系统通知。

## Open
- 用户按 Esc 中断 claude 时 `Stop` 不触发，状态会停留在「工作中」，直到下一次事件或约 60 秒后的 `idle_prompt` 通知。
