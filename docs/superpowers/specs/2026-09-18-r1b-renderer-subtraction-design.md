# R1b 渲染层减法 · 设计（spec）

日期：2026-09-18 · 分支：`codex/r1b-renderer-subtraction` · 前置：R1a `d063003`
作者口径：本文件是**施工清单**，不是第四份设计愿景。目标只有一个字：减。

## 0. 问题（实测，非推断）

同一个会话，跑的时候好看，重开变桩。根因是渲染层有**两套渲染器**：

- live：`app.js renderEvent(e)` — 11 个 case，带路径摘要、diff 着色、失败自动展开、执行组计数
- replay：`history-window.js projectHistory(events)` + `app.js renderHistoryRow(row)` — 只认 7 类事件，
  其余一律折叠成 `{kind:'record', text: e.type}`，渲染为「事件名 + ▶ 查看记录」

真机截图实证（`.tmp/ui-diag-2026-09-18/shots/01、05`）：36 事件的会话重开后，流内连续 10 行清一色「查看记录」。

## 1. 基线可判定量（改前，来自 `.tmp/ui-diag-2026-09-18/hook-census.mjs`）

| 量 | 现值 | 目标 |
|---|---|---|
| 渲染器份数 | 2 | **1** |
| 两条路都无渲染器的事件类型 | 15 / 26 | 不变（R2 处理），但**单一落点** |
| 空态机制 | 2（`.settings-empty` + R1a 新造的 `panelEmptyHTML`） | **1** |
| 折叠机制 | 4（`data-tool-toggle` / `data-card-toggle` / `classList.toggle('collapsed')` / `createElement('details')`） | **2** |
| `history-window.js` 行数 | 115 | 净减（删类型分类与文本携带） |
| `app.js` 行数 | 2621 | 净减（删 `renderHistoryRow` 桩） |
| 门禁引用钩子 | 24 条（22 活 + 2 负向） | **22/22 逐条仍可命中** |

测量脚本：`.tmp/ui-diag-2026-09-18/hook-census.mjs`（只读）。两条已知局限，引用本表时须知：
① SVG 计数原先只匹配 `<svg viewBox="0 0 24 24` 前缀，会漏计（已按 `<svg viewBox>` 全量重测为 106）；
② 「37 个无引用 id」是**上界，不是可删数**——普查脚本只把 `aria-labelledby` 计入引用，
漏了 `aria-describedby`（实测 `gutterHintL` 即被 `index.html:1498` 的 `aria-describedby` 引用，属活锚点）。
抽样复核：`tsFill` / `think-block-1` / `riskCard` / `runStatusLive` 四者全仓零引用，是**真死标记**；
其中 `#runStatusLive` 是「运行状态」live region 却无人写——归 R2（运行态呈现未接线），不在本轮。

## 2. 红线：钩子白名单（本轮不得断任何一条的生产者）

`#eventCount` `#settingsOpen` `#settingsOverlay` `#drawer` `#drawerToggle` `#qcGit`
`.composer` `.stream` `.stream-inner` `.stream-inner > .msg[data-history]`
`aside.drawer` `.drawer` `main.chat` `.chat` `body` `[id]` `img` `img[alt]`
`[aria-pressed], [aria-expanded]` `[data-tool-toggle]` `[data-msg-act]`

负向探针（必须保持 0 命中，不得"顺手补上"）：`data-m1e-*` / `data-approval-badge` / `data-virtuoso-scroller`。

## 3. B1 — 删重放桩路径（核心）

### 3.1 先定形：unit 节点 = 一条 `.msg`，工具组是其内部结构

两路今天**结构本来就不同**，不先定形则「live/replay 一致」无从谈起：

- live：`.toolgroup` 挂进上一条 `.msg.ai` 的 `.msg-body`（`app.js lastAiHost` + `ensureToolGroup`）
- replay：每个工具行是一条**独立** `.msg`（`renderHistoryRow`）

**取 live 形**：unit 的外层恒为 `.msg`，工具组作为 unit 内部的 `.toolgroup`。理由：① 保住白名单
`.stream-inner > .msg[data-history]` 与 `renderer-arch-check` 的「`.stream-inner` 直接子元素全是 `.msg`」；
② replay 行数净减（10 个工具行 → 1 条消息），本身即减法。

### 3.2 分组规则必须先按 `agent_id` 分桶（否则不成立）

worker 的 `runLoop` 事件经 `orchestrator.ts:1899 workerPipeline` 落**主会话日志**并带 `agent_id`，
即子流事件会插在主流事件之间。故 unit 边界 = **连续 + 同 `agent_id` + 同类可并**，三者缺一即切断新组：

```
unitKey(e) = (e.agent_id ?? "main") + 分组类别
分组类别：user | ai(assistant_message/assistant_delta 段) | tools(连续 tool_call/tool_result/verify_result) | card(其余单事件)
```

顺带修掉一个既有归因缺陷：`renderEvent` 从不读 `agent_id`，worker 的 tool_call 在 live 时被并进
主 loop 工具组显示。按 unitKey 分组后 worker 自成 unit，归因自然正确。

孤儿 `tool_result`（无配对 call）自成一 unit，不丢事件。

### 3.3 接口

```js
// history-window.js —— 只做分组与窗口，不再认识事件语义
export function projectUnits(events) → { units: {key, from, to}[] }
export function mountHistory({ container, scroller, units, renderUnit })   // 窗口/测高/落定算法原样保留

// app.js —— 唯一渲染实现，live 与 replay 共用
function buildUnit(unit, { replay }) → HTMLElement   // 外层恒为 .msg；replay 时带 data-history
function renderEvent(e)                              // live：定位/新建当前 unit，复用同一批子构建器
```

