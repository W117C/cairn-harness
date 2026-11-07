# 桌面设计继续检查 · 第五轮

2026-11-06；工作树 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD `fc6e3638`。本轮检查项目设置、项目目录操作和项目菜单；改动未提交，保留共享工作区其他变更。

## 修复结果

| 问题 | 修改后的行为 |
| --- | --- |
| 项目设置写入失败被上层当成成功，弹窗关闭并丢失修改 | 更新错误返回调用入口；弹窗显示原因，保留名称和位置，允许重试；内联改名的错误仍有提示 |
| 项目设置保存中仍能改输入或关闭，并误显示“创建中” | 保存期间固定输入、阻止误关，标注“保存中…”及 `aria-busy`；失败恢复编辑，成功关闭并刷新侧栏 |
| 项目设置、更改项目目录的选择器失败没有提示 | 在当前弹窗或通知中显示失败原因；重新选择后可继续操作 |
| 右下角项目菜单越出窗口，缺少键盘导航 | 按实际尺寸约束位置，窗口变化后重算；打开聚焦首项，支持方向键、Home／End、Esc 和焦点归还 |
| 成功提示遮挡菜单的下方操作 | 菜单使用原生 Popover 顶层；逐项点击命中检查及浅／深色截图确认操作不再被通知覆盖 |

菜单导航复用现有 `menuNavIndex`，没有新增依赖。原生 Popover 的顶层行为及手动控制方式见 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)。本轮保持既有外点关闭、键盘和视觉样式，仅复位浏览器默认位置、边距与文字颜色。

没有修改 IPC、Provider、权限或主进程项目保存逻辑。

## 验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 原始实现的项目设置／菜单检查 | 9/25 通过，2 条未处理选择器错误 | [读数](before/checks.json)、[日志](before.log) |
| 首次修复后的遮挡检查 | 25/26 通过；新增点击命中断言复现通知遮挡 | [读数](layer-before/checks.json)、[日志](layer-before.log) |
| 最终项目设置／菜单检查 | 26/26 通过，renderer 错误为 0 | [读数](after/checks.json)、[日志](settings-menu.log) |
| 前轮新建／打开／克隆项目回归 | 26/26 通过 | [读数](project-entry-checks.json)、[日志](project-entry.log) |
| 原有回车提交与中文组字回归 | 9/9 通过 | [读数](dialogs-enter-checks.json)、[日志](dialogs-enter.log) |
| 桌面 Vitest，`--maxWorkers=2` | 331 文件，2,280 项通过 | [日志](desktop-tests.log) |
| TypeScript、renderer layering、desktop boundary | 通过 | 当前工作树检查输出 |
| 隔离 Vite 构建 | 通过 | [日志](build.log) |
| 脚本语法、本轮限定路径空白检查 | 通过 | `node --check`、`git diff --check` |

最终 Electron 共 61 项检查，使用真实 renderer、合成 AgentApi、临时用户配置。未创建或移动真实项目，未写入实际用户设置，未调用 Provider。

新增检查覆盖即时写入失败、延迟保存失败、重复提交、保存中关闭、保存后重开回显、内联改名失败、目录选择失败与重试、窗口边缘、窗口变化、键盘导航、菜单到设置的焦点、长中文路径与深色窄窗。窗口边缘由真实项目行的 `contextmenu` 事件提供边缘坐标；随后使用原生按键与 DOM 点击命中读数验证。

设计 detector 保留两条既有 `styles.css:161,176` 的侧栏宽度动画警告，没有新增发现，不声称全表扫描零警告。见 [detector.json](detector.json)。CSS 未由 CodeGraph 索引，使用定点读取；组件与状态调用链已通过 CodeGraph 检查。

## 测试驱动校正与审查

两项初始键盘失败来自测试驱动：传入 `ArrowDown` 时，Electron 实际生成空 `key`／`code`；原生按钮还需要完整的字符事件才能模拟 Enter 激活。已按 [Electron 输入事件](https://www.electronjs.org/docs/latest/api/structures/keyboard-input-event)与[有效键码](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#available-key-codes)说明校正，并用本机最小按钮探针确认：只发 keyDown／keyUp 点击数为 0，补充 char 后为 1。

保留[诊断日志](keyboard-driver-diagnosis.log)。随后用修正后的同一驱动重新记录原始实现的红测与最终绿测。模板方向键断言也已加强，必须实际移动到下一项并改变选中状态；未将驱动错误计作产品缺陷或降低断言。

本代理通过 OCR delegate 选择文件并读取规则后完成审查，未运行 `ocr review` 或 `ocr scan`。见[组件／状态／测试规则](review-rules.md)、[样式规则](review-style-rule.md)。本轮变更无剩余审查发现。

## 截图

- 保存失败：[修改前弹窗消失](before/05-project-settings-write-error.png)／[修改后保留输入与错误](after/05-project-settings-write-error.png)
- 菜单：[原始越界](before/06-project-menu-edge.png)／[首次修复仍被通知遮挡](layer-before/06-project-menu-edge.png)／[最终操作完整可见](after/06-project-menu-edge.png)
- [深色菜单](after/08-project-menu-dark-880.png)
- [深色窄窗、长路径项目设置](after/07-project-settings-dark-880.png)

本轮产品改动为 `components/Sidebar.tsx`、`state/projects.ts`、`styles.css` 的项目菜单规则及 `strings.ts` 的四条文案。测试改动为扩展现有 `project-entry-smoke.cjs` 和 `ui-gallery-preload.cjs` 的项目专用夹具；文件中的其他前序变更不计作本轮新增。

未提交、未打包或发布；未运行完整核心 gates、HEAD 认证或 mutation。结果针对当前工作树与所列流程，不代表所有前端流程均已全面验收。
