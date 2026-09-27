## Completed
- M0：electron-vite + TS 工程骨架；node-pty 通过 @electron/rebuild 源码编译；最小页面（一个 xterm 连一个 pwsh）。

## In Progress
- M1 项目列表。

## Next Steps
- M1 → M6，见 plans.md。

## Risks
- node-pty 源码编译依赖 VS Build Tools + Spectre 缓解库 + Python（README 已写明）。
- 字体文件 25MB 直接提交在仓库中。

## Changed Files
- 新建工程全部文件：package.json、electron.vite.config.ts、tsconfig*.json、scripts/postinstall.mjs、src/**、resources/fonts/**、README.md、docs/**、plans.md、lessons.md、handoff.md。

## Verification
- `npm install`：通过（postinstall 编译 node-pty：`✔ Rebuild Complete`）。
- `npm run typecheck`：通过。
- `npm run dev`：启动正常；通过 CDP 向终端输入 `dir`、`echo 中文测试`，截图确认输出正常、中文显示正确、更纱黑体生效。

## Resume Context
- 项目根目录即仓库根；需求在 PLAN.md，补充澄清在 docs/spec.md，设计在 docs/architecture.md。
- 自测方式：`npx electron-vite dev --remoteDebuggingPort 9223 -- --user-data-dir=<临时目录>`，再用 CDP（Runtime.evaluate / Input.insertText / Page.captureScreenshot）操作和截图。
