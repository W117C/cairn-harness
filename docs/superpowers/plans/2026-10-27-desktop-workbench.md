# Desktop Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面顶部收敛为清楚的「改动 + 工具」，维持侧栏、对话和按需面板。

**Architecture:** 新增一个 props in / events out 的 WorkbenchTools 展示组件，复用 Radix DropdownMenu、pane registry 与既有回调。AppToolbar 只组合上下文、标题、目录和该组件；检查器开合状态来自 useChrome，不另存。

**Tech Stack:** Electron、React、TypeScript、Radix DropdownMenu、lucide-react；不新增依赖。

**Spec:** docs/superpowers/specs/2026-10-27-desktop-workbench-design.md

## Global Constraints

- 用户已明确确认实施方案 1；由当前 agent 在当前会话执行，执行细节无需重复确认。
- 当前 checkout 在 `fix/spec-summary-double-count`，有并发未提交工作；保留已有修改，只做窄 diff，不提交混合工作树。
- 沿用暖色主题，不修改权限、IPC、agent 路由、全局配置或规则文件。
- 改动数量是现有会话投影，不宣称 Git 工作树总量。
- 窄窗保留有文字的入口，快捷键沿用既有注册表。

## Review Focus

- 面板仍开着但检查器隐藏时，入口应能把它重新显示，而不是误关窗格。
- 从工具菜单切换详情和专注模式，状态必须与真实布局一致。
- 首页无会话和设置页，不能出现点了没有意义的任务操作。
- 880 / 720 宽及长会话标题，入口应可见且不与标题重叠。
- 菜单关闭后焦点应返回工具入口；菜单项键盘可达，原快捷键有效。

### Task 1: 工具入口与真实交互

**Files:**
- Create: `apps/desktop/src/renderer/components/WorkbenchTools.tsx`
- Modify: `apps/desktop/src/renderer/panes/AppToolbar.tsx`
- Modify: `apps/desktop/src/renderer/panes/WorkbenchView.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`（若属性映射需要）
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/tests/workbench-tools.test.tsx`
- Test: `apps/desktop/scripts/workbench-tools-smoke.cjs`

**Interfaces:** WorkbenchTools 消费 activeSession / paneTabs / fileCount / inspectorOpen / pluginSidebarOpen / focusMode，产出 onTogglePane(kind)、onToggleInspector()、onTogglePluginSidebar()、onToggleFocusMode() 事件。复用既有回调，不新增业务状态。

- [x] Step 1: 添加 SSR 断言与独立隔离 Electron smoke，覆盖有文字入口、空态、窄窗、菜单、面板、焦点与快捷键。
- [ ] Step 2: 对现有构建运行 smoke，预期缺少新入口而 FAIL；保存原始读数。（未保留：接手时实现已在盘，重建基线需回滚组件；见 Completion。）
- [x] Step 3: 实现 WorkbenchTools 与最小属性接线，复用已有菜单和窗格；消除旧的 tb-quick 隐藏规则。
- [x] Step 4: 运行新测试、桌面构建、原布局和交互 smoke、新 smoke；全部非空断言通过。
- [x] Step 5: 当前工作树不自动提交；把本轮文件和已有修改的边界写入证据报告。

### Task 2: 基线失败与完整验证

**Files:** `apps/desktop/src/renderer/components/Inspector.tsx`、`apps/desktop/tests/render-structure.test.tsx`；证据写入 `outputs/desktop-workbench-2026-10-27/`（仅 md/json/png/log）。

**Interfaces:** 复用现有空会话 SSR 判据；不改变用量投影。

- [x] Step 1: 复现基线空检查器统计误显示与旧搜索文案断言（当前全套 2 failed / 1482 passed）。
- [x] Step 2: 空活动不展示六格统计；搜索测试对齐已存在的会话筛选入口语义，并继续断言其不冒称命令面板快捷键。
- [x] Step 3: 桌面全套、build、root typecheck、renderer-layer-check、desktop-boundary-check、docs-check、diff 检查。
- [x] Step 4: OCR delegate 只选文件和解析规则，由独立 reviewer 只读检查本轮 diff；处理有证据的问题。
- [x] Step 5: 保存本轮截图、检查结果与研究判断；注明 renderer 合成 API 与生产/模型未验边界，不宣称行业顶尖已达成。

## Execution ledger

- Ruling: 在用户已确认的当前 checkout 原地完成，避免新 worktree 丢失本轮界面依赖的已有未提交工作；不创建分支、不提交混合修改。
- Pre-flight: Task 2 仅处理基线已有的空态与测试契约问题，不改变 Task 1 的面板接口。
- Ruling: 顶部入口复用幂等 `openPane(kind)`，以本地 `paneTarget {kind,seq}` 明确切换已挂载的窗格；保留原快捷键的 toggle 语义，避免后台窗格被误关。
- Review: 独立只读 reviewer 指出工具菜单未限高；真实 880×300 复现 bottom=422、viewport=300。只对工作台菜单加 Radix 可用高度约束和纵向滚动，并补 End 聚焦末项断言。窄窗标题断言改为分别比较标题 / 改动 / 工具边界。

## Completion（2026-10-27 接手收尾）

- 接手点：限高规则已写入但未复跑；随后桌面套件 1 failed / 1486 passed，红在 `motion-gaps`。
- 根因：`ruleOf(".pop-rd")` 取第一处字符串命中，工作台规则插在基础 `.pop-rd` 之前 ⇒ 进场动画被判丢失。
- 修复：只移动规则顺序到基础 `.pop-rd` 之后；判据未放宽，限高/滚动保留。
- 读数：桌面 224 文件 / 1487 条全绿 + boundary 绿；隔离 smoke 23/23；根 typecheck 0；
  renderer-layer 133 文件绿；build 绿（`assets/index-CQBUFc9Z.css`）。docs-check 在 10:22 绿；
  10:23 他笔第 719 页点名未入库的 interop 取料后转 D-11 红，归属他笔。
- 证据：`outputs/desktop-workbench-2026-10-27/`（REPORT.md、checks.json、5 张截图）。
- 未验：合成 AgentApi/隐藏窗口、单一低高度样本、Task 1 Step 2 的旧构建 FAIL 基线未保留；
  全量 core 与业主应用重开不在本笔。工作树未提交，保留其他会话在飞改动。
