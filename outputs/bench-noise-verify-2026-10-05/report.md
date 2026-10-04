# 评估尺的臂间噪声（复验，更正第 378 页那条读数）— 2026-10-05

作者：只读子代理（无写权，由主线程落盘）。取料：纯静态＋读留档，**未跑任何判卷或真模型评测**。
根路径 `/Users/ze/Downloads/Cairn/deepseek harness`。

## 结论（三句）
1. 「臂间噪声 ≥ 1 靶」**成立**，但第 378 页与 `outputs/eval-harness-face-2026-10-04/verdict.md` 那句「差一条靶」把数**抄小了**：同分母两趟 per-target 翻的是 **3 条**（`B4↑ B10↓ B12↓`），净值才是 1。错因＝拿汇总行（10/12 vs 9/12）当 per-target 数。
2. 现在这把尺**测不出**「一次改动带来 1 条靶提升」。
3. `gym-draft` 盘上零草稿的因由是**既没人调用、也无需触发**（无常驻入口；bench 不带 `--keep` 连转录都不留），不是缺陷被掩盖。

## 证据
- A 臂 `outputs/bench-head-d0ffe15e-a/run.log:17` ＝ 10/12，FAIL＝`B2`（held-out 红＋撞 `maxSteps=30`）、`B4`（改了判卷面）。
- B 臂 `…-b/run.log:17` ＝ 9/12，FAIL＝`B2`（同因）、`B10`（改了判卷面）、`B12`（verify 未跑＋撞帽）。
- 每臂 12 靶；原始 per-target 在 `outputs/bench-head-d0ffe15e-{a,b}/readings.json`（每行 `{r,g}` 带 `g.fails`、held-out TAP 全文、`touchedJudge`、resources），另各 12 份 `*.events.jsonl` 全转录。
- 同分母核对：靶集 12 条同名、`model=mimo-v2.6-flash`、`system=base`、`reps=1`、`maxSteps=30`、装配串、起始态＝红、拨数全 1 ⇒ 两份 `run.log:2-4` 逐字相同。
  **HEAD 无法自证**（`readings.json` 里没有 `headSha/ranAt`，而 `scripts/eval/report.ts:219` 的身份闸是 fail-closed 的）；替代取证：18:29–19:01 期间 `src|fixtures|scripts` 零 mtime 变更，其间只落 `99312b1a/40f3e0c3`（PROGRESS＋outputs）⇒ 被度量码面同。
- 旁证（翻转率不止一趟）：`outputs/eval-noise-band-2026-10-01/README.md` 记 9/12↔8/12、翻 3/12（复算 `eval-base-a/b`＝3 翻）；第三趟 `bench-baseline-2026-10-04`＝10/12，与 A 翻 2、与 B 翻 1 ⇒ **单趟翻转率 8–25%**。

## 尺的现状（哪一格没有读数）
- `scripts/loop-eval.ts:69` 有 `--reps`（缺省 1），行内记 rep（`:545`、`:686`），但 `tally` 把 k×12 池成一个数（`:716`、`:726`）——**重复跑了也不出分布**。
- `scripts/eval/report.ts:256` 的 `noiseBand` 只吃两份读数的**指标绝对差**，既无同臂分布也无 per-target 配对。
- 唯一算「翻转条数」的是私人件 `outputs/repair-arm-ab-2026-10-04/compare.mts:92-115`，而它的执行留档里**没有**噪声底线那一行（`compare-smoketest-neighbor-archives.txt`），「3/12」只手写在 `commands.md:32`＝没跑过。

## 要付的额度（要让 1 靶可测）
1. 零花费先补身份键：`scripts/loop-eval.ts:306-338` 的 `Reading` ＋ `:737` 落盘补 `headSha/ranAt/maxSteps/reps/--arm tag`，末行印每靶 `pass^k` 与翻转数。
   **⚠ 撞车**：`scripts/loop-eval.ts` 与 `scripts/eval/report.ts` 在主树里有别人的未提交改动 ⇒ 只登记不施工。
2. 同 HEAD 干净树跑 `--reps 6` ＝ 72 趟 ≈56 分钟、≈666 请求（逼近免费档 1000 次/日，见 `outputs/bench-reps3-2026-10-02/README.md`）；旧带价语料均值 ¥0.039/趟 ⇒ 上界 ≈¥2.8。**现档一律「价不可知」**，要印钱须先给 `EVAL_PRICE_*`（只提变量名，不提值）。
3. `k=6` 才能把每靶噪声压到 ±0.35（1 靶够 3σ）；`k<4` 读不出。

## gym-draft 那一格
唯一消费者 `scripts/gym-draft.ts:8,59`（CLI，缺省 dry-run，`:75-78` 才写盘，`:60` 落 `fixtures/gym/drafts/<id>`，`:64-68` 拒写 cases）；`package.json` 只有 `:37 gym-check`，src 内零调用点（`src/agent/gym/draft.ts:42` 只被 CLI 与 `tests/gym-draft.test.ts` 引）；读尺在 `scripts/gym-check.ts:90-104`。盘上确为零草稿（全仓无 `drafts` 目录、HEAD 树 0、`.agent/` 只有 permissions/rules/sessions（空）/skills）。promote/冻结按设计是**人的动作**（`scripts/gym-draft.ts:48`）。

## 台账动作
- 更正第 378 页第 4 条③那条读数（`PROGRESS.md:12994-12996` 一带）：「差一条靶」→「per-target 翻 3 条、净 1」，并**新立 `#90`**：评估面缺身份键（`headSha/ranAt`）＋缺同臂分布 ⇒ 任何「涨了几分」的结论现在都不许出口。前置＝`scripts/loop-eval.ts`／`scripts/eval/report.ts` 腾出手。
