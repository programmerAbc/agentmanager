# Plans — AgentManager

需求见 [PLAN.md](PLAN.md)。严格按 M0 → M6 推进，每个里程碑：typecheck + dev 启动 → 对照验收项自检 → 人工验证项交给用户 → `git commit -m "M<n>: <简述>"`。

## 里程碑

| 里程碑 | 状态 | 备注 |
|---|---|---|
| M0 工程骨架 + node-pty 验证 | ✅ 完成 | node-pty 源码编译通过（补装 Spectre 库）；`dir` / `echo 中文测试` 显示正常 |
| M1 项目列表 | ✅ 完成 | 添加/去重/重命名/移除/持久化/宽度拖拽已自测；「重启终端」「运行圆点」在 M2 接入 |
| M2 嵌入式终端 | ✅ 完成 | claude TUI、中文/emoji 对齐、pwd、WebGL 已自测 |
| M3 切换保活 | ✅ 完成 | 行为在 M2 的 TerminalView 设计中实现；后台输出、claude 保活、切回时 fit→resize 已自测 |
| M4 终端交互细节 | ✅ 完成 | 复制/粘贴/中断/字号/ResizeObserver 已自测；微软拼音实测待用户确认 |
| M5 生命周期与清理 | ✅ 完成 | 移除/重启/退出均清理整棵进程树；退出确认；窗口与选中项持久化；退出后零残留已自测 |
| M6 打包 | ✅ 完成 | NSIS 安装包 118MB；本机安装→运行→退出→卸载已自测；「干净机器」验证待用户执行 |

## 迭代 2（需求见 docs/spec.md「迭代 2 需求」）

| 里程碑 | 状态 | 任务 |
|---|---|---|
| M7 设置页 / 字体 / MD3 Expressive | ✅ 完成 | 设置字段扩展（字体、行高、主题色、Claude 命令）与校验；`app.info` IPC；动态配色（material-color-utilities）；MD3 样式重做（侧栏抽屉、FAB、顶部栏、菜单、对话框、Snackbar）；设置页；本机等宽字体检测；移除确认改为应用内对话框 |
| M8 启动 Claude + 工作状态 | ✅ 完成 | hooks HTTP 服务（127.0.0.1 随机端口 + token）；每会话 hooks 设置文件；`claude.launch` IPC；渲染进程状态机；侧栏 / 顶部栏状态显示；形状变换加载指示器；端到端验证（含一次最小 prompt） |

## 迭代 3

| 里程碑 | 状态 | 任务 |
|---|---|---|
| M9 项目记录存入 SQLite | ✅ 完成 |
| M10 Codex 启动与状态；设置对话框位置 | ✅ 完成 | 类型与 IPC 泛化为 agents；hookServer 增加 codex 路由与环境变量；PTY 注入环境变量；codex 启动命令（try/finally）；状态机按助手区分；UI 按钮 / 右键菜单 / 设置；对话框高度与居中；验证 | `node:sqlite` 实现 ProjectStore（接口不变）；schema 版本（`PRAGMA user_version`）；从 projects.json 迁移；损坏备份；退出时关闭数据库；验证迁移 / 增删改 / 去重 / 损坏恢复 / 打包 |

## 迭代 4（需求见 docs/spec.md「迭代 4 需求」）

| 里程碑 | 状态 | 任务 |
|---|---|---|
| M11 项目列表模糊搜索 | ✅ 完成 | 模糊匹配与打分（纯函数，fuzzy.ts）；侧栏搜索框、过滤 / 排序 / 高亮；键盘（Ctrl+Shift+F、↑↓、Enter、Esc）；输入法组字；无结果提示；dev + CDP 验证 |
| M12 白色 / 黑色主题 | ✅ 完成 |
| 修复：终端文字错乱（用户反馈，2026-09-28） | ✅ 完成（1.3.2） | 根因为 @xterm/addon-webgl 0.19.0 图集页合并后纹理版本号撞号（上游 #4480）；Vite 插件构建时修补；dev 压力脚本稳定复现并验证修复。发版前可再跑一次 `.devtest/atlas-run.sh`。上游发布 addon-webgl 0.20 正式版后升级并删除插件 |
| 修复：用过换行键后 Esc 失效（用户反馈） | ✅ 完成（1.3.1） | ConPTY 收到 win32-input-mode 序列后吞掉单独的 ESC；发过换行序列的 PTY 改发 win32-input-mode Esc；node-pty 复现 + dev 验证（探针、PSReadLine、claude `/resume`） |
| M15 顶部栏按钮、Ctrl+单击打开文件（用户反馈） | ✅ 完成 | 助手运行时隐藏启动按钮；OSC 8（linkHandler）、网址、纯文本路径统一 Ctrl+单击；主进程协议白名单与可执行文件 / 网络位置保护；FORCE_HYPERLINK=1 |
| M14 默认终端 | ✅ 完成 | shells.ts 检测 / 解析（pwsh、powershell、cmd、Git Bash）；设置字段与校验；pty.open 按设置启动并记录 shell 家族；按家族生成 claude / codex 启动命令；设置页下拉（通用化 select 菜单）；dev 验证各 shell 启动、cwd、换行键、claude / codex 启动与退出上报 |
| M13 换行按键与光标样式（迭代 5，用户反馈） | ✅ 完成 | 实测 claude / codex / PowerShell 各自如何读 Enter 变体；Shift/Ctrl/Alt+Enter 发 win32-input-mode Shift+Enter（字符 LF）；设置「光标」竖线 / 下划线 / 方块（默认竖线）；dev 自测窗口不抢焦点 | theme.ts 按种子色选方案（单色浅 / 单色深纯黑 / 原动态深色）；浅色 ANSI 与最小对比度；color-scheme；色块描边；截图检查各界面 |

