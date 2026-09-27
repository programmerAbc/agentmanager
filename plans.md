# Plans — Agent Desk

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

## 阻塞
- 无。

## 待用户确认
- 微软拼音输入法实测（候选框位置、上屏不重复不丢字）→ 填写 README「中文输入法测试记录」。
- claude TUI 长时间对话下有无错位/闪烁。
- 在未安装 Node 的干净 Windows 机器上安装 `dist/agent-desk-0.1.0-setup.exe` 并走一遍 M1–M5。

## 可选改进（未排期）
- 应用图标（目前为 Electron 默认图标）。
- 升级 node-pty 后复查 conhost 残留问题（见 lessons.md），修复后在 shell 退出时释放 pseudoconsole。

## 延后（PLAN §9，本期不做）
- 打开时自动运行命令；Claude Code hooks 状态显示与通知；一个项目多个终端 tab；WSL shell；PTY 守护进程化与输出回放。
