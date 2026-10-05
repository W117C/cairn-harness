# `#69`／`#71` 冻结登记待办（契约 C10：本页只备条目，**不由我代劳**）

`scripts/frozen-sha256.json` 是本仓第一纪律里**唯一写明「必须由人做」的一步**——
`scripts/gym-draft.ts` 的头注释原文：「永远不碰 `scripts/frozen-sha256.json`——冻结判据是本仓第一纪律里
唯一必须由人做的那一步」。本页遵守它：只把**要登记什么、当前哈希是多少、登记后会发生什么**备齐，
登记动作留给业主。

## 待登记的三个新增面

三个都在 `.worktrees/verify-c7f2ea0f`（`#69`／`#71` 的备妥簇）里，**当前都不在冻结表中**。
现读 sha256（在该树内实测，取前 16 位；完整值请以业主复核时的现读为准）：

| 路径 | sha256（前 16） | 现状 |
|---|---|---|
| `fixtures/no-progress/synth-red-repeat-readonly-shell.events.jsonl` | `e9726ed369bb06b7` | ★未登记 |
| `fixtures/no-progress/synth-red-repeat-shell-write.events.jsonl` | `643257dc8942d392` | ★未登记 |
| `tests/cap-hit-verify.test.ts` | `8c148f0c77c90c01` | ★未登记 |

**为什么是三个而不是九个**：该簇 9 项在飞改动里，只有这三个是**新增文件面**；其余六项
（`src/agent/loop.ts`、`src/agent/no-progress.ts`、`src/tools/run_shell.ts`、`scripts/no-progress-check.ts`、
`tests/no-progress.test.ts`、`tests/shell-family-cause.test.ts`）都**已在冻结表中**，登记动作会更新它们的内容哈希，
而不是新增条目。⇒ 业主要登记的是「三个新键 + 六个既有键的内容更新」。

## 登记顺序有讲究（先看这一格，再动手）

1. **先并入簇，再登记**：这九项目前在隔离树里未提交。冻结表登记的是**已入库内容**的哈希，
   顺序反了（先对未提交内容算哈希）⇒ 并入后哈希会变，登记值当场失效。
2. **登记要同笔进 HEAD**：本仓 `docs-check` 的 D-11 要求「证人要与页同笔落库」，
   冻结登记与该簇实现同笔最省事；分两笔会让中间那笔撞「判卷文件漂移」那条红。
3. 登记后跑 `node --import tsx scripts/gate-check.ts`——它的 H7 那格会双向对账
   （`onDiskNotInTable` ／ `inTableNotOnDisk` ／ `tableDirsNotSwept`），三个新面漏登记时它会点名。

## 现状读数（写清，免得下一个来的人重新量）

- 冻结表现读 **66 条**（`scripts/frozen-sha256.json`）。
- `gate-check` 现读绿，其 H7 双向对账为 `{"onDiskNotInTable":[],"inTableNotOnDisk":[],"tableDirsNotSwept":[]}`——
  即**当前这九项还没并入主树，所以表与盘仍然自洽**；登记要等并入之后。

## 本页没跑的东西（不写成绿）

只跑了：一次冻结表读取、三个文件的 sha256 实测、一次 `gate-check` 的现读。
**没跑**全量、认证、`mutate-verify` 真杀；**没做**登记动作。