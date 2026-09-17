# 侦察简报 · Forge 前端重构（2026-09-17）

> **全团共享事实基线。** 所有陈述均为实测（读源码 + git 状态 + 门禁脚本），行号可复核。
> 本文件由主理人产出，供 5 位成员共同引用。**成员不得凭印象推翻本文件的事实，但欢迎用新证据修正。**

---

## 0. 本轮任务与用户已裁决的四项

用户原话：「优化设计我们的前端，围绕现有代码结构梳理需要改进的部分，明确优化目标，给出具体的重构与设计方案，并说明预期的改动范围和验证方式。」

| # | 岔路口 | 用户裁决 |
|---|---|---|
| D1 | 渲染层归属 | **收口到 vanilla**（React 树归档；panels-check 探针改指 vanilla 真实钩子；React 独有面板能力按需移植） |
| D2 | 优化目标 | **四项全要**：可维护性与组件复用 / 响应式布局 / 视觉一致性与可访问性 / 运行时性能 |
| D3 | 交付形态 | **方案报告 + 设计规范**（**本轮不改 `src/` 下任何代码**） |
| D4 | 改动范围 | **存量重构 + 补齐结构性缺口**（含 09-15 诊断的三处缺口：任务执行视图 / 全局状态底栏 / run 批次历史） |

---

## 1. 仓库与迁移状态（最关键的事实）

- **HEAD = `5e8a10b`**（分支 `codex/dsh-structural-hardening`），**已入库的是 React 版**。
- **工作区跑的是 vanilla 版，且未提交**：

```
 M src/renderer/index.html      ← 17 行（React 版）→ 1866 行（vanilla 版）
 D src/renderer/main.tsx        ← 已删除
 D src/renderer/styles.css      ← 已删除
 D src/renderer/error-boundary.tsx ← 已删除
?? src/renderer/app.js          ← 新增，2281 行，未跟踪
?? src/renderer/window.d.ts
```

**推论**：`docs/` 下的验收截图（`m1e-*.png` / `m3a-agents` / `m4a-schedule` / `m4b-onboard`）拍的是 React 版；`outputs/ui-design-proposal-2026-09-14.md` 与 `ui-design-v2-codex-style-2026-09-14.md` 两份历史提案也按 React 版描述现状 → **持续误导源**。

---

## 2. 现行渲染层实测结构

### 2.1 文件与规模

| 文件 | 行数 | 性质 |
|---|---|---|
| `src/renderer/index.html` | **1866** | 内联 `<style>`（令牌 + 全套 CSS，约 9–1350 行）+ 静态 DOM 骨架（约 1350–1866）+ `<script type="module" src="/app.js">` |
| `src/renderer/app.js` | **2281** | vanilla JS，模板字符串渲染 |

合计 **4147 行**，**无模块边界**（`app.js` 无任何 `import`）。

### 2.2 `app.js` 内部分段（实测）

**前半 = 原型（跑硬编码 mock）**，`1–1659` 行：

| 段 | 起始行 |
|---|---|
| 图标 `ICONS` | 2 |
| 会话数据（`FOLDERS` / `sessions` / `archived` / `selectedId` 硬编码） | 26 |
| 工具（`$` / `esc` / `toast`） | 54 |
| 会话列表渲染 | 111 |
| 会话操作 | 211 |
| 重命名 | 307 |
| 设置面板 | 476 |
| 主题（唯一入口在设置→外观） | 558 |
| 分隔条拖动 / 键盘调整 | 577 |
| 右侧工作区侧栏：多标签 | 657 |
| 发送模拟 | 881 |
| 消息滚动入场动效 | 899 |
| 消息操作行 | 915 |
| 上下文芯片 | 1139 |
| 权限看板 + 「全部放行」二次确认 | 1285 |
| 工作树看板 | 1402 |
| 模型选择面板 | 1433 |
| 思考过程折叠（委托） | 1593 |
| 卡片折叠（委托） | 1602 |

**后半 = 真实数据桥接 IIFE**，`1660–2281` 行（**追加式补丁，非重构**）：

| 段 | 起始行 |
|---|---|
| 头部注释（`window.agent` 存在时启用，「主 UI 以原型为准」） | 1660 |
| 会话列表 | 1672 |
| 消息流构造（复用原型 DOM 契约） | 1695 |
| 工具 / 卡片 | 1756 |
| 工具调用组（两级折叠） | 1767 |
| 事件渲染 | 1853 |
| 事件订阅 | 2175 |
| 行为覆写：发送 / 会话切换 / 新建 / 删除 / 归档 | 2180 |
| 启动 | 2277 |

