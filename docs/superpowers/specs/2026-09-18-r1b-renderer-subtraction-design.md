# R1b 渲染层减法 · 设计（spec）

日期：2026-09-18 · 分支：`codex/r1b-renderer-subtraction` · 前置：R1a `d063003`
作者口径：本文件是**施工清单**，不是第四份设计愿景。目标只有一个字：减。

## 0. 问题（实测，非推断）

同一个会话，跑的时候好看，重开变桩。根因是渲染层有**两套渲染器**：

- live：`app.js renderEvent(e)` — 11 个 case，带路径摘要、diff 着色、失败自动展开、执行组计数
- replay：`history-window.js projectHistory(events)` + `app.js renderHistoryRow(row)` — 只认 7 类事件，
  其余一律折叠成 `{kind:'record', text: e.type}`，渲染为「事件名 + ▶ 查看记录」

真机截图实证（`.tmp/ui-diag-2026-09-18/shots/01、05`）：36 事件的会话重开后，流内连续 10 行清一色「查看记录」。

## 1. 基线与目标（**数字一律引用 `docs/ui-fact-baseline.md` 的 F 编号，本文件不抄数值**）

事实面 = `docs/ui-fact-baseline.md`（F1–F20，每条配可复跑命令）。本 spec 曾自抄一份基线，
其中两项已被该页复跑推翻（内联 SVG 口径、事件类型分母漏 `error`），故整表改为引用，防两处各自漂。

| 量（F 编号） | 现值口径 | R1b 目标 |
|---|---|---|
| **F1** 渲染器份数 | 2（`renderEvent` + `renderHistoryRow`） | **1** |
| **F3** live 与 replay 都无渲染器的类型 | 15 / 分母见 F2 | 本轮不变（R2 归零），但**单一落点** |
| **F4** 折叠机制 | 4（手写 3 + 原生 `<details>` 1） | **2** |
| **F5** 空态 | 2 套 / **3 标识符**（`CHAT_EMPTY_HTML` / `showEmptyStream` / `panelEmptyHTML`） | **1 套 / 1 标识符**（B2 范围比原估大一份——`panelEmptyHTML` 是我 R1a 自欠，另两套是既有的） |
| **F6** diff 着色 | 2 | 本轮不变（R2 一并看） |
| **F18** 行数 | `app.js` / `index.html` / `history-window.js` | 净减（删 `renderHistoryRow` 桩与 `projectHistory` 的文本携带） |
| 门禁引用钩子 | 22 条活 + 2 条负向（本 spec §2 白名单） | **22/22 逐条仍可命中** |

测量脚本：`.tmp/ui-diag-2026-09-18/hook-census.mjs`（只读，白名单来源）。两条已知局限：
① 它按 `<svg viewBox` 前缀匹配会漏计（F7 用 `<svg` 全量，以 F7 为准）；
② 它把 `aria-describedby` 漏算成"无引用"（F8 口径同此局限，故 37 是**上界不是可删数**——
实测 `gutterHintL` 即被 `index.html:1498` 的 `aria-describedby` 引用）。
真死标记抽样确认 4 个：`tsFill` / `think-block-1` / `riskCard` / `runStatusLive`；
其中 `#runStatusLive` 是「运行状态」live region 却无人写——归 R2，不在本轮。

## 1.1 条文依据（逐条标明管辖范围，防越权引用造新矛盾）

权威 = `agent-plan.md` §10.1 布局定稿（AGENTS.md 钦定唯一权威方案）。三轮旧设计文档
（`ui-v3-forge` / `frontend-refactor` / `desktop-optimize`）已于 T4 降为存档，
**其色值/令牌/尺寸不得再当依据**。

| 项 | 依据 | 是否条文直接辖 |
|---|---|---|
| R1a（已落库 `d063003`） | §10.1 第 4 条后半句「同一事件流的两个视图，不产生第二事实源」 | **是，直接适用**——抽屉挂演示常量即第二事实源 |
| B1 删重放桩 | §10.1 第 4 条**前半句**「对话流是全部卡片的默认宿主」：15 类事件（含 P0 的 `error`）在流里无宿主；叠加实测「live/replay 对同一事件流给出不同呈现」 | **部分**——条文管数据视图，live/replay 属同一视图的两个时刻，此处是**类推**，不是直接辖 |
| B2 空态 2→1 | 用户 2026-09-18 减法指令 + 可判定量（R1a 自欠的重复） | **否，无条文**——纯实现重复 |
| B3 折叠 4→2 | 同上（实测 4 份实现） | **否，无条文**——纯实现重复 |

⇒ 本 spec 不写「依据 §10.1 第 4 条」于 B1/B2/B3 的条目头上冒充条文辖内项；
把条文用在它真管的地方（R1a 与「卡片必须有宿主」），其余以**复跑实测数 + 用户指令**为据。

## 2. 红线：钩子白名单（本轮不得断任何一条的生产者）

`#eventCount` `#settingsOpen` `#settingsOverlay` `#drawer` `#drawerToggle` `#qcGit`
`.composer` `.stream` `.stream-inner` `.stream-inner > .msg[data-history]`
`aside.drawer` `.drawer` `main.chat` `.chat` `body` `[id]` `img` `img[alt]`
`[aria-pressed], [aria-expanded]` `[data-tool-toggle]` `[data-msg-act]`

