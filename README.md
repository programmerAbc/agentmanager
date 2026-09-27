# Agent Desk

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

- `npm run build:win` 生成 `dist/agent-desk-<版本>-setup.exe`（NSIS，按用户安装，可选安装目录，创建桌面与开始菜单快捷方式）。
- node-pty 整体放在 `app.asar.unpacked`（原生模块、conout Worker 脚本、console list agent 都需要在 asar 外）。
- `npmRebuild: false`：postinstall 已针对同一 Electron 版本编译过 node-pty，打包时不再重复编译。
- 原生模块只依赖系统 DLL（静态链接 CRT），目标机器不需要安装 Node 或 VC++ 运行库。
- 静默安装 / 卸载：`agent-desk-0.1.0-setup.exe /S /D=<目录>`；`"<目录>\Uninstall agent-desk.exe" /S /currentuser`。
- 目前使用 Electron 默认图标（未提供应用图标）。

## 数据位置

`%APPDATA%\Agent Desk\`：

- `projects.json` — 项目列表（损坏时自动备份为 `projects.json.bak-<时间戳>` 并以空列表启动）
- `settings.json` — 侧栏宽度、字号、最后选中的项目、窗口位置
- `logs\main.log` — 主进程日志（PTY 创建 / 退出 / kill / 错误）

## 字体

内置更纱黑体 Sarasa Term SC Regular（`resources/fonts/`，v1.0.42，SIL OFL 1.1，许可证见同目录）。
若字体文件缺失，终端回退到 `Consolas, 'Microsoft YaHei UI', monospace`。

## 终端快捷键

| 操作 | 快捷键 |
|---|---|
| 复制 | 有选中内容时 `Ctrl+C`（复制后清除选区）；`Ctrl+Shift+C` 始终复制 |
| 中断 | 没有选中内容时 `Ctrl+C` 照常发送给终端 |
| 粘贴 | `Ctrl+V` / `Ctrl+Shift+V`（经 `term.paste()`，支持 bracketed paste） |
| 字号 | `Ctrl+=` 放大、`Ctrl+-` 缩小、`Ctrl+0` 重置（全局生效并持久化） |
| 重启已退出的终端 | 进程退出后按 `Enter` |

终端内右键菜单提供「复制」「粘贴」；侧栏项目右键菜单提供「重命名 / 在资源管理器中打开 / 重启终端 / 移除项目」，选中项目时 `F2` 重命名。

## 中文输入法测试记录

| 日期 | 输入法 | 场景 | 结果 |
|---|---|---|---|
| 2026-09-27 | CDP 模拟组合输入（`Input.imeSetComposition` + `insertText`） | pwsh 中依次输入「中」「文」「测试」 | 上屏一次、不重复、不丢字 |
| 待填写 | 微软拼音 | pwsh / claude 中输入中文，观察候选框位置、上屏是否重复或丢字 | **待人工确认** |

## 人工验证记录

需要人工确认的项（输入法、显示效果等）见 [handoff.md](handoff.md) 的 Verification 一节。
