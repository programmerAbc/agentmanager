# Git 子仓库分支展示与监控方案

2026-11-12 · 设计已确认，功能已实现；下文为设计依据，落地差异见末节

## 展示

保留现有项目侧栏与终端，在终端右侧新增 320px 可收起的「Git 仓库」面板。顶部栏的「仓库 N」按钮恢复面板。窗口较窄（≤1100px）时作为右侧浮层打开，遮罩或 Escape 关闭；不持续压缩终端。面板宽度变化时沿用 TerminalManager 的 resize / fit 路径，避免终端字符错位。

每个仓库一行：目录名、相对路径、分支胶囊；分支特别长时省略并提供完整 title，点击分支复制。路径必须以文本渲染，防止不可信文件名进入 HTML。路径稳定排序，变更不跳行；被改分支短暂高亮，低干扰地显示「已更新」及最新校验时间，不弹全局 toast。列表可滚动、搜索目录或分支，数量表示全部仓库，过滤时补充命中数。读取错误不冒充 main，保留上次分支时明确标记「上次读取」，失败行可重试。

无仓库 / Git 不可用 / 扫描中 / 部分路径不可读均有文案；扫描途中可以先呈现已发现结果，但不能提前显示「全部已同步」。大列表 >200 行采用窗口化渲染（含完整可访问的搜索入口），待实现时验证键盘浏览。主面板仅展示信息，不切换分支。

## 发现范围

1. 最新范围：只扫描 Project.path 的第一层直属子目录；根目录如有 `.git` 也另列「项目根目录」。不枚举子目录内部，不发现第二层或更深的仓库，包括深层嵌套仓库 / 子模块。
2. `.git` 文件和目录均识别，永不进入 `.git` 内部。不对每个普通子目录运行 `git rev-parse`：否则 Git 向上查找会把一个仓库内的所有目录重复算成仓库。先发现 `.git` 标记，再用 Git 验证候选是工作树根目录。
3. 不按 `.gitignore` 排除（被忽略目录内也可能有独立仓库）；默认不排除 node_modules、build 等普通目录，以满足「所有」。可配置排除属于后续可选项，界面必须标明排除范围。不自动纳入无工作树的 bare 仓库，因为没有当前检出工作分支。
4. 默认不跟随符号链接 / junction；realpath 边界与去重防越界 / 循环。发现同一 git common dir 下不同 worktree 时保留不同工作树行，不能按 common dir 合并。
5. 首轮异步分批扫描，不用同步 IO 阻塞 Electron 主线程；目录并发上限 8，Git 子进程上限 4。每 200 个目录让出事件循环并报告进度。长扫描可取消；超过 10 秒显示仍在扫描及计数，不静默截断目录数 / 深度。

## 读取事实

- Git 路径通过系统可执行文件定位；主进程 `execFile(gitPath, args, {cwd, windowsHide:true, timeout:3000, maxBuffer:256*1024})`，不用 shell 拼命令。清理继承的 `GIT_DIR / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_INDEX_FILE / GIT_NAMESPACE` 等仓库覆盖变量，防止读成父进程仓库；不修改全局 Git 配置，不自动添加 safe.directory。
- 候选验证：`git rev-parse --show-toplevel` 对比候选 realpath；`git rev-parse --absolute-git-dir` 定位 gitdir，`git rev-parse --path-format=absolute --git-path HEAD` 定位当前工作树 HEAD。Git 支持 `.git` 指针文件，不手写固定 `.git/HEAD` 假设。
- 首读 `git symbolic-ref --quiet --short HEAD` 获取分支（含尚未提交的分支）；若是分离 HEAD，再 `git rev-parse --verify --short HEAD` 取短 SHA。区分「非符号引用」的预期返回码与权限 / 仓库损坏等失败；不能把任意失败都当 detached。
- 稳态读取小型 HEAD 内容：`ref: refs/heads/<name>` → 分支；detached → SHA 前缀。遇到异常格式 / 其他符号引用链交给 Git 验证，保留未知状态。要展示「尚无提交」时通过 Git 验证引用是否能解析，不用对象文件存在性推断（兼容 packed refs）。
- 首期只展示当前分支，不做 dirty、ahead/behind、远程查询，避免 git status 扫工作树。分离 HEAD 的提交变化也刷新。常规分支上新增提交而分支名未变无需制造变更提示。

