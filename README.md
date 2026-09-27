# AgentManager

Windows 桌面应用：左侧是项目列表，右侧每个项目对应一个保活的嵌入式终端（工作目录为项目目录）。在终端里手动运行 `claude` 等命令，切换项目时终端和其中的进程不会中断。

需求见 [PLAN.md](PLAN.md)，设计见 [docs/architecture.md](docs/architecture.md)。

## 环境要求

- Windows 10 1903 及以上（ConPTY 的最低要求）或 Windows 11
- Node.js ≥ 22.12（开发时使用 24.12）
- **node-pty 源码编译所需工具**（`npm install` 的 postinstall 会用 `@electron/rebuild` 针对 Electron 编译 node-pty）：
  - Visual Studio 2022 生成工具（Build Tools），工作负载「使用 C++ 的桌面开发」（MSVC v143 + Windows 10/11 SDK）
  - 单个组件「**MSVC v143 - VS 2022 C++ x64/x86 Spectre 缓解库（最新）**」
    （组件 ID `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`）。缺少它会报 `MSB8040`。
    可以用命令行补装（需要管理员权限）：
    ```powershell
    & "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" modify `
      --installPath "<Build Tools 安装目录>" `
      --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre --passive --norestart
    ```
  - Python 3（已验证 3.13.1，node-gyp 需要）
- 网络：首次运行时需要下载 Electron 二进制（Electron 44 起在首次 `require('electron')` 时才下载，不在 install 阶段下载），以及 node-gyp 编译用的 Electron headers。

> 如果 shell 环境里设置了 `NoDefaultCurrentDirectoryInExePath`（部分 AI 编程工具的终端会设置），node-pty 依赖的 winpty gyp 脚本会找不到 `GetCommitHash.bat`。`scripts/postinstall.mjs` 已在子进程中去掉该变量。

## 常用命令

```powershell
npm install          # 安装依赖并编译 node-pty
npm run dev          # 开发模式启动（F12 打开 DevTools）
npm run typecheck    # TypeScript 类型检查（main/preload + renderer）
npm run build        # 类型检查 + 构建到 out/
npm run build:win    # 打包 NSIS 安装包到 dist/
```

## 打包与安装

- `npm run build:win` 生成 `dist/agentmanager-<版本>-setup.exe`（NSIS，按用户安装，可选安装目录，创建桌面与开始菜单快捷方式）。
- node-pty 整体放在 `app.asar.unpacked`（原生模块、conout Worker 脚本、console list agent 都需要在 asar 外）。
- `npmRebuild: false`：postinstall 已针对同一 Electron 版本编译过 node-pty，打包时不再重复编译。
- 原生模块只依赖系统 DLL（静态链接 CRT），目标机器不需要安装 Node 或 VC++ 运行库。
- 静默安装 / 卸载：`agentmanager-1.0.0-setup.exe /S /D=<目录>`；`"<目录>\Uninstall AgentManager.exe" /S /currentuser`。
- 1.0.0 由 Agent Desk 改名而来：`appId` 未变，安装时会先静默卸载已安装的 Agent Desk；数据目录改为 `%APPDATA%\AgentManager`，不迁移旧数据（旧目录 `%APPDATA%\Agent Desk` 保留，可手动删除）。
- 目前使用 Electron 默认图标（未提供应用图标）。

## 数据位置

