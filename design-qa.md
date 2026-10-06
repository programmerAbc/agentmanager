# AI Dashboard · 紧凑波浪版 QA

## Source / Evidence
- Source visual truth: 用户截图 codex-clipboard-Ac8nm8.png（1915×1022，位于用户Temp）；用户授权顶部增加 Dashboard、纳入项目身份并压缩三个指标。
- Implementation: docs/design/ai-dashboard.html；Chrome DevTools MCP，http://127.0.0.1:8796/ai-dashboard.html。
- 实现截图：.devtest/dashboard-wide.png（1920×1080）、dashboard-narrow.png（1040×800，Claude橙 / 低上下文）、dashboard-light.png（1040×800）、dashboard-small.png（600×800）。CSS视口与截图像素一致，DPR=1。
- 全图对比：.devtest/dashboard-comparison.png（3840px宽），源图归一化为1920px宽；实现去掉62px设计工具栏后并排观察。源截图密度未知，不做字体逐像素断言。
- 顶部细节对比：.devtest/dashboard-header-comparison.png，源图与实现顶部同宽排列，检查项目身份、指标密度和操作入口。
- 参考原图工作中、实现默认就绪；状态差异属于模拟状态。终端内容为示例，不要求复刻用户对话。

## Findings / Required Surfaces
- 字体：沿用Segoe UI / Microsoft YaHei UI；项目20px、模型14px、指标16px / 标签11px。数值对齐，窄窗口没有遮挡。
- 布局：三个指标共用348–360px宽的surface；桌面顶部86px，窄窗口分行。项目身份与右侧操作保留，无水平溢出。
- 色彩：黑色 / 白色沿用单色主题，Claude橙使用现有角色；低上下文警示色独立于主题；百分比明确表示剩余。
- 资源：内嵌项目已有Material Symbols Rounded图标，无外部资源。波浪是用户明确要求的数据可视化，以Canvas按比例绘制，不替代图标 / 品牌资产。
- 文案：指标组统一“剩余”；缺数据显示“—”且无进度值；详情与顶部一致。示例数据标注明确。
- 当前无需要修复的P0 / P1 / P2问题。

## Comparison History
- 第一版无法浏览器预览，原检查状态blocked。
- 第二版：MCP list_pages首次Target closed，new_page重试成功；宽 / 窄 / 三主题截图已观察。
- [P2] 小窗口span选择器隐藏功能图标：改为只隐藏文字span:not(.icon)；600×800重新截图确认品牌 / 添加 / 设置图标可见。
- 修复工具栏高度计算导致小窗口底部空隙：body改flex布局、app占剩余高度；600px截图确认终端延伸至底部。
- 最初favicon 404：内嵌空favicon后刷新，console error / warn为空。
- 修复后全图 / 顶部细节 / 小窗口 / 白色主题图片均已查看；上述问题不再存在。

## Interaction / Verification
- 30组（两助手 × 五状态 × 三主题）数据与状态检查通过。
- 真实MCP点击上下文打开详情；Esc关闭与焦点返回通过。
- 额度详情、关闭焦点返回、窄窗口开关、项目切换后指标清空、搜索过滤检查通过。
- 1920、1040、600px视口无水平溢出，持续操作无console error / warn。
- 波浪无持续动画，进度提供aria比例与缺数据说明。
- 未验证真实助手采集 / PTY / 安装版；本次仅HTML设计稿，无生产代码改动。

## Next
- 用户评审紧凑度与波浪视觉，再验证会话绑定和实际指标刷新。

## 第三版：会话身份与项目工作区分离
- 新参考：用户截图codex-clipboard-TVCjO6.png（2560×1210）与codex-clipboard-b5pa2E.png，标注要求去掉顶部重复操作并区别项目workspace与Agent目录。
- 新实现：.devtest/dashboard-session-wide.png（1920×1080）、dashboard-session-narrow.png（1040×800）、dashboard-session-small.png（600×800）；DPR=1。
- 全图与顶部细节比较：.devtest/dashboard-session-comparison.png、dashboard-session-header.png。参考缩放到1920宽，实现去掉62px工具栏，两个截图同时查看；截图高度与原始密度不同，比较语义编排与可见控件，不作像素级字体结论。
- 字体与内容：项目标为“项目工作区”，Agent字段为“会话 / 当前目录 / 权限”；细节弹层分别展示workspace和cwd。原始项目路径不被会话路径覆盖。
- 布局与颜色：宽屏三段（项目 / 会话 / 指标），窄屏分行；会话面板沿用现有surface / 字体 / 图标；桌面顶部为118px以容纳新增字段，属于授权设计变更。截图无信息遮挡或水平溢出。
- 资源：新增verified_user / account_tree仍来自项目Material Symbols Rounded；没有新网络依赖。
- 7项检查通过：其他仓库cwd与workspace独立、非Git隐藏分支、Codex只读、Claude计划模式、缺数据占位、目录详情、Esc焦点返回。控制台无error / warn。
- 移除右上角重复状态 / 停止 / 目录按钮；示例footer不再硬编码main / Full Access，避免将其错认作项目或会话真实数据。
- 检查后无新增P0 / P1 / P2；真实CLI权限、名称、cwd更新与Git查询仍未接入，不能根据示例宣称采集完成。