## 外部变更监控

| 层 | 触发与策略 | 解决的问题 |
|---|---|---|
| 即时通知 | 对实际 gitdir 目录监听，过滤 HEAD / 不确定文件名事件；对 `.git` 指针所在工作树目录也监听 | IDE / 命令行切换、worktree HEAD、指针替换 |
| 合并重读 | 每仓库去抖 150ms，最长等待 500ms；HEAD 短暂不存在 / 锁定时 100/300/1000ms 重试 | 原子 rename、切换中的中间状态、事件风暴 |
| 周期校验 | 面板可见时每 5 秒读取已发现 HEAD 内容；每 30 秒分批重扫目录结构 | 事件丢失、监听失效、新增 / 删除仓库 |
| 目录发现事件 | 根及第一层直属目录的非递归 watch，1 秒合并一次发现任务；不可用则目录轮询 | 第一层新 clone / init / 移入 / 移出，包括已有空目录内执行 git init |
| 生命周期恢复 | 窗口重新聚焦 / 从挂起恢复 / 展开面板时立即校验并重建失效 watch | 后台节流、休眠和路径重建 |

目录监听事件不可信作事实，只提示脏状态。watcher 数量设置上限 256；超出部分靠轮询并标记监控降级。根 watcher 仅加速第一层增删，第一层目录 watcher 仅处理自身 `.git` 标记；实际 HEAD 另有专门 watcher。每轮扫描互斥，变更只挂一个后续扫描，避免任务堆积。

对前台本地正常磁盘的目标：事件到界面通常 <1 秒；HEAD 事件丢失约在 5 秒校验周期内开始恢复；发现事件丢失约在 30 秒重扫周期内开始恢复，加实际扫描耗时。不是硬实时承诺。网络盘、巨型树、权限错误都可能更慢；显示状态及实际校验时间。

分支瞬间切 A→B→C 时展示最终 C，不保证记录所有瞬时分支。相同值不重复推送；相同分支重读只推进校验时间。HEAD 连续读取失败要将「自动更新」降为「更新异常」，直到恢复成功，不能一直给绿色正常状态。

## 模块与 IPC

- `src/main/gitRepositoryMonitor.ts`（拟新增）：目录发现、读取、缓存、调度、监听释放。监控对象按当前工作树 realpath 去重、引用计数，gitdir 与 common dir 分开。
- `src/shared/types.ts`：`RepositoryBranch {id, relativePath, branch, shortOid, state, error?, lastSuccessAt}`；`GitSnapshot {projectId, subscriptionId, revision, scanState, scanComplete, monitorState, skippedPaths, repositories, checkedAt}`。
- `src/main/ipc.ts`：`git:subscribe(projectId)` 返回主进程生成的 subscriptionId 和初始快照；`git:changed` 推送完整小快照 / 大列表批量差异；`git:refresh(projectId, subscriptionId)`；`git:unsubscribe(subscriptionId)`。主进程检查项目存在、订阅归属与发送方，refresh 做限流。
- preload 提供类型化方法与返回解除监听函数；renderer 先注册事件，再 subscribe，缓冲尚未绑定 subscriptionId 的事件，用 revision 排序防止 invoke 响应盖掉较新事件。只接收当前项目 + 当前订阅，重载时从快照恢复。
- `src/renderer/gitRepositoriesPanel.ts`（拟新增）：列表、搜索、状态、折叠；main.ts 连接项目切换、面板宽度与 TerminalManager fit。清理不触发 PTY 输入或终端重启。
- 切项目时取消旧扫描并释放旧订阅 watcher / timer；面板折叠保留缓存，停止高频监听与周期任务，展开重新校验。窗口隐藏 / 最小化可暂停轮询，恢复立即校验。退出及 webContents 销毁完整 dispose，进行中的任务用 generation 防止回写。
- 分支事实只在内存；不改变 SQLite schema。可新增设置 `gitPanelExpanded` 保存用户偏好（默认宽屏展开，窄屏关闭），加载旧 settings 时提供缺省值。

## 验收与实现顺序

先完成读取与发现模块，使用独立临时仓库验证，再接监控和 IPC，最后接面板。测试不使用用户项目执行 checkout。