`%APPDATA%\AgentManager\`：

- `agentmanager.db` — 项目列表（SQLite，表 `projects`；损坏时自动备份为 `agentmanager.db.bak-<时间戳>` 并以空库启动）
- `settings.json` — 侧栏宽度、终端字体 / 字号 / 行高、主题色、Claude / Codex 启动命令、最后选中的项目、窗口位置
- `agent-hooks\` — 「启动 Claude」时生成的会话 hooks 文件（每次启动应用时清空）
- `logs\main.log` — 主进程日志（PTY 创建 / 退出 / kill / 错误）

## 字体

- 终端默认字体 `Maple Mono NF CN`（需自行安装），未安装时依次回退 `Maple Mono NL NF CN` → `Cascadia Mono` → `Consolas` / 微软雅黑。可在设置里换成本机任意等宽字体。
- 内置更纱黑体 Sarasa Term SC Regular（`resources/fonts/`，v1.0.42，SIL OFL 1.1，许可证见同目录），可在设置中选择。

## 第三方资源

- Material Symbols 图标（`@material-symbols/svg-400`，Apache-2.0）
- Material Color Utilities（`@material/material-color-utilities`，Apache-2.0）

## 界面与功能

- **启动 Claude / 启动 Codex**：顶部栏按钮（也在「点击启动」面板和项目右键菜单里）。在当前项目终端里执行设置中的命令，默认分别为 `claude --permission-mode bypassPermissions`、`codex --dangerously-bypass-approvals-and-sandbox`；终端未启动时先启动。
- **工作状态**：通过按钮启动的 claude / codex 会在侧栏和顶部栏显示「就绪 / 工作中（形状变换动画）/ 等待确认 / 已完成」。「已完成」会一直保留，直到你切换到该项目或在它的终端里输入。手动输入的 `claude` / `codex` 没有状态。
  - Claude：追加 `--settings <userData>\agent-hooks\<会话>.json`，**不修改** `~/.claude/settings.json`。
  - Codex：追加 `-c $env:AGENT_DESK_CODEX_HOOKS` 注入 hooks，并用 `try { … } finally { … }` 检测退出，**不修改** `~/.codex/config.toml`。首次启动时 codex 会提示「Hooks need review」，选「Trust all and continue」后不再提示（这条信任记录由 codex 自己保存）。需要系统自带的 `curl.exe`。
- **搜索项目**（侧栏搜索框，或 `Ctrl+Shift+F`）：输入即过滤，模糊匹配项目名和侧栏上显示的路径（如输入 `agm` 能找到 agentmanager），多个词用空格分开；`↑` / `↓` 选择、`Enter` 打开、`Esc` 清空 / 回到终端。
- **设置**（侧栏底部，或 `Ctrl+,`）：终端字体（列出本机等宽字体，默认 Maple Mono NF CN）、字号、行高、主题色（Material 3 动态配色；「白色」为浅色界面，「黑色」为纯黑界面）、Claude / Codex 启动命令。点击左上角的应用名可查看版本信息。
- 界面采用 Material Design 3 Expressive 风格。

## 终端快捷键

| 操作 | 快捷键 |
|---|---|
| 复制 | 有选中内容时 `Ctrl+C`（复制后清除选区）；`Ctrl+Shift+C` 始终复制 |
| 中断 | 没有选中内容时 `Ctrl+C` 照常发送给终端 |
| 粘贴 | `Ctrl+V` / `Ctrl+Shift+V`（经 `term.paste()`，支持 bracketed paste） |
| 字号 | `Ctrl+=` 放大、`Ctrl+-` 缩小、`Ctrl+0` 重置（全局生效并持久化） |
| 设置 | `Ctrl+,` |
| 搜索项目 | `Ctrl+Shift+F` |
| 重启已退出的终端 | 进程退出后按 `Enter` |

终端内右键菜单提供「复制」「粘贴」；侧栏项目右键菜单提供「重命名 / 在资源管理器中打开 / 重启终端 / 移除项目」，选中项目时 `F2` 重命名。

## 中文输入法测试记录

| 日期 | 输入法 | 场景 | 结果 |
|---|---|---|---|
| 2026-09-27 | CDP 模拟组合输入（`Input.imeSetComposition` + `insertText`） | pwsh 中依次输入「中」「文」「测试」 | 上屏一次、不重复、不丢字 |
| 待填写 | 微软拼音 | pwsh / claude 中输入中文，观察候选框位置、上屏是否重复或丢字 | **待人工确认** |

## 人工验证记录

需要人工确认的项（输入法、显示效果等）见 [handoff.md](handoff.md) 的 Verification 一节。
