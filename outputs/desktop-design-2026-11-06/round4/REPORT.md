# 桌面设计继续检查 · 第四轮

2026-11-06；工作树 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD `fc6e3638`。本轮集中检查新建、打开与克隆项目的入口；改动未提交，保留共享工作区前序变更。

## 修复结果

| 问题 | 原因 | 修改后的行为 |
| --- | --- | --- |
| 打开文件夹、新建项目或克隆时，目录选择失败没有提示 | 选择器 Promise 缺少拒绝处理；只有部分后续登记操作捕获错误 | 错误在当前入口或表单中显示；输入保留，可重新选择；成功后清理旧错误 |
| “最近打开”登记失败后界面无反应 | 错误被 `catch(() => undefined)` 吞掉 | 显示登记失败原因，重试成功后清除错误 |
| 新建项目尚未完成时可关闭面板，后续失败反馈丢失 | Esc、遮罩、关闭与取消按钮都直接卸载表单，输入仍能改动 | 创建期间固定名称、模板和位置，所有关闭路径走同一忙碌检查；失败保留输入并恢复操作，成功关闭 |
| 克隆期间可修改地址／位置或隐藏表单，后续结果与界面不一致 | 只禁用提交按钮，关闭按钮只隐藏表单，不会取消后台克隆 | 克隆期间固定地址和位置，禁用关闭及该添加入口，阻止重复提交；失败可见并可按原输入重试 |

复用现有错误行、禁用样式与状态文字；补充 `aria-busy`，新增文案接入既有 `STR`。没有增加依赖或修改 IPC、Provider、权限及主进程项目操作。

## 证据与验证

新增 `project-entry-smoke.cjs` 使用真实 renderer、真实鼠标／键盘输入以及显式开启的合成 AgentApi。修复前的隔离构建中，26 项检查有 13 项失败，并记录了 3 条未处理的选择器错误；修复后相同检查 26/26 通过，renderer 错误为 0。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 项目入口修复前 Electron | 13/26 通过，复现上述缺陷 | [读数](before/checks.json)、[日志](before.log) |
| 项目入口最终 Electron | 26/26 通过 | [读数](after/checks.json)、[日志](project-entry.log) |
| 原有对话框回车、中文组字与空名校验 Electron | 9/9 通过 | [读数](dialogs-enter-checks.json)、[日志](dialogs-enter.log) |
| 上轮设置草稿与唤醒错误恢复 Electron | 18/18 通过 | [读数](form-recovery-checks.json)、[日志](form-recovery.log) |
| 桌面 Vitest，`--maxWorkers=2` | 331 文件，2,280 项通过 | [最终日志](desktop-tests.log) |
| TypeScript、renderer layering、desktop boundary | 通过 | 当前工作树检查输出 |
| 隔离 Vite 构建 | 通过 | [日志](build.log) |
| 两个修改组件的设计 detector | 无发现 | [读数](detector.json) |
| smoke／fixture 脚本语法和本轮限定路径空白检查 | 通过 | `node --check`、`git diff --check` |

最终 Electron 合计 53 项检查。核对了 1440px 浅色错误／创建状态及 880px 深色新建表单；窄窗无横向溢出，主按钮可见。目录、登记、创建及克隆全部是内存夹具，未写入用户真实项目或配置，未实际执行 Git 克隆或调用 Provider。

首次测试夹具复用了画廊旧模板列表，其中含有由产品另行添加的 `blank`，造成重复单选项；已在本检查的独立夹具内改为真实接口结构，再记录上述修复前／后读数，没有把夹具错误计作产品缺陷。最初的最近项目菜单键盘驱动也未打开子菜单，改用真实指针展开后完成基线。

首次完整桌面测试发现新增错误文案未通过 `STR` 规则；已把两条文案接入目录，保留[失败日志](desktop-tests-initial-failure.log)，随后完整重跑通过。未修改或放宽测试断言。

本代理使用 OCR delegate 选择文件、解析规则后完成变更审查，没有运行 `ocr review` 或 `ocr scan`。见[组件与测试规则](review-rules.md)、[文案规则](review-strings-rule.md)、[原有 smoke 规则](review-enter-rule.md)。本轮审查没有剩余发现。

## 截图

- 位置选择失败：[修改前无提示](before/01-new-project-pick-error.png)／[修改后保留输入并显示原因](after/01-new-project-pick-error.png)
- [创建中固定输入与操作](after/02-new-project-creating.png)
- [克隆失败后的原输入与重试入口](after/03-clone-retry.png)
- [880px 深色新建表单](after/04-new-project-dark-880.png)

本轮产品变更为 `NewProjectDialog.tsx`、`AddProjectMenu.tsx` 和 `strings.ts` 的两条新增错误文案。测试变更为新增 `project-entry-smoke.cjs`、`ui-gallery-preload.cjs` 的项目入口专用夹具，以及 `dialogs-enter-smoke.cjs` 的可选隔离构建入口。文件中的其他前序变更不计作本轮新增。

未提交、未打包或发布；未运行完整核心 gates、HEAD 认证或 mutation。上述证据针对当前工作树与列出的项目入口，不代表所有桌面流程已全面验收。