## 迭代 6（需求见 docs/spec.md「迭代 6 需求」）

| 里程碑 | 状态 | 任务 |
|---|---|---|
| M16 结束终端；点击项目不自动启动终端（用户反馈） | ✅ 完成（1.4.0） | 「重启终端」改为「结束终端」（顶部栏按钮仅在有终端时显示、右键菜单无终端时禁用）；点击 / Enter / 搜索 Enter / 添加项目只选中不启动；dev + CDP 验证（含真实鼠标点击后的焦点、已退出终端、启动中结束、助手状态清除、进程树已结束） |

## 迭代 7（需求见 docs/spec.md「迭代 7 需求」）

| 里程碑 | 状态 | 任务 |
|---|---|---|
| M17 项目星标 / 收藏（用户要求） | ✅ 完成（1.5.0） | schema v2（`starred` 列）+ 迁移；`projects.setStarred` IPC；侧栏「收藏 / 项目」分组（搜索时各自过滤排序）；行内星标按钮 + 右键菜单；列表 ↑↓ 跳过分组标题；dev + CDP 验证（迁移、持久化、分组、搜索、真实鼠标悬浮 / 点击） |
| M18 分组折叠（用户要求） | ✅ 完成（1.5.0） | 设置 `collapsedGroups`（类型、默认值、解析与校验、IPC patch）；分组标题按钮（箭头、数量、aria-expanded、键盘）；折叠分组不渲染；搜索时临时展开；星标进入折叠分组时闪标题；dev + CDP 验证（真实鼠标、持久化、搜索、↑↓） |
| M19 Codex 全部生命周期 hooks（用户要求） | ✅ 完成（1.6.0） | `CODEX_HOOK_EVENTS` 扩展到 12 个；压缩事件按 manual / auto 分组上报；SessionEnd / Interrupt `timeout=3`；状态机映射（Interrupt → 就绪、手动压缩结束 → 就绪、Subagent 只记日志）；真实 codex 验证（信任、工具调用、中断、/compact、退出） |
| M20 等待确认时按键视为已处理（用户要求） | ✅ 完成（1.6.0） | 终端输入排除鼠标上报；`markInput`（导航键不算）；dev 验证（模拟 PermissionRequest + 各类按键；真实 codex 审批一轮） |
| 修复：输入法组字时终端横向跳动（用户录屏） | ✅ 完成（1.6.1） | 录屏逐帧定位；模拟重绘 + CDP 组字复现（`#terminal-host` 被横向滚动）；`overflow: clip`；组字位置防抖 + 右边缘收回；复测模拟与真实 claude |

## 阻塞
- 无。

## 待用户确认
- 微软拼音输入法实测（候选框位置、上屏不重复不丢字）→ 填写 README「中文输入法测试记录」。
- claude TUI 长时间对话下有无错位/闪烁。
- 在未安装 Node 的干净 Windows 机器上安装 `dist/agentmanager-1.0.0-setup.exe` 并走一遍 M1–M5。

## 可选改进（未排期）
- 应用图标（目前为 Electron 默认图标）。
- 升级 node-pty 后复查 conhost 残留问题（见 lessons.md），修复后在 shell 退出时释放 pseudoconsole。

## 延后（PLAN §9，本期不做）
- 打开时自动运行命令；Claude Code hooks 状态显示与通知；一个项目多个终端 tab；WSL shell；PTY 守护进程化与输出回放。
