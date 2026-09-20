# docs/ 目录说明（先读这里）

本目录混放**里程碑验收证据**与**现行文档**。多数截图已过时，读之前先看这一页。

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

### 重生成 `m1e-*` 两张截图

`docs/m1e-panels.png` 与 `docs/m1e-settings.png` 由 `panels-check` 产出，默认不写盘（避免脏工作树）：

```sh
M1E_SCREENSHOT=1 pnpm panels-check
```

⚠️ 当前 `panels-check` 因 7 个 CDP 探针指向已死的 React DOM 而**红**（症状与退出码见 `AGENTS.md`「当前状态」段；
立案见 `BLOCKED.md`「panels-check 7 个 CDP 探针指向已死 React DOM」，改指任务 = MAINT-06）。
**门未绿前这条命令跑不到截图那一步**，别用它刷新交付截图。

## 三、本目录里哪些已过时

| 文件 | 状态 |
|---|---|
| `*.png`（25 张，m0b…m4b） | **过时**——React 时代 UI，仅作里程碑证据 |
| `CODE-WIKI.md` | **顶部已加过时提示**（2026-09-17），但**正文为存档、未逐行改写**：第 1 节「形态/样式」两行与第 5.8 节仍按 React 渲染层描述；「验收体系」一节的**门数与测试文件数也写死了**（已漂） |
| `solpi-port-proposal.md` | 大体现行（已区分 React 树与 `app.js`）；但「迁移仍在进行中」的表述已过期（迁移已于 2026-09-17 完成），且其中引用的 `app.js` 行号已漂 |
| `m2`–`m5` 的 `*-acceptance.md` / `*-audit.md`、`m5-proposal.md` | 里程碑验收记录，**保留不改**：其中的门数、断言数是**收口当日**的历史快照，不表示当前值 |

> 纪律：本目录的证据文件**只读不改**。发现漂移 → 在此登记，不删原文。
> 同上：**本页不写死行号**（行号会随改代码漂移，只作定位线索）；门数以 `scripts/gate-manifest.ts` 为准，测试文件数以 `tests/*.test.ts` 为准。
