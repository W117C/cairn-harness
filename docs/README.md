# docs/ 目录说明（先读这里）

本目录混放**里程碑验收证据**与**现行文档**。多数截图已过时，读之前先看这一页。

> **2026-09-22 起新增两份入口**（只加指针，不改写下方历史正文）：
> - **全库文档导航** [`DOCS-MAP.md`](./DOCS-MAP.md) —— 按「你现在想干什么」指路，含 outputs/ 调研档案索引与效力分层。
> - **项目综合报告** [`PROJECT-REPORT-2026-09-22.md`](./PROJECT-REPORT-2026-09-22.md) —— 全景、优缺点、优化清单、发展路径。
>
> **安全债现状（2026-09-22）**：包装器绕过四条已收口——`scripts/probe-shell-bypass.ts` 复跑 **红 0 / 绿 33**，
> 判据与修法见 [`outputs/shell-permission-bypass-2026-09-21.md`](../outputs/shell-permission-bypass-2026-09-21.md)。

## 一、`*.png` 记录的是「vanilla 迁移之前」的 React 版 UI

25 张验收截图（`m0b-ui.png` … `m4b-onboard.png`，含 `m1e-panels.png` / `m1e-settings.png`）拍摄于
2026-09-09 ~ 2026-09-15，**全部早于 2026-09-17 的渲染层迁移**。它们画的是当时的 React 渲染树
（`src/renderer/main.tsx` + `conversation.tsx` + `cards/` + `components/ui/`）——该树**已不在运行时路径**。

截图是里程碑证据，**为存档保留、不重拍**：它们仍能佐证当时的验收结论，但**不能用来判断当前 UI 长什么样**。

## 二、当前状态的参照物

| 要看什么 | 去哪看 |
|---|---|
| 现行渲染层 | `src/renderer/index.html`（单文件内联 CSS + 静态标记）+ `src/renderer/app.js`（纯 ESM；无 React、无 Tailwind 运行时、无 shadcn 运行时） |
| 当前权威规范包 | `outputs/frontend-refactor-2026-09-17/`（`00`–`06`） |
| 当前设计系统 | `outputs/frontend-refactor-2026-09-17/02-design-system.md` |
| 最新证据截图 | `outputs/frontend-refactor-2026-09-17/evidence/shots/`（`r1-*` / `s1-*`，2026-09-17） |
| 仓库级现状 | 根目录 `AGENTS.md`「当前状态」段 |
| 判断层校准路线（方案待裁决，含可粘贴复跑的回放命令） | `docs/judgment-layer-calibration-proposal.md` |
| 战略基线（2026-09-18 调研轮，三份互指） | 路线与优先级：`outputs/best-agent-roadmap-2026-09-18.md`（harness-only 超越 Codex/CC；§2 门 0 可达性、§13 21 条孤儿桥裁决表、§14 自纠）· 代码能力面差距：`outputs/agent-landscape-gap-analysis-2026-09-18.md`（A1–A9）· 渲染侧矛盾台账：`outputs/design-contradictions-2026-09-18.md`（T1–T28）。<br>⚠️ **读 A 档时注意两条已收口**：A2 上下文预算认模型 = `d64084e`；A5 provider 重试 / 429 = `887ffb6`（`src/providers/retry.ts`，三家共用）。别照文档去修已完成项 |
| 判断层新增行动空间「思考档位（effort）」的前置量测（2026-09-21 两份配套，**均未接线**） | 参数面——为什么这一格今天只是装饰：`Provider` 契约没有 per-turn 通道、渲染层那个五档滑块零出口、Anthropic 的输出上限无人覆盖：`outputs/effort-param-surface-2026-09-21.md` · 计费量测——4096 在 54 轮真钱语料上从没咬过顶，开最低 thinking 档＝输出账面 **×5.4**，真前置是三家的**停止原因全是零读者**：`outputs/anthropic-thinking-cost-2026-09-21.md`。<br>⚠️ 引用倍率前先复跑两页附录命令：分母来自 GLM 那两臂评测语料，换 provider 会平移；两页都是**评估读物，不构成实现依据** |

### 重生成 `m1e-*` 两张截图

`docs/m1e-panels.png` 与 `docs/m1e-settings.png` 由 `panels-check` 产出，默认不写盘（避免脏工作树）：

```sh
M1E_SCREENSHOT=1 pnpm panels-check
```

那 7 个 CDP 探针当年按 React 渲染层写、vanilla 迁移后 0 命中（立案见 `BLOCKED.md`
「panels-check 7 个 CDP 探针指向已死 React DOM」，改指任务 = MAINT-06，逐条标在
`scripts/panels-check.ts` 的 `改指（MAINT-06）` 注释里）。**门现在是绿的**：2026-09-21 单跑
`pnpm panels-check` → 末行「全部断言通过 ✅」、exit 0 ⇒ 上面这条命令跑得通。
⚠️ 但**别顺手跑它**：这两张 PNG 属于第一节说的那批**里程碑存档证据**（2026-09-09 ~ 09-15 的 React 态），
一设 `M1E_SCREENSHOT=1` 就就地覆盖 `docs/m1e-panels.png` 与 `docs/m1e-settings.png`——覆盖掉的是证据本身。
本轮**只核到命令可跑，没有真去刷新**；要用它刷新交付截图前先确认这正是你要的，且只动这两张。

## 三、本目录里哪些已过时

| 文件 | 状态 |
|---|---|
| `*.png`（25 张，m0b…m4b） | **过时**——React 时代 UI，仅作里程碑证据 |
| `CODE-WIKI.md` | **顶部已加过时提示**（2026-09-17），但**正文为存档、未逐行改写**：第 1 节「形态/样式」两行与第 5.8 节仍按 React 渲染层描述；「验收体系」一节的**门数与测试文件数也写死了**（已漂） |
| `solpi-port-proposal.md` | 大体现行（已区分 React 树与 `app.js`）；但「迁移仍在进行中」的表述已过期（迁移已于 2026-09-17 完成），且其中引用的 `app.js` 行号已漂 |
| `m2`–`m5` 的 `*-acceptance.md` / `*-audit.md`、`m5-proposal.md` | 里程碑验收记录，**保留不改**：其中的门数、断言数是**收口当日**的历史快照，不表示当前值 |

> 纪律：本目录的证据文件**只读不改**。发现漂移 → 在此登记，不删原文。
> 同上：**本页不写死行号**（行号会随改代码漂移，只作定位线索）；门数以 `scripts/gate-manifest.ts` 为准，测试文件数以 `tests/*.test.ts` 为准。