> ⚠️ **核心结构问题**：桥接层**不拥有状态**，而是覆写原型层的函数并共享其模块级变量（`sessions` / `selectedId` / `archived`…）。两半是**隐式耦合**，任何一侧改动都可能静默破坏另一侧。

### 2.3 IPC 桥接面（实测）

- `src/preload/index.ts`（85 行）：`contextBridge.exposeInMainWorld("agent", api)`，`AgentApi` **约 30 个方法**（run / decide / submitClarify / decidePlan / runCancel / compact / onEvent / onAsk / onAskDone / getState / getProviderInfo / getSettings / setSettings / listSessions / createSession / openSession / renameSession / deleteSession / deleteMemory / pluginDecide / sidechat×4 / cardAction / schedule×4 / providerKey×3 / checkUpdate / openExternal）。
- `app.js` 中 `window.agent` **仅在 1660 行之后的桥接 IIFE 内出现**；`window.innerWidth/innerHeight` 各 4/2 次，`window.matchMedia` 2 次。
- **结论**：约 30 个 IPC 通道中，vanilla 层实际接线的只是一部分（会话列表 / 事件流 / ask 卡 / 发送 / 会话 CRUD / 归档）；**记忆、插件、sidechat、schedule、worktree、provider key、license/更新 等面板在 vanilla 层不存在**。

---

## 3. 已失去入口的 React 树（本轮 D1 的处置对象）

| 资产 | 规模 | 现状 |
|---|---|---|
| `src/renderer/components/ui/*` | **29 个文件**（sidebar 700 / field 238 / attachment 204 / select 189 / dialog 166 / sheet 145 / message-scroller 131 / bubble 124 / table 113 / empty 103 / card 102 / message 91 / tabs 89 / marker 68 / button 66 / tooltip 56 / scroll-area 52 / badge 48 / resizable 47 / radio-group 41 / collapsible 33 / checkbox 32 / progress 28 / separator 27 / label 23 / input 18 / textarea 17 / skeleton 13 / spinner 10） | shadcn(radix-nova)，**无运行时引用** |
| `src/renderer/panels/registry.tsx` | **1281** | 8 类面板（approvals/token/git/memory/plugins/sidechat/agents/schedule），**无运行时引用** |
| `src/renderer/projections.ts` | **591** | 事件→卡片投影，**被单测 + panels-check 引用** |
| `src/renderer/cards/*` | 8 个文件（registry 219 / clarify-form 115 / plan 96 / agent-card 88 / compaction 77 / verify-result 55 / promote 54 …） | 10 类卡片，**无运行时引用** |
| `src/renderer/store.ts` | 141 | reducer / foldEvent，**被单测引用** |
| `src/renderer/onboarding.tsx` | 307 | §13 七组引导，**被单测引用** |
| `src/renderer/conversation.tsx` | 91 | 断链（09-15 已确证） |
| `src/renderer/theme.ts` | 43 | `applyScheme` / `watchSystemTheme`，**被单测引用** |

> **注意**：`components/ui/*` 里含**vanilla 层没有的能力**（`message-scroller` 虚拟化、`resizable`、`table`、`progress`、`radio-group`、`checkbox`、`field`、`attachment`、`empty`、`skeleton`）。D1 收口时必须逐项判定：**移植 / 用 vanilla 等价物替代 / 明确放弃**——不能静默丢弃。

---

## 4. 🔴 门禁阻断项（实测复核，与 09-15 结论一致）

`scripts/panels-check.ts` B 相 7 个 CDP 探针指向 **React 版 DOM**，在现行 vanilla 层**命中数全部为 0**：

| 探针 | panels-check 行号 | vanilla 层命中 | 替代目标（建议） |
|---|---|---|---|
| `[data-m1e-event-count]` | 251 | **0** | 侧栏事件计数元素（需新增或复用现有） |
| `[data-m1e-item]` | 257 / 260 / 271 | **0** | `.msg`（vanilla 消息节点） |
| `[data-virtuoso-scroller]` | 264 / 265 / 269 | **0** | `.stream` 或 `.session-scroll` |
| `[data-approval-badge]` | 278 | **0** | `.card.ask[data-ask]`（live 层唯一审批钩子）/ 新增 `.approval-dot` |
| `[data-panel-toggle=git]` | 286 | **0** | `[data-view=git]` |
| `[data-m1e-settings-open]` | 299 | **0** | `#settingsOpen` |
| `[data-panel-id=git]` | 327 | **0** | `[data-view=git]` 的打开态 |