共享子构建器（唯一实现，live/replay 同调）：`userNode` `aiNode` `toolItem(call,result)` `toolGroup(items)`
`planCard` `verifyItem` `compactionCard`。

**replay 模式禁副作用**（沿用 `tests/renderer-history-live.test.ts` 已锁的不变量）：
不得 `scrollStream` / `toast` / `askCard` / `setInterval` / 调 `api.*` / 写 `real.cards`；
折叠按钮监听可挂（纯本地态）。`real.events` 语义不变（live 投递计数），底栏仍走 `displayedEventCount()`。

**否决的替代方案**：
- 只补齐 replay 的 case 表 → 渲染器仍 2 份，不是减法；
- replay 全量重放再裁 DOM → 破坏 panels-check「10000 事件 DOM ≤ 300」断言；
- 取 replay 形（工具行各自成 `.msg`）→ live 需把工具组从 ai 消息里拆出来，视觉倒退且动白名单钩子的语义。

## 4. B2 — 空态机制 2→1

删 R1a 引入的 `panelEmptyHTML()`（5 处调用），统一改渲染既有的 `.settings-empty` 结构
（`index.html` 3 处 + `app.js` 3 处在用）。这是还 R1a 自己欠的重复债。

## 5. B3 — 折叠机制 4→2

- `createElement('details')` 那份随 B1 的 `renderHistoryRow` 一并删除；
- `data-card-toggle` 与 `data-tool-toggle` 合并为**一个**处理器与**一个**属性名，
  属性名保留 `data-tool-toggle`（门禁断言 `[data-tool-toggle] ≥ 1`，改名即断链）；
- 形态不变：仍是 `button + hidden`。**不引入 `<details>`/`<dialog>`/`popover`**——换原生件属"定形态"，
  按用户 2026-09-18 约束本轮不做，只出清单（见 §8）。

## 6. 测试与验收（TDD 顺序）

1. 先加断言（红）：`tests/renderer-history-live.test.ts` 增「同一事件流，live 与 replay 对每个 unit 产出的
   节点签名一致」——签名定义为 `tagName + '.' + classList[0] + (有 details?'/d':'') + (有 .toolgroup?'/g':'')`
   的有序序列，两路必须逐项相等；
   新增 `tests/renderer-collapse-single.test.ts` 断言 `data-card-toggle` 在 `app.js` 零命中、折叠处理器唯一；
   `panelEmptyHTML` 零命中。
2. 白名单守卫：把 §2 的 22 条钩子写成一条测试断言（源文件级 + 运行时级各一），改前改后都必须 22/22。
3. 重命名连带面（**同提交内改完，否则 HEAD 悬空**）：`projectHistory` → `projectUnits`、
   `renderRow` → `renderUnit` 波及 `tests/history-window.test.ts`、`tests/renderer-history-live.test.ts`
   与 `src/renderer/app.js` 调用点，一处不落。
4. worktree 内验：`tsc --noEmit`、`electron-vite build`、`renderer-arch-check`、`a11y-check`、`panels-check`、
   非 `run_shell` 测试子集（`tests/renderer-*`、`tests/history-window`、`tests/panel-data`、`tests/projections`）。
5. 真机复验：同一探针重跑截图，比对「查看记录」行数归零、流内出现语义卡。
6. 合回主树后以 `pnpm gates` 为唯一收口凭据（fresh worktree 对 `run_shell` 类断言必假红，已实测）。

## 7. 回滚

B1/B2/B3 各自独立提交（同分支内三笔），任一笔红即可单独 revert；B1 未合回前主树零影响。

## 8. 出清单不动手（本轮明确不做）

| 项 | 实测规模 | 为何不做 |
|---|---|---|
| 设置弹窗/风险遮罩换 `<dialog>` | `<dialog>`=0、`popover`=0，两处手写 overlay | 属定形态；且 `#settingsOverlay` 在白名单内 |
| 内联 SVG 收 sprite | `<svg viewBox>` 共 **106 处**（app.js 47 + index.html 59）。但 app.js 侧集中在 `ICONS` / `TOOL_ICONS` / `MSG_ICONS` 表里（定义后复用），**真重复面 = `index.html` 静态标记 59 份与 JS 表各写一份** | 收益大但改动面铺满全渲染层，且要先决定 sprite 形态，需单独立项 |
| 孤儿 id 清理 | 101 个 id 中 **37 个疑似无引用（上界）**，抽样确认真死 4 个（`tsFill`/`think-block-1`/`riskCard`/`runStatusLive`） | 需逐个甄别（`aria-describedby` 类是活锚点），误删即污染判据；`#runStatusLive` 属运行态未接线，归 R2 |
| `WORKSPACES` / `BRANCHES` 真化 | 仍驱动工作区切换器与分支面板 | R2 范围，需连 IPC |
| 15 个零渲染器事件类型补卡 | 见 §0 | R2 范围；B1 正是为它建单一落点 |

## 9. 并发约束（本分支施工期间）

只在 `.worktrees/r1b` 内改与提交；`git add` 一律显式文件路径；**不碰 `BLOCKED.md` / `PROGRESS.md`**
（并发会话的进度日志）；每次暂存前重跑 `git status --short`。

按协调规则 3（渲染层排队：小面 bug 修复先落库，结构减法随后 **rebase 到新 HEAD 再动**）：
本分支每笔开工前先 `git rebase <主树 HEAD>`。开工时实测 surface 归属：
`git log d063003..HEAD -- src/renderer/` 为空 ⇒ R1a 后无人写渲染层，surface 归本会话；
主树在飞仅未跟踪文档，无源码纠缠。`panels-check` 等 Electron 类门禁**串行跑**，起门前置 `pgrep -f vitest`。
