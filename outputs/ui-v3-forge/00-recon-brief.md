> **⚠️ 过时（2026-09-17 起）**：本文属上一轮设计（`ui-v3-forge`），其**色值 / 令牌名 / 尺寸 / 行号 / 函数名**多数已漂移。
> **已被推翻结论的逐条清单见 `outputs/frontend-refactor-2026-09-17/02-design-system.md` §0.2**（15 条）。
> 当前权威规范 = 该包（`00`–`06`）；本文**为存档保留**、正文未改写，**不可直接施工**。

# Forge 桌面端 · 现状侦察简报（主理人整理，供全团共享）

> 目的：给需求发现 / 设计系统 / 原型构建 / 质量审查 / 导出 五个环节提供**同一份事实基线**，避免各环节基于过期假设工作。
> 结论口径：以下全部为**实测**（读源码 + 构建产物 + 门禁脚本 + 截图），不是推测。

## 0. 用户已确认的三个前提（本轮设计的边界）

| 维度 | 用户选择 |
|---|---|
| 设计方向 | **在现有界面上结构化优化**（保留信息架构与交互资产，增量落地，不推翻） |
| 视觉调性 | **延续现有中性灰阶工程感**（oklch 灰阶 + Geist + 单一强调色，克制耐看） |
| 交付形态 | ① 可交互 HTML 高保真原型 ② 现状诊断 + 优化方案报告 ③ 设计系统规范文档 |

## 1. 项目定位

`/Users/ze/Downloads/deepseek harness` —— Electron 桌面编程 Agent（代号 **Forge**，窗口标题 `Forge · 编程智能体`）。
内核已完成 M0–M6：agent loop / 事件流 / 工具 / 权限门 / Seatbelt 沙箱 / 会话内核 / 压缩 / 记忆 / 插件 / MCP / 旁聊 / 编排（spawn_agent / worktree / 依赖链 / 卡死恢复）/ 定时任务 / 授权 / 模型路由 / Supervisor。
技术栈：Node 22 / TS 5 / electron-vite 5 / Electron 44 / Tailwind 4 + shadcn(radix-nova) / vitest 5。门禁 `pnpm gates` 26 道。

## 2. 渲染层的真实形态（本轮最关键的事实）

**存在两套 UI 代码，实际发货的只有一套。**

| | 发货中（live） | 未接线（dead） |
|---|---|---|
| 文件 | `src/renderer/index.html`（1670 行，内联 `<style>` 全套令牌 + 静态骨架）+ `src/renderer/app.js`（2034 行原生 JS，字符串模板渲染） | `src/renderer/conversation.tsx`、`panels/registry.tsx`（1281 行）、`cards/*.tsx`（10 类卡片）、`components/ui/*`（29 个 shadcn 组件）、`projections.ts`、`store.ts`、`theme.ts` 的部分 |
| 证据 | `index.html` 末尾唯一入口 `<script type="module" src="/app.js">`；构建产物 `out/renderer/assets/index-DMvEZTlA.js` 中 `react` 出现 **0** 次，开头即 `//#region src/renderer/app.js` | 全仓 `import ... from "react"` 只命中 `tests/*.test.ts`（cards/panels/sidechat/onboarding）与 `oh-src/`（外部参考仓） |
| 被谁验证 | `scripts/panels-check.ts` 用 CDP 探针驱动 `[data-m1e-item]` / `[data-panel-toggle=git]` / `[data-m1e-settings-open]` 等 **vanilla DOM 属性** | 仅单测覆盖（`tests/cards.test.ts`、`tests/panels.test.ts`） |

**由此推出两条约束**：
1. 任何设计方案的落地对象是 **`index.html` 的内联 CSS + `app.js` 的模板字符串**，不是 shadcn/React 组件树。
2. 现有两份 UI 提案（`outputs/ui-design-proposal-2026-09-14.md`、`outputs/ui-design-v2-codex-style-2026-09-14.md`）**按 React 版写**（引用 `main.tsx:1211-1441`、shadcn 组件、react-virtuoso、`cards/registry.tsx:201-212`），与实际发货错位，**不能直接落地**——这是本轮要先修正的偏差。

## 3. 现网布局骨架（实测尺寸）

```
┌──────────────────────────────────────────────────────────────┐
│ titlebar 44px   [traffic]  ───────spacer──────  [右板开关]      │
├──────────┬─┬────────────────────────────┬─┬──────────────────┤
│ sidebar  │g│  chat（stream + composer）  │g│  drawer          │
│ 264px    │u│                            │u│  340px           │
│ 180–420  │t│  --center-w 由三列推导      │t│  240–640         │
│ 可拖     │9│                            │9│  可拖 / 可收起    │
└──────────┴─┴────────────────────────────┴─┴──────────────────┘
```