1. 第一层、根仓库与非 Git 目录；深层及仓库内嵌套仓库不展示；新 init 无提交；中文 / 空格 / 长路径。
2. 外部执行 `git switch` 后更新；HEAD.lock → HEAD 原子替换；连续快速切换仅最终值；同分支新提交不闪变。
3. detached HEAD、两个 worktree 不同分支、submodule `.git` 文件、packed refs。
4. 新 clone / init、仓库删除 / 重建、根路径消失 / 恢复；权限拒绝显示部分扫描；无法扫描子树时保留旧行并标旧，完整扫描确认不存在后才删除。
5. Git 未安装 / safe.directory 拒绝 / HEAD 损坏 / 文件锁定：明确错误、可重试；不篡改配置。
6. 强制禁用 watcher 后检查 5 秒 / 30 秒兜底；大量目录测主进程响应时间、任务并发和监听数量。
7. 项目 A→B 时 A 的迟到事件不污染 B；折叠 / 最小化 / 恢复；退出无残留 watcher / timer / Git 进程。
8. 隔离 dev 实例检查三主题、窄屏浮层、键盘 / Escape、长分支、搜索与复制；终端正常 fit、输入法与当前助手状态不受影响。

## 依据

- [Git rev-parse](https://git-scm.com/docs/git-rev-parse)：实际 gitdir、工作树与 git-path 解析。
- [Git repository layout](https://git-scm.com/docs/gitrepository-layout)：gitfile、HEAD、worktree / common directory 布局。
- [Node fs.watch caveats](https://nodejs.org/api/fs.html#caveats)：平台差异、文件名可能缺失、删除 / 重建与网络文件系统限制，所以通知必须配合校验。

## 实施结果与取舍

- 正式源码为 `gitRepositoryMonitor.ts`、`gitIpc.ts`、`gitRepositoriesPanel.ts`，类型 / preload / App / 样式与设置已接入。已随 1.9.0 提交并推送 main，安装包交付到 `D:\agnent_manager_release\agentmanager-1.9.0-setup.exe`，未自动安装。
- 每个 renderer 同时只有一个当前项目订阅，以 subscriptionId / revision / renderer generation 隔离异步结果；无需跨窗口仓库引用计数。推送完整快照，UI 忽略纯校验时间变化的列表重建；208 行压力检查已通过，将来规模进一步增长再评估差异推送。
- 目录与 Git 任务并发使用 4（小于方案上限）。已知 `.git` 目录身份或指针内容未变时复用定位结果；新发现 / 重建 / 指针变化才重新启动定位命令。稳态 HEAD 未变且不是 unborn / error 时只读文件；unborn 需继续验证是否已有首次提交。
- 最新调整的即时监听包括项目根 / 第一层目录的非递归 watcher 与去重后的实际 HEAD 所在目录 watcher，总上限 256；超限或不可用即明确显示定期校验。第一层目录 watcher 覆盖 `.git` 指针变化；无原生目录事件时靠30秒同范围重扫恢复。该浅层调整尚未打包，1.9.0为此前递归版本。
- 方案中的「同值不重复推送」调整为仍推送校验时间，便于明确更新状态；列表内容未变不重建 DOM。浮层 / 面板焦点内 Escape 可关闭；终端 Escape 始终保留给 CLI。
- 首读与变更通过 Git 解析，后续 Git 命令显式指定实际 gitdir / work-tree，防止无效 HEAD 触发 Git 向上发现。只读配置，未设置 safe.directory、hooks 或全局环境。
- 隔离 Electron 实测外部切换 → UI 单次约 290ms；文件监听失效兜底、HEAD 原子替换、worktree / submodule、packed refs、损坏恢复、junction、指针缓存失效与 GIT_* 隔离由自动测试覆盖。208 仓库窗口化、搜索与三主题 / 720–1280px、旧 token / 快速切项目、shell 布局及 Escape 已实测。
- 网络文件系统、极大目录树的长期 CPU / IO / 内存与真实系统休眠恢复未实测；不可读目录分支有实现，当前 Windows 账号下未人为修改 ACL 进行集成验证。复制沿用已存在的 clipboard IPC，未覆盖用户剪贴板做测试。