**额外的深耦合（⚠️ 本节初版低估，已由 Phase 3 复核修正）**：`projections.ts` 不是「只被 panels-check 引用」，实测被 **3 个门禁脚本**（`panels-check.ts` / `agents-check.ts` / `sidechat-check.ts`）+ **4 个测试文件**（`tests/panels.test.ts` / `m3b.test.ts` / `agents.test.ts` / `sidechat.test.ts`）+ 4 个 React 层文件（`store.ts` / `panels/registry.tsx` / `cards/registry.tsx` / `cards/agent-card.tsx`）引用。

→ **推论（修正 D1 的处置方式）**：`projections.ts` **不能随 React 树一起归档**，而应**升格为共享投影层**（vanilla 渲染层与门禁/测试共同消费的纯函数模块）。这不是「解除依赖」，而是「**把依赖对象扶正**」。见 `03-refactor-design.md`。

**纪律（铁律，不得违反）**：
- **严禁为迎合探针而伪造 `data-m1e-*` 钩子**——那是制造假绿，比红门更糟。
- 判卷标准（grep / 断言 / 验收脚本）是冻结的。发现判据有缺陷 → 写 `BLOCKED.md`，**不许改代码去绕**。

---

## 5. 冻结钩子清单（实测复核，**零重命名**）

09-15 的 `02-design-system.md` §D.2 列了 32 个 live 层钩子。本轮**逐条复核**（`grep -o` 计数，`index.html` + `app.js` 合计）：

| 钩子 | 命中 | 钩子 | 命中 | 钩子 | 命中 |
|---|---|---|---|---|---|
| `data-theme` | 2 | `data-grp` | 4 | `data-desc` | 3 |
| `data-od-id` | 27 | `data-val` | 13 | `data-term` | 1 |
| `data-drawer` | 4 | `data-switch` | 7 | `data-branch` | 1 |
| `data-panel` | 2 | `data-set-theme` | 4 | `data-ws` | 2 |
| `data-view` | 7 | `data-reduce-motion` | 2 | `data-perm` | 1 |
| `data-close` | 3 | `data-model` | 3 | `data-ask` | 1 |
| `data-card-toggle` | 5 | `data-live` | 5 | `data-card` | 7 |
| `data-doc` | 1 | `data-stream` | 3 | `data-msg-act` | 8 |
| `data-label` | 7 | `data-empty` | 2 | `data-act` | 9 |
| `data-id` | 2 | `data-folder` | 1 | `data-sec` | 10 |

**两处需注意**（实测）：
- `data-archived` / `data-tokenized` 在源码里以 **`dataset.archived`（`app.js:419/465`）/ `dataset.tokenized`（`app.js:105/107`）** 形式访问，字面量 grep 为 0 属正常。
- ⚠️ **发现的真实缺陷**：`sessionItemHTML`（`app.js:122-166`）**从不输出 `data-archived`**，`renderArchive`（`app.js:489-496`）输出的是 `.arch-row[data-id]`。→ `if (item && !item.dataset.archived)` 这个守卫**恒为真，是死代码**（`app.js:419`、`app.js:465` 两处）。归档区与活跃列表的点击路径没有被这道守卫分开。

---

## 6. 已具备的资产（**不得回退**）

| 项 | 实测 |
|---|---|
| 设计令牌 | `index.html:15-94`，oklch 双主题（`:root` + `html[data-theme="dark"]`），含布局尺寸 / 表面层级 / 文字三级 / 钢蓝 accent / diff token 调色板 / 阴影 / 动效缓动与时长档位（`--ease-*` / `--t-*`） |
| 无障碍 | **13 处** `@media (prefers-reduced-motion: reduce)` 降级块；**298 个** `aria-*`；**30 个** `role=`；`:focus-visible` 全局焦点环；`.sr-only`；`role="status"` toast；`aria-modal` 风险确认 |
| 主题机制 | 跟随系统 + 设置内手动切换；`html.reduce-motion` 全局降级 |
| 渲染纪律 | 37 处 `innerHTML` / 1 处 `insertAdjacentHTML`；`esc()` 转义存在；`data-tokenized` 幂等标记 |
| 判卷纪律 | `fixtures/todo-app/tests/**` 与 `fixtures/mock/**` sha256 冻结在 `scripts/frozen-sha256.json` |

