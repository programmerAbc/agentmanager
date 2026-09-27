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

### 开发模式的终端环境
- 终端继承 `process.env`，额外设置 `TERM` / `COLORTERM`。
- 仅在未打包（dev）时，去掉 npm / electron-vite 注入的变量（`npm_*`、`NODE_ENV`(electron-vite 注入时)、`ELECTRON_CLI_ARGS` 等），避免干扰用户在终端里运行的命令。

### 渲染进程重载
- 渲染进程重新加载或崩溃时，主进程清理全部 PTY（xterm 实例已不存在，保留 PTY 没有意义）。

## Open
- 暂无。
