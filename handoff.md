## Completed
- M0：electron-vite + TS 工程骨架；node-pty 通过 @electron/rebuild 源码编译；最小页面（一个 xterm 连一个 pwsh）。
- M1：项目列表（添加 / 同路径去重 / 行内重命名 / 移除确认 / 在资源管理器中打开 / 侧栏宽度拖拽并持久化 / 最后选中项持久化 / 窗口标题）。

## In Progress
- M2 嵌入式终端。

## Next Steps
- M2 → M6，见 plans.md。

## Risks
- node-pty 源码编译依赖 VS Build Tools + Spectre 缓解库 + Python（README 已写明）。
- 字体文件 25MB 直接提交在仓库中。
- 150% 缩放下 `getNormalBounds()` 返回 1281×801（默认 1280×800），需观察重启后是否逐次增长 1px。

## Changed Files
- M1：src/renderer/{main.ts,sidebar.ts,contextMenu.ts,toast.ts,styles.css,index.html}；src/main/{ipc.ts,index.ts,jsonFile.ts,projectStore.ts,settingsStore.ts}（退出前 flush 写入）。

## Verification
- M0：`npm install` 通过（`✔ Rebuild Complete`）；`npm run typecheck` 通过；`npm run dev` 中 `dir`、`echo 中文测试` 输出正常（CDP 截图确认）。
- M1（`npm run typecheck` 通过；dev 下用 CDP + UI Automation 驱动原生对话框自测）：
  - 通过原生目录对话框添加 3 个项目（含中文目录名）→ 列表按添加顺序显示、短路径 + tooltip 完整路径、新项目自动选中、标题更新。
  - 再添加 `PROJA\`（大小写不同、带末尾分隔符）→ 未产生重复项，选中已有项目。
  - 右键菜单 4 项齐全；重命名 Enter 保存、Esc 取消。
  - 侧栏拖拽：322 → 上限 400 → 下限 180 → 312，写入 settings.json。
  - 移除：确认框「取消」不移除，「移除」后列表与 projects.json 同步；移除当前选中项后回到「选择一个项目」空状态。
  - 正常关闭（WM_CLOSE）后重启：列表、重命名结果、选中项、侧栏宽度、窗口位置均恢复。
- 待人工确认：无（M1 都已自动验证）。

## Resume Context
- 项目根目录即仓库根；需求在 PLAN.md，补充澄清在 docs/spec.md，设计在 docs/architecture.md。
- 自测方式：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录>`，再用 CDP（Runtime.evaluate / Input.* / Page.captureScreenshot）操作和截图；原生对话框用 UI Automation 找窗口 + `WM_SETTEXT` / `BM_CLICK`；关闭窗口用 `WM_CLOSE`（渲染进程 `window.close()` 不触发 close 事件）。