---

## 7. 缺口清单（本轮要解决的）

### 7.1 响应式（实测）

- **仅 1 个宽度断点**：`@media (max-width:920px)`（`index.html:1354`）。1280–1599 / 1024–1279 **零适配**。
- 其余 13 个 `@media` 全是 `prefers-reduced-motion` / `hover`。
- **主窗口未设 `minWidth` / `minHeight`**（`src/main/index.ts` 无匹配）→ 拖到极小尺寸布局碎裂。

### 7.2 视觉一致性

- **四态语义色未落地**：`--st-run / --st-wait / --st-stuck / --st-fail` 在 `index.html` 命中 **0**。
- **底栏状态栏未落地**：`statusbar` 命中 **0**。
- 09-15 审查已确证两个真实缺陷（当时只在原型里修了，**源码未修**）：①「被拒」误用「卡死」的琥珀色；②「已中断」与「等待」渲染完全相同（都是灰空心点，仅文字不同）。
- 状态判定现在**靠文字**（如 `2/4 已完成`），无图形编码 → 违反「删色可辨」。

### 7.3 组件复用

- 卡片全部由 `app.js` 内**模板字符串**产出，**无统一骨架**、无注册表（对比 React 树有 `cards/registry.tsx` + `KNOWN_CARD_TYPES` 10 类）。
- shadcn/ui 29 个组件 + Tailwind 4 + `components.json` 均**已配置但发货层未用**。

### 7.4 性能（待测，需成员给出实测口径）

- 长会话渲染策略**未知**（React 树有 `react-virtuoso` + `message-scroller`；vanilla 层是 37 处 `innerHTML` 全量重写）。
- `panels-check` B1 原本的验收口径是「1 万条事件 → DOM ≤ 300 节点 + 滚动一屏 ≤ 200ms」，**当前探针死了，这条口径等于无人守**。
- `addEventListener` 80 处，事件委托与直接绑定混用。

### 7.5 可访问性门禁

- 资产好（见 §6），但**无自动化 a11y 门禁**——全靠人工目检，回归无保障。

### 7.6 结构性缺口（09-15 诊断的三处，D4 已确认要补）

1. **无独立「任务执行」视图**——编排压在 340px 右抽屉里与 8 个视图争宽。
2. **运行状态在视线边缘**——沙箱 / 事件数 / tokens 放在侧栏底部。
3. **历史只有「会话」一个维度**——缺 run 批次回溯与检索。
   > ⚠️ 依赖内核 run 聚合字段；若 IPC 未暴露，**只能结构占位**，需单列接口任务。

---

## 8. 工程约定（成员必须遵守）

- **`TERM=dumb`**：跑验收一律用 `TERM=dumb`，否则 vitest 输出 ANSI 序列导致摘要正则假红。
- **不改 `src/`**：本轮 D3 已定，**交付物只有文档**。任何「顺手改一下」都是越界。
- **门禁清单即事实源**：`scripts/gate-manifest.ts`。当前 26 道；⚠️ **未证 9 项如实标注，未证 ≠ 通过，不得宣称全绿**。
- **沙箱内跑不了 `pnpm test`**；用 `node node_modules/vitest/vitest.mjs run --pool=threads`。
- **`oh-src/`、`.tmp/`、`.mimosa/` 是历史快照**，不参与判断。
- **本简报是事实源**：成员引用事实请标注「见简报 §X」，新发现请标明「实测」并给行号。

---

## 9. 交付物与写入位置

全部写入 `outputs/frontend-refactor-2026-09-17/`：

| 文件 | 负责人 | 内容 |
|---|---|---|
| `00-recon-brief.md` | 主理人 | 本文件（已完成） |
| `01-requirements.md` | 需求发现分析师 | 需求摘要 + 可判定验收口径 |
| `02-design-system.md` | 设计系统专家 | 令牌 / 组件施工图 / 断点规格 / 映射表与钩子清单 |
| `03-refactor-design.md` | 原型构建师 | **目标架构与重构施工图**（分层 / 模块边界 / 组件注册表 / CSS 架构 / 性能策略 / a11y 门禁） |
| `04-critique.md` | 质量审查官 | 5 维评分 + Anti-Slop 门控 + 独立验证证据 |
| `export/` | 导出交付专家 | 交付包（索引 + 校验清单） |
| `05-master-plan.md` | 主理人 | 汇总总方案（诊断 + 目标 + 方案 + 改动范围 + 验证方式） |