## 第四版：修复高低不齐与卡片拼接感
- 用户参考：codex-clipboard-CVuA9h.png（2510×1211），指出项目无surface、会话卡片过高、指标卡片偏矮；作为P2编排问题处理。
- 修复：统一surface，三段共同顶边 / 72px内容高度 / 三行24px基线；去掉中间与指标独立背景，使用低对比度分隔线。标题18px、数值23px为主层级，模型与路径为次层级。窄窗口指标铺满下一行，避免左下空白失衡。
- 浏览器证据：.devtest/dashboard-aligned-wide.png（1920×1080）、dashboard-aligned-narrow.png（1040×800）、dashboard-aligned-small.png（600×800），DPR=1；全图 / 局部对比dashboard-aligned-comparison.png和dashboard-aligned-header.png均已同时查看参考与实现。
- 参考归一化为1920px宽，实现剔除62px工具栏。原图密度未知、窗口高度不同，比较顶部语义与编排，不宣称像素级复刻。
- 五项表面检查：字体主次与基线清楚；留白与高度统一；现有三主题tokens保留；真实Material图标与数据波浪保留；项目 / 会话名称、当前目录、权限与剩余语义不变。
- 实测三主题三段y坐标一致且高度均72px；无水平溢出。缺数据 / 非Git / 会话详情 / Esc焦点返回通过，console无error / warn。
- 较早QA未将独立面板高度差视为阻塞，用户指出后已按新视觉要求修复并复查。真实数据接入仍不在本次验证范围。

## 第五版：右侧三栏
- 用户参考：codex-clipboard-uyNwKP.png标出整条顶部信息带并要求移到右侧。右侧布局是授权改变，不沿用旧顶部高度作为保真目标。
- 实现：.devtest/dashboard-right-wide.png（1920×1080）、dashboard-right-narrow.png（1040×800）、dashboard-right-drawer.png（600×800），DPR=1；对比板dashboard-right-comparison.png，源图归一化1920宽，实现裁去62px工具栏。
- 视觉：项目导航 / 终端 / 右侧仪表板三区明确；终端与右侧会话卡顶边一致。右侧标题 / 会话 / 目录 / 用量 / 项目workspace层级清楚，路径换行可见；三主题使用既有tokens与Material图标。
- 初次列布局继承旧flex-basis，造成指标 / 项目卡被撑高；重置flex与交叉轴对齐后重截图，指标卡约237px、项目卡约100px，无多余空白。
- 1040px保持三栏并提供收起；600px默认隐藏、打开为侧边浮层，不压缩终端。关闭按钮与Escape可收起，详情Escape不会同时关闭侧栏。
- 桌面收起后终端变宽、恢复正常；三主题均无水平溢出；console无error / warn。
- 最终截图已查看。真实数据、终端PTY resize与生产应用集成尚未验证；本次仍为HTML设计稿。

## 正式组件验收（M21）
- 设计真值为已确认右栏原型docs/design/ai-dashboard.html及dashboard-right-wide.png；生产实现为renderer/dashboard.ts与实际Electron构建。
- 生产截图：.devtest/dashboard-production-final.png、dashboard-production-compact.png。隔离实例使用独立userData和CODEX_HOME，不含凭据，输入来自假CLI；数据经真实HTTP / Store / IPC传入，没有在renderer直接写示例值。
- 正式视口1707×996、DPR=1.5；对比板dashboard-production-comparison.png将生产右栏缩回332px CSS宽，与原型1920×1080 / DPR=1的332px右栏并排。整体窗口尺寸与终端内容不同，不宣称整个窗口像素级复刻。
- 字体与copy：继承原应用Segoe UI主题；会话17px / 模型14px / 数据23px，中文名称正确，当前目录与workspace独立。长路径换行产生不同卡片高度为预期，增加来源更新时间为有意的生产信息。
- 布局与颜色：右栏332px（较窄300px），保持MD3 surface / 24px圆角；生产沿用实际主题tokens，原型固定示例颜色仅作参考。使用项目Material Symbols和DPR适配Canvas，未新增图片资产。
- 修复[P2]：旧.icon-btn后置规则覆盖收起按钮，使文字分行且桌面关闭按钮误显示；改为.icon-btn.dashboard-toggle / dashboard-close。重启只属于自建测试PID，截图确认按钮99×40、display:flex，桌面close:none。
- 功能：收起后xterm宽度1080→1416→1080，偏好保存；860px默认隐藏、展开浮层、详情 / 关闭 / 焦点返回通过。项目切换到未运行项显示空值，不串上一项目Git或指标。
- Codex和Claude两条模拟CLI链路正确展示各自数据，PowerShell UTF-8实际命令测试通过；类型 / 构建 / 6组测试通过。版本保持1.6.1，未打包安装新版。
- 未测真实CLI长会话、实际新增hooks审查；当前安装版受用户保护，不把模拟数据来源称为真实模型请求验收。Token/s已取消。

final result: passed