- 侧栏：新建对话 + 搜索框 → 会话列表（分组 today/yesterday/week/earlier，文件夹折叠）→ 底部「已归档」+ 用户卡（头像/名/方案/设置入口）。
- 中栏：`stream`（用户气泡 / 助手 think 折叠块 / plan 卡 / diff 卡 / 工具行）+ `composer`（输入 + 发送）。
- 右抽屉：`sideTabs` 多标签（approvals / token / git / memory / plugins / agents / schedule / files / browser / review / terminal），`data-panel="drawer"`。
- 浮层：设置 Dialog（5 段：通用/模型/外观/归档/关于）、`risk-scrim` 风险确认（含「我已了解上述风险」勾选 + 二次确认）、toast。

## 4. 三大诉求的现状盘点（用户点名的模块）

### 4.1 对话交互 —— 底子好，缺"长对话的可控感"
已有：用户/助手气泡、think 折叠块（含耗时）、plan 卡（`2/4 已完成` 步骤态）、diff 卡（token 着色）、消息级操作（复制/撤回）、上下文弹层 `ctx-pop`。
缺口：
- 流式期间**无排队发送 / 中断恢复**的可见反馈；
- 长对话**无消息级导航**（回到底部、跳转到某轮、按卡片类型过滤）；
- 思考块与卡片**状态语义靠文字**（`2/4 已完成`），无进度可视化。

### 4.2 任务执行与状态展示 —— 最大的结构性缺口
已有：`agents` 面板（worker 卡列 + 依赖链简图 + 合并控制塔）、`schedule` 面板（三态表单/列表/历史）、审批卡与 `data-approval-badge`。
缺口：
- **运行状态被放在侧栏底部**（沙箱/事件数/tokens，见 `docs/m0c-ui-light.png`），处于视线边缘；运行中无全局进度/阶段指示；
- **无独立「任务执行」视图**：编排（pipeline 依赖链、worker 状态、卡死/崩溃恢复）被压在 340px 右抽屉的一格标签里，与 8 个面板争宽；
- 审批到达的全局提示弱（仅 `data-approval-badge`），无 Dock badge / 顶栏状态点。

### 4.3 历史记录管理 —— 只有"会话维度"
已有（`app.js` 实测函数）：`pinSession` / `archiveSession` / `unarchiveSession` / `deleteArchived` / `deleteSession` / `startRename` / `toggleFolder` + 分组 + 标题搜索。
缺口：
- 只有**会话标题搜索**，无正文/工具/文件级检索；
- **无运行批次（run）维度的历史**：一次任务的 worker 产出、verify 结果、diff 汇总无法回溯；
- 无按状态筛选（失败/被拒/被中断）、无时间轴视图。

## 5. 响应式与交互规范的实测缺口

| 项 | 现状 | 缺口 |
|---|---|---|
| 断点 | **仅 1 个** `@media (max-width:920px)`（侧栏/抽屉改浮层） | 无 1600/1280/1024 档；1280–1599 与 920–1279 之间无任何适配；三栏在窄窗被硬挤 |
| 窗口 | 未设 `minWidth/minHeight` | 拖到极小尺寸布局碎裂 |
| 缩放 | 无 | 4K 下字阶碎片化 |
| 快捷键 | **仅 4 条**：⌘⌥E 文件 / ⌘T 浏览器 / ⌘⇧G 审阅 / ⌘⇧J 终端（`app.js:869-877`）+ Esc | 无 ⌘K 命令面板、无 ⌘N/⌘1-9、无菜单栏（不可发现） |
| 状态色 | `--accent oklch(55% 0.18 255)` 单一功能蓝；语义色基本靠灰阶 | 运行/等待/卡死/失败四态无统一色纪律 |
| 无障碍 | **资产良好**：12 处 `prefers-reduced-motion`、`sr-only`、role/aria、focus 处理 | 保持，勿回退 |

## 6. 本轮设计的硬约束（请全团遵守）

1. **落地对象**：`src/renderer/index.html` 内联 CSS 令牌 + `app.js` 模板；方案必须可增量落地到 vanilla 层（若建议启用 React 版，需单列「接线成本与迁移路径」）。
2. **风格不动摇**：延续 oklch 中性灰阶 + Geist + 单一强调色；不引毛玻璃/渐变；新增语义色须给 dark/light 双主题值并满足 WCAG AA（正文 >7:1，次级 >4.5:1）。
3. **不破坏既有判据**：renderer 域改动须回归 `pnpm panels-check`（CDP 探针依赖 `data-*` 属性名）+ `pnpm gates`；**不得重命名现有 `data-*` 钩子**。
4. **既有无障碍资产不得回退**：`prefers-reduced-motion` 降级、`sr-only`、`aria-*`、最小点击区 28×28。
5. **不改判卷文件**：`fixtures/todo-app/tests/**`、`fixtures/mock/**` 的 sha256 已冻结。
