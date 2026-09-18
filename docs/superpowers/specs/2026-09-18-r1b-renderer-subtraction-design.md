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

## 2. 红线：钩子白名单（本轮不得断任何一条的生产者）

`#eventCount` `#settingsOpen` `#settingsOverlay` `#drawer` `#drawerToggle` `#qcGit`
`.composer` `.stream` `.stream-inner` `.stream-inner > .msg[data-history]`
`aside.drawer` `.drawer` `main.chat` `.chat` `body` `[id]` `img` `img[alt]`
`[aria-pressed], [aria-expanded]` `[data-tool-toggle]` `[data-msg-act]`

负向探针（必须保持 0 命中，不得"顺手补上"）：`data-m1e-*` / `data-approval-badge` / `data-virtuoso-scroller`。

## 3. B1 — 删重放桩路径（核心）

**接口**：行不再携带文本，只携带事件区间；渲染实现唯一。

```js
// history-window.js —— 只做分组与窗口，不再认识事件语义
export function projectUnits(events) → { units: {kind, from, to}[] }
export function mountHistory({ container, scroller, units, renderUnit })   // 窗口/测高/落定算法原样保留

// app.js —— 唯一渲染实现，live 与 replay 共用
function buildUnit(unit, { replay }) → HTMLElement   // 外层节点恒为 .msg；replay 时带 data-history
function renderEvent(e)                              // live：定位/新建当前 unit，复用同一批子构建器
```

共享子构建器（唯一实现，live/replay 同调）：`userNode` `aiNode` `toolItem(call,result)` `toolGroup(items)`
`planCard` `verifyItem` `compactionCard`。

**replay 模式禁副作用**（沿用 `tests/renderer-history-live.test.ts` 已锁的不变量）：
不得 `scrollStream` / `toast` / `askCard` / `setInterval` / 调 `api.*`；折叠按钮监听可挂（纯本地态）。
`real.events` 语义不变（live 投递计数），底栏仍走 `displayedEventCount()`。

**否决的替代方案**：
- 只补齐 replay 的 case 表 → 渲染器仍 2 份，不是减法；
- replay 全量重放再裁 DOM → 破坏 panels-check「10000 事件 DOM ≤ 300」断言。

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
| 内联 SVG 收 sprite | **73 份**（app.js 31 + index.html 42） | 收益大但改动面铺满全渲染层，需单独立项 |
| 孤儿 id 清理 | 101 个 id 中 **37 个无任何引用** | 需逐个甄别 aria/CSS 锚点，误删即污染判据 |
| `WORKSPACES` / `BRANCHES` 真化 | 仍驱动工作区切换器与分支面板 | R2 范围，需连 IPC |
| 15 个零渲染器事件类型补卡 | 见 §0 | R2 范围；B1 正是为它建单一落点 |

## 9. 并发约束（本分支施工期间）

只在 `.worktrees/r1b` 内改与提交；`git add` 一律显式文件路径；**不碰 `BLOCKED.md` / `PROGRESS.md`**
（并发会话的进度日志）；每次暂存前重跑 `git status --short`。