负向探针（必须保持 0 命中，不得"顺手补上"）：`data-m1e-*` / `data-approval-badge` / `data-virtuoso-scroller`。

### 2.1 白名单的覆盖面边界（重要，越界使用会埋雷）

本白名单**只量渲染层 DOM 选择器**（`#id` / `.class` / `[data-*]`），来源是各 check 脚本里的
`querySelector*` / `getElementById` / `q()` 提取。**它不覆盖 preload 桥**（`window.agent.*` 调用面）。

⇒ 硬红线：**「不在白名单里」≠「删了安全」**。本轮不得以"该桥无人引用"为理由删除任何
`window.agent.*` 调用链；若必须动，**三段同删**（`preload/index.ts` 暴露 / `main/index.ts` handler /
`renderer` 调用点）——只删一段 = 在 `ipc:check` 与 `typecheck` 都看不见的地方留下运行时地雷
（删调用点不产生类型错误，也不减通道数）。

B1 自查记录（`git diff` 实测）：`api.decidePlan` 两行为**缩进位移**（移入 `else` 分支），
删除与新增成对出现，**净零删除桥调用** ✓。

### 2.2 等待期审计：P0 三条 vs 白名单（2026-09-18，只读）

P0 三条由并发会话落库（补停止键 / 失败可见性 / 滚动只在距底 100px 内跟随）。逐条对照结论：

| P0 项 | 撞不撞白名单 | 依据与红线 |
|---|---|---|
| 补停止键 | **不撞，但有硬余量** | `renderer-arch-check` 断言 `document.body` 直接子元素 **≤ 6（现值 5，只剩 1 个槽）**、`.composer` **恰好 1**、`aside.drawer` **恰好 1**。⇒ 停止键必须落在现有容器内（`.composer` / `.composer-foot` / `.ctx-rail`），新增 body 级节点即红。图标按钮需带 `aria-label`，且不得引入第 2 个 `[data-msg-act]` 语义之外的裸按钮（a11y 探针普查该属性） |
| 失败可见性 | **不撞白名单，撞在飞簇的落点** | 内核侧已在飞：`src/events/index.ts` 新增 `RunErrorEvent{type:"error"}` **且已注册进 `KNOWN_TYPES`**（实测集合含 `error` ⇒ 重放不会 `未知事件类型` 抛）。渲染侧 `app.js renderEvent` **零个 `case 'error'`** ⇒ live 什么都不显示、replay 显示「error + 查看记录」。⇒ 渲染半属于 `app.js` 写面，按排队规则由 P0 会话先落；R1b 后续只需在**单一落点**里保住它，不再补第二份 |
| 滚动只在距底 100px 内跟随 | **一处需盯，不是红线** | `panels-check` 对滚动只有两条：`moved` 每次位移 > 0 与序列净位移 > 0（**无任何「在底部」断言**，实测 `scrollHeight` 仅出现在 `sc.scrollTop = sc.scrollHeight / 2` 起点设置）。`scrollStream()` 现是无条件吸底（`app.js:932-938`），**15 处调用点**。风险不在门控本身，而在若新增 scroll 监听器回拉 `scrollTop`：`panels-check:304-306` 已注明「逐次单调会与窗口化测高锚点回修冲突（`draw` 把 scrollTop 微调回 correctedTop）」⇒ 净位移口径。⇒ 若 P0 用「监听 scroll 再写 scrollTop」实现跟随，B1 探针可能假红；用「推流时判断距离」实现则无此风险 |

**结论：三条均无需改门禁判据。** 唯一要盯的是滚动实现形态（监听回拉 vs 推流时判断），且它落在 `panels-check` 已知的测高回修张力上——若 B1 复跑出现「DOM 0 节点 / 净位移 0」，先按 AGENTS.md 判读法单跑复验，再怀疑代码。

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

⇒ **`error` 必须落 card 类**：P0 只给 live 加了 `case 'error'`（`app.js` 在飞 diff 实测），重放仍走
`projectHistory` 的 record 桩。B1 若分组表漏列 `error`，会把 P0 刚修的失败可见性**整条丢掉**——
故 §6 增一条断言：含 `error` 事件的会话，replay 后流内必须出现 `.card.err`。

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
- 形态不变：仍是 `button + hidden`。**不引入 `<details>`/`<dialog>`/`popover`** —— 理由**不是**「不许定形态」：
  §10.1 第 7 条其实**已经**把设置页形态定为「模态（Claude Desktop 同款），不占面板位」，
  所以换原生 `<dialog>` 只是实现替换而非形态决定。本轮不换的真实理由是 ①**白名单钩子依赖**
  （`#settingsOverlay` / `#drawer` / `#drawerToggle` 的生产者就挂在手写结构上）
  ②**范围**：R1b 是机制减法（渲染器/空态/折叠份数），不是控件替换。见 §8。

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
| 设置弹窗/风险遮罩换 `<dialog>` | `<dialog>`=0、`popover`=0，两处手写 overlay | ①**白名单钩子依赖**：`#settingsOverlay`/`#drawer`/`#drawerToggle` 的生产者就挂在这两处手写结构上，迁移即动判据面；②**范围**：R1b 是机制减法不是控件替换。注意「用户约束不许定形态」这条理由**不成立**——§10.1 第 7 条已把设置页定为「模态」，换 `<dialog>` 只是实现替换。⇒ 下一轮若要提，须先解钩子依赖，别拿 Chromium 152 当理由 |
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
