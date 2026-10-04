# 评估面取证：能跑的 / 跑过的 / 只是骨架的

取证日期：2026-10-05。HEAD = `19dfa23c9dddfba81f734002ee81f061e544a7da`（工作树 162 笔脏，认证在另一窗口跑）。

**取料纪律**：脏文件一律 `git show "${rev}:path"` 取 HEAD ⇒ 本报告中这些文件的行号是 **HEAD 行号**，
与工作树不同：`src/agent/eval/task-set.ts`、`scripts/lib/eval-heldout.ts`、`scripts/gym-check.ts`、
`scripts/gym-run.ts`、`scripts/gym-draft.ts`、`scripts/replay/corpus.ts`、`tests/eval-heldout.test.ts`、
`scripts/mutate-verify.mjs`、`PROGRESS.md`。干净文件直读，行号即工作树：
`package.json`、`scripts/loop-eval.ts`、`scripts/eval/report.ts`、`scripts/lib/eval-expects.ts`、
`scripts/lib/eval-arms.ts`、`fixtures/bench/tasks.json`、`outputs/**`。

**未跑**：判卷、typecheck、任何 `scripts/*-check.ts` 门、mutate-verify、任何一次真评估。
**未读值**：`EVAL_PRICE_IN`／`EVAL_PRICE_OUT`／`CAIRN_API_KEY`／`CAIRN_ENDPOINT`／`CAIRN_MODEL`／
`OPENAI_*`／`M0_API_KEY` 只出现变量名，一律没有取值。

一句话结论：**评估面不是骨架，是能跑且跑过的尺**——但它的三条腿粗细差别很大：
跑器（在）、任务集（在，12 条本地靶）、对账表（在，离线）。
外部基准只有 **SWE-bench 那一层的解析器**在，数据集/快照/语言侧判卷**三样都不在**；
Terminal-Bench、Aider Polyglot **没有任何代码**（零适配器）。
最近一次真出分是 **2026-10-04 18:58 的 `outputs/bench-head-d0ffe15e-b`：9/12 达标**（同 HEAD 另一臂 10/12 ⇒ 同配置两趟翻 1 格）。
失败轨迹确实回流过，但**回流的方向是"失败 → 尺子的修正"，不是"失败 → 回归样本"**。

---

## 一、现在真能一条命令跑起来的评估：3 条（外加 1 条零花费自检路）

入口命令**逐字**取自 `package.json`（该文件干净，行号即工作树）：

| # | 命令 | 出处 | 跑的是什么任务集 | 判定是什么 |
|---|---|---|---|---|
| 1 | `pnpm bench` = `node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json --reps 1 --max-steps 25 --out outputs/bench` | `package.json:52` | 12 条本地靶 B1–B12（`fixtures/bench/tasks.json`，全部 `source: "dsh-bench@local"`；靶子 `fixtures/bench/bench-*`） | **逐条断言，不是分数阈值**（见下）＋汇总「合计 N/M 达标」 |
| 2 | `pnpm eval-report` = `node --import tsx scripts/eval/report.ts` | `package.json:53` | 不吃任务集，**离线**吃 `readings.json`（`scripts/eval/report.ts:22` 只有 `readFileSync`；`:469-481` 取 `--baseline`/`--candidate`） | 噪声带逐指标判 + **两道闸**；出口码 0/3/4/5（`:444-449`），缺参数 exit 2（`:473-479`） |
| 3 | `pnpm gym-check` = `node --import tsx scripts/gym-check.ts` | `package.json:37` | **不是能力基准**：4 条冻结剧本 case（`fixtures/gym/cases/`：`config-default`、`order-pricing-triple-fix`、`sum-clamp`、`todo-completed-count`），`model: "scripted"`（HEAD `scripts/gym-check.ts:113`、`:180`） | 断言计数 `pass/fail`，`process.exit(fail === 0 ? 0 : 1)`（HEAD `:218-219`）；第 24 道门，预算 2400ms（`scripts/gate-manifest.ts:30`、`:208`） |

### 1.1 `pnpm bench` 的判定细面（这决定"分数"这两个字能不能用）

- **每条任务的判据 = `expects` 名字表**，解释在 `scripts/lib/eval-expects.ts:34-52` 那张
  `EXPECT_HANDLERS` 表：`verifyOk`（`verifyOkLast !== true` ⇒「verify 未通过/未跑」）、
  `judgeUntouched`（`touchedJudge` ⇒「改了判卷面」）、`heldOutPass`（交 `lib/eval-heldout` 的五态措辞）、
  `clarify`／`planBeforeWrite`／`readBeforeWrite`／`onlySrcChanged`／`wroteTest`／`testNotRewritten`／`verifyRecovered`。
  任何一条 fail ⇒ 该趟 FAIL（`scripts/loop-eval.ts:569-584`）。判据名**未登记就拒收**
  （HEAD `src/agent/eval/task-set.ts:64` 的 `EXPECT_NAMES` 与处理器表键集相等，由 `tests/eval-task-set.test.ts` 钉）。
- **靶子自带判卷**：`verifier.command = node --test tests/*.test.js`（`fixtures/bench/tasks.json:10-12` 等 12 处），
  退出码 0 才算 verify 绿；链路面判据是「副本 vs 原靶逐字节比 + 只认模型自己发起的写」
  （`scripts/loop-eval.ts:470-519`）。
- **隐藏验收（held-out）**：只有 2/12 条有面——`fixtures/bench-heldout/B1/checkout.held.test.js`、
  `B2/fit.held.test.js`（`fixtures/bench/tasks.json:13-21`、`:39-47`）。装进副本的时机被钉在
  **改动清单算完之后**（`scripts/loop-eval.ts:521-532`），否则隐藏文件会冒充"模型改了判卷面"。
- **分母口径**：未起步／被 provider 打断的趟次记「无效」不进分母（`scripts/loop-eval.ts:699-702`，
  谓词在 `scripts/lib/eval-validity.ts` 的 `runValidity`/`tally`）；一趟都不算数 ⇒ **拒绝出数**（`:720-723`）。
- **钱这一格独立于分数**：`EVAL_PRICE_IN`／`EVAL_PRICE_OUT` 两个都缺 ⇒ `cny = NaN` ⇒ 印「价不可知」而不是 ¥0.000
  （`scripts/loop-eval.ts:124-131`、`:724-736`；`priceFace` 在 `lib/eval-validity`）。盘上所有留档都是这一档。
- **拒绝出数的三处硬闸**：任务集解析报错（`:190-196`）、`--only` 筛空（`:659-662`）、
  **装配面有未表态的缺省开键**（`:674-682`，表在 `scripts/lib/eval-assembly.ts`）。

### 1.2 「能跑」的两个前提，必须写清楚，否则会把骨架说成能跑

1. **`pnpm bench` 无凭据时是"跑得完但零读数"**：`scripts/loop-eval.ts:668-672` 在缺
   `CAIRN_API_KEY`/`CAIRN_ENDPOINT`（回退 `OPENAI_API_KEY`/`OPENAI_BASE_URL`，`:107-123`）时
   印「暗卷缺席…显式跳过，不出数（未证 ≠ 通过）」并 **exit 0**。
   ⇒ 这条命令**永远绿**，绿不等于量到了东西。判卷器自校（`:229-243`）排在凭据检查**之后**（`:673`），
   所以无凭据时连自校都不做。
2. **落库那条一行命令并不是产出盘上分数的那条**：`package.json:52` 写 `--max-steps 25`、不带 `--keep`；
   留档那两趟 `run.log` 现读是 `maxSteps=30` 且带 `--keep`
   （`outputs/bench-head-d0ffe15e-a/run.log:4`）。⇒ 用 `pnpm bench` 复现盘上读数会得到**不同预算档**的分数，
   而且**默认不留失败转录**（`--keep` 是唯一出口：`scripts/loop-eval.ts:538-541`）。
   这一条已有留档自认：`outputs/repair-arm-ab-2026-10-04/commands.md:3-7`
   （「老留档…连 run.log 都没有 ⇒ 有一部分取在"预算未知"的档次上」）。

### 1.3 一条零花费、今天就能跑的诊断路（不在 `package.json` 里）

`--feasibility`：`scripts/loop-eval.ts:184`（旗标）、`:614-654`（`reportFeasibility`）——
只答"这批任务现在量得了吗、缺什么"，**不发任何模型请求**，并逐条印 `可跑/不可跑 ← 缺口`＋工具链自检
（自检命令由 `deriveVerifierProbe` 推，HEAD `src/agent/eval/task-set.ts:309-322`；认不出的形状一律按未证）。
它没有 npm script 名字，只能手打 `node --import tsx scripts/loop-eval.ts --tasks … --feasibility`。

### 1.4 只是骨架／有代码但没有常驻入口的那些（别当成能跑）

- `scripts/gym-run.ts`（HEAD `:2-5` 用法：`--all [--model scripted|real]`）——不在 `package.json`。
- `scripts/ga-strategy.ts`（HEAD `:6` 用法 `… [--max-steps 12] [--max-requests 60] [--out outputs/ga-strategy-<date>]`，
  落盘 `:264`）——**不在 `package.json`，但真跑出过分数**：盘上 12 份 `{caseId, arms}` 读数
  （`outputs/ga-strategy-2026-09-20*`、`outputs/ga-solo-t1-2026-10-04/*/`）。它是"策略/编排臂"那把尺，不是能力基准。
- `scripts/gym-draft.ts`（HEAD `:1-6`）——不在 `package.json`（详见第四节）。
- `scripts/replay/` 15 支离线读数器（含 `run-scorecard.ts`、`lessons-offline.ts`、`longrun-ladder.ts`；
  语料根 `scripts/replay/corpus.ts:15` 扫 `outputs/`）——**全部不在 `package.json`**。
- 判卷这一面本身有尺：`tests/eval-*.test.ts` 共 **213 条**
  （`eval-report` 45／`eval-task-set` 41／`eval-heldout` 35／`eval-validity` 27／`eval-arms` 26／`eval-assembly` 25／`eval-retry` 14）。
  这 213 条钉的是**尺子**，不是模型分数。

---

## 二、外部基准的接入面：SWE-bench 有解析器，Terminal-Bench／Aider **没有**

### 2.1 确实存在的数据结构 + 装载器（SWE-bench 形状）

- **适配器**：`fromSweBenchJsonl`（HEAD `src/agent/eval/task-set.ts:236`）——JSONL 一行一个 instance，
  认 `instance_id`/`repo`/`base_commit`/`problem_statement`/`FAIL_TO_PASS`/`PASS_TO_PASS`；
  缺 `FAIL_TO_PASS` ⇒ 拒收（`:265-269`「没有判卷的条目不许进分母」），缺/坏 `PASS_TO_PASS` ⇒ 拒收
  （`:270-274`「只查坏的要过、不查好的不许坏，是半份判卷」）；
  造出的形状：`seed = eval-snapshots/<instance_id>`（`:278`）、
  `verifier.command = "python -m pytest -rA <F2P> <P2P>"`（`:282`）、`source = repo@commit`（`:284`）。
- **入口旗标**：`--swebench <file>`（`scripts/loop-eval.ts:183`）→ `loadTaskFile(kind="swebench")`（`:163-180`）→
  条目标 `external: true`（`:176`）。
- **专测**：`tests/eval-task-set.test.ts`（41 条，含 `fromSweBenchJsonl` 那一组）。
- **明确拒绝硬跑**：`scripts/loop-eval.ts:351-356`——外部条目直接抛
  「本跑器跑不了，请用 `--feasibility` 先看缺口」；含外部条目的任务集在出数前被拦（`:664-667`）。
  ⇒ 这一格是**故意只做到解析层**，不是忘了接。
- **留档读数（SWE-bench 形状的唯一一份真读数，零花费）**：
  `outputs/eval-benchmark-adapter-2026-09-24/01-基准进得来缺口点得出名.md` §三 现读原文——
  `--swebench … --feasibility` ⇒ `sympy__sympy-20322 不可跑 ← 缺仓库快照 sympy/sympy@a1b2c3d4（定位 eval-snapshots/…）——本模块不联网 clone；缺模型凭据`，
  「可跑 0 / 分母 1，明写这是没有尺，不是 0 分」；同一份数据加一行缺判卷 ⇒ 解析报错 1 条 ⇒ **exit 1 拒绝出数**。
  样本文件：`outputs/eval-benchmark-adapter-2026-09-24/swebench-sample.jsonl`（现读 2 行：
  第 1 行真形状 `sympy__sympy-20322`／repo `sympy/sympy`；第 2 行是故意坏的那条 `broken-line-no-judge`）。
  ⇒ 这是**夹具不是数据集**。

### 2.2 Terminal-Bench／Aider Polyglot：**没有**接入面（明说）

全仓 `*.ts/*.mts/*.mjs/*.json/*.md` 现读（排除 `node_modules`、`outputs`、`.worktrees`）命中只有：

- `src/agent/map/rank.ts`、`src/agent/map/render.ts` 里的 **aider 边权注释**（现读干净文件行号：
  `src/agent/map/rank.ts:8`「(文件, 标识符) 对——aider 同构」、`:74`「mul 规则（aider 照抄）：mentioned ×10；
  referencer ∈ contextFiles ×50…」、`:114`、`:174`；`src/agent/map/render.ts:79`「aider pct_err 同款」）
  ——**符号地图的算法出处，不是基准装载器**。
- `PROGRESS.md:7827-7833`（HEAD 现读，行号同工作树）与 `outputs/bench-mapping-2026-09-30/readings.md` §二 ——散文映射表。
- ⇒ **零** Terminal-Bench 任务形状、**零** Aider Polyglot YAML 装载器、**零** 容器编排代码。
  且 `package.json` 依赖里**没有 YAML 解析器**（现读 deps/devDeps 无 `yaml`），
  `outputs/eval-benchmark-adapter-2026-09-24/01-….md` §四.3 已写明「现在的路子是外部转成 JSON/JSONL 再进」。

### 2.3 差距在哪一层（按层剥，不是一句"还差点事"）

| 层 | 状态 | 证据 |
|---|---|---|
| ① 任务格式（读进来） | **SWE-bench 已接**；Aider/Terminal-Bench 的 YAML **未接** | HEAD `task-set.ts:236`；`tests/eval-task-set.test.ts`；无 YAML 依赖 |
| ② 仓库准备（靶子快照） | **缺**。`eval-snapshots/` 目录不存在（现读 `ls` 无此目录）；数据层刻意不联网 clone | HEAD `task-set.ts:278`（定位式）、`:290-296`（`EnvProbe.hasRepoSnapshot` 契约）、`:327-329`（blocker 措辞） |
| ③ 判定脚本（语言侧判卷） | **缺**。适配器只是**拼出** pytest 命令字符串；跑器执行不了 | `task-set.ts:282` 造命令 ⇄ `scripts/loop-eval.ts:351-356` 对外部条目抛错；`deriveVerifierProbe` 只做"工具链在不在"的自检（`:309-322`） |
| ④ 装配/运行时（跑得了别人语言的仓库） | **缺**。跑器唯一 provider 是 GLM 会话装配，靶子必须是 node 工程（verify 走 `pnpm test`/`node --test`） | `scripts/loop-eval.ts:417-425`（provider）、`:216-217`+`:229-243`（判卷器只认 node/pnpm 形状） |
| ⑤ 容器（只 Terminal-Bench 需要） | **缺且是裁决题**。`runInSandbox` 是 macOS seatbelt，不是容器 | `outputs/bench-mapping-2026-09-30/readings.md` §二 末行；`PROGRESS.md:7831` |

**结论一句话**：与外部基准差的是 **②③④⑤ 四层，且只有 ① 通了**；
`readings.md` §一那句「缺的不是底座，是外部数据集与一次真模型授权跑」**今天仍然成立**，
但要把「一次真模型授权跑」改成「一次真模型跑 + 语言侧判卷」——
因为 `outputs/bench-mapping-2026-09-30/readings.md` §三 那三条拦路项里，凭据那一项**已经被 2026-10-04 的 12 条真跑趟次翻掉了**
（现读 `:28` 还写着「需要你给一个 key」，且键名 `M0_API_KEY`/`M0_ENDPOINT`/`M0_MODEL` 已过期：
跑器现在读 `CAIRN_*` 并回退 `OPENAI_*`，`scripts/loop-eval.ts:107-123`；只有 `scripts/gym-check.ts:203-206` 和
HEAD `src/agent/eval/task-set.ts:337` 的 blocker 文案还在说 `M0_*` ⇒ **这三处措辞 stale**）。

---

## 三、历史留档最近一次真跑出分数：2026-10-04 18:58，`bench-head-d0ffe15e-b` = **9/12 达标**

按 `readings.json` 的 mtime 倒序现读（`find outputs -name readings.json -exec stat …`）：

| 名次 | 目录 | mtime | 结论（各自读数文件现读） |
|---|---|---|---|
| **1** | `outputs/bench-head-d0ffe15e-b/readings.json` | **2026-10-04 18:58** | **9/12 达标**；12 行全 `system=base`、`model=mimo-v2.6-flash`；FAIL 三条：`B2-feature-export`（held-out 红〔exit=1〕+ verify 未跑 + 撞 `maxSteps=30`）、`B10-refactor-dedupe`（**改了判卷面**）、`B12-long-horizon`（verify 未通过/未跑 + 撞帽） |
| 2 | `outputs/bench-head-d0ffe15e-a/readings.json` | 2026-10-04 18:50 | **10/12 达标**；FAIL：`B2`（held-out 红 + 撞帽）、`B4-bugfix-pagination`（**改了判卷面**）；其余 10 条 PASS，`B1` 隐藏面=绿 |
| 3 | `outputs/bench-baseline-2026-10-04/readings.json` | 2026-10-04 18:10 | 10/12 达标；FAIL：`B2`（held-out 红）、`B12`（撞帽）；12 份 `*.events.jsonl` 同目录留档 |
| 4 | `outputs/bench-b1-trial-2026-10-04/readings.json` | 2026-10-04 17:56 | 1/1（单条 B1，model 另一档） |
| — | `outputs/ga-solo-t1-2026-10-04/*/readings.json` | 10-04 12:28–12:32 | **另一把尺**（`scripts/ga-strategy.ts`，无 npm script）：16 份 `{caseId, arms}` 形状的真模型读数，现读 `config-default-rep1.log:2` `score=1 verify=ok 请求=4 tokens=12256 … $=价表无此模型名`。**这份 `readings.json` 对账表读不动**（见 §5 的形状普查） |

**这两臂的关系比分数本身重要**：同一个 HEAD（`d0ffe15e`，2026-10-04「第 359 页」，现读是其祖先链上的一笔）、
同一配置、同 12 条任务，**10/12 ↔ 9/12 只差 1 格** ⇒ 这是盘上现成的"同配置两趟"噪声底线证据。
`-a` 的 `run.log` 汇总行现读（`outputs/bench-head-d0ffe15e-a/run.log`）：

- 装配面：`autoMemory:off-here autoVerify:off-here impactAnalysis:off-here promptCache:off-here subagentTools:same`
- 任务 12 条 / `reps=1` / `system=base` / `maxSteps=30` / `价=价不可知〔没给 EVAL_PRICE_IN / EVAL_PRICE_OUT〕`
- 合计 **10/12 达标** · 实付=价不可知 · 每达标任务=价不可知
- 闸补拍：合计 **0**／≥2 拍 **0**（共 12 趟）；返修那一格：**一次绿 11／没验 1**，模型自己红→绿 **0**

**最后一次"开跑了但没出分"的一格**：`outputs/repair-arm-ab-2026-10-04/`（`commands.md:11` 记起跑 2026-10-04 18:59，
比上表都晚）——`a/` 只有 4 份 events + `run.log`（跑到 B4，现读 `a/run.log`：B1 FAIL／B2 FAIL／B3 PASS／B4「改了判卷面」FAIL）、
`a50/` 3 份、**`b/` 与 `b50/` 空**，**四臂都没有 `readings.json`** ⇒ 中途被杀，无汇总读数。
它的 `commands.md:3-7` 还留了一句对 Q1 的补强：老留档「连 run.log 都没有」⇒ 一部分历史趟次取在**预算未知**档。

**离线对账那一面最近一次真出结论**（不是模型分数，是"改动有没有变好"的裁决）：
`scripts/eval/report.ts:317-323` 原文记录 2026-10-05 的离线实跑——
基线 `outputs/eval-base-a` + `outputs/eval-base-b`（同配置两次、各 12 条；现读 **`eval-base-a` 9/12、`eval-base-b` 8/12**，`-b` 的四条 FAIL 全是同一枚判据「改了判卷面」：B3/B4/B5/B8）
↔ 候选 `outputs/bench-reps3-2026-10-02` ⇒ **5 项超带 = 3 项 ★改善（输入 token／输出 token／墙钟）+ 2 项退化，
其中成功率从 70.8% 崩到 5.6%**（现读 `bench-reps3` 的行：36 趟里 2/36 达标，绝大多数是 HTTP 429 被打断）
⇒ 合取闸 `outcomeGate`（`:333-344`）把 3 项"省了钱"压成「副作用（禁读改善）」，出口码 4/5 面（`:444-449`）。
**这一格同时暴露了身份闸今天必咬**：盘上 `readings.json` **全部没有** `headSha`／`ranAt` 键
（现读 `bench-head-d0ffe15e-a` 的行内只有 `model`，无 `headSha`/`ranAt`），
`report.ts:215-218` 明写「盘上现读的 readings.json 全部没有这三个键，所以这道闸今天一定会咬，这是设计意图不是事故」。

---

## 四、「从失败轨迹学习」：回流**存在**，但方向是"失败 → 尺子"，不是"失败 → 回归样本"

### 4.1 有证据链的四条（按强度排）

**① 失败 → 判卷/装配/价面被修（最强，五处，每处都能指到代码 + 留档）**

| 触发的那次失败读数 | 落下来的可复用载体 | 代码位置 | 落库 |
|---|---|---|---|
| 可见测试绿、隐藏验收不认（B1/B2） | **held-out 那一整面**：`fixtures/bench-heldout/B1,B2` + 隐藏装/跑/判 + 数据层 `TaskHeldOut` + 35 条判卷 + 变异锚点（HEAD `scripts/mutate-verify.mjs` 现读 `id: "heldout-*"` **10 枚**，`:11484-11577`；那一笔给锚点表加了 115 行） | HEAD `src/agent/eval/task-set.ts:19-27`、`scripts/lib/eval-heldout.ts:46`/`:127`/`:149`、`scripts/loop-eval.ts:521-532` | `ed8a444e`（2026-10-02「能力 5 那一格补上尺」） |
| 模型**只新增** `tests/stages.mjs`、48 级全绿却被判「改了判卷面」（假红） | `touchedJudge` 改成「只认**既有**判卷被改写/删除，不认新增」，并写明为何新增不是作弊路 | `scripts/loop-eval.ts:504-519` | `f6619891`（2026-10-02「修掉一处判卷尺子的假红」） |
| B4 的模型收到无关澄清答案，烧掉一整轮还去改判卷面（2026-10-01 实测） | 澄清答案**只准发给 I1 那道题**，外部任务集交**空答案**（与 CLI 无人值守同语义） | `scripts/loop-eval.ts:374-389` | 同笔 |
| 10-02 那 36 趟拨免费档却按别人价目印「实付」 | 价必须两个都手给，缺任一 ⇒ `价不可知`（不再静默吃缺省价） | `scripts/loop-eval.ts:124-131`、`:724-736`（`priceFace` 在 `scripts/lib/eval-validity.ts`） | 同族 |
| 盘上 49 趟 `autoVerifyBeat` 全 false 被读成「模型不自己验证」 | **装配面表** + 有未表态缺省开键就**拒绝出数**；`--auto-verify`/`--auto-verify-repair` 接上第二拍 | `scripts/loop-eval.ts:73-93`、`:674-682`、`scripts/lib/eval-assembly.ts` | `d8d61675`、`640b712e`、`98578b3f` |

**② 失败转录确实留了盘——但只在手动 `--keep` 时**

`scripts/loop-eval.ts:538-541`：带 `--keep` 才把 `events.jsonl` 拷进 OUT（文件名含任务 id/rep/system）。
盘上实例：`outputs/bench-baseline-2026-10-04/`（12 份 events）、`outputs/bench-head-d0ffe15e-a|b`（各 12 份 + `run.log`）、
`outputs/eval-b4-diag/`（1 份 events + `readings.json`，那次专门诊断 B4）。
**而 `package.json:52` 那条 `pnpm bench` 不带 `--keep`** ⇒ 一条命令重跑失败样本时，
跑完只剩 `readings.json` 的 `changedFiles`/`fails`，**转录即抛**。

**③ 语料被离线二次消费（有尺，无常驻入口）**

`scripts/lib/eval-arms.ts:1-11` 整支的存在理由就是这条：`run-scorecard` 曾把 21 文件 / 6 臂 / 3 实验族
**池成一个数**（`成功率 89%`），而语料里明明摆着 `loop-eval-v2-base`↔`-short` 的 I1–I4 一一配对 A/B
和同配置三次重复 ⇒ 现按目录名拆臂/族/rep。消费端 `scripts/replay/`（15 支，语料根 `scripts/replay/corpus.ts:15` 扫 `outputs/`）
与 `scripts/eval/report.ts`（吃任意历史 `readings.json`）。
⇒ 这三支里只有 `eval-report` 有 npm script（`package.json:53`），其余**没有常驻入口**。

**④ 运行时那一支「下次别这么干」（`src/agent/memory/lessons.ts`）——评估这一侧接不上它**

判据在 `outputs/failure-learning-face-2026-10-04/verdict.md`（现读）：写有链（`memory/lessons.ts:107` 提炼 →
`memory/distill.ts:202` 落盘 → `main/agent-runner.ts:1872` 会话结束调用）、读有链（`memory/inject.ts:146-167` →
`:267` 排段 → `glm-session.ts:922` 每轮重注），**但三处接缝没有任何判卷**（其 §3.2：摘掉
`distill.ts:202` 全仓无判卷变红；断「真请求体含 `[LESSONS 最近`」的判卷全仓 0 条）。
关键交叉点：**bench 每趟的装配面都印 `autoMemory:off-here`**
（现读 `outputs/bench-head-d0ffe15e-a/run.log:3`、`outputs/repair-arm-ab-2026-10-04/a/run.log:3`）
⇒ 基准跑出来的失败**压根不产教训条目**，两支尺在同一个仓里但**不同面**。

### 4.2 缺口（明说，别美化）

1. **没有"把这次 FAIL 钉成回归任务"的载具跑过。** 唯一设计好的路子是靶场草稿：
   `scripts/gym-draft.ts`（HEAD `:1-6`：真会话 `events.jsonl` → `fixtures/gym/drafts/<id>`，
   `--apply` 才落盘，**永不落 `cases/`**、永不碰 `scripts/frozen-sha256.json`），
   机检在 `src/agent/gym/draft.ts:165-178` `promoteBlockers`（缺 `repo/`/`task.md`/`negative.json`/`expect.json` 逐条点名），
   漏斗读数在 gym-check A4（HEAD `scripts/gym-check.ts:4`），消费端 `--check` 退出码 1。
   **但 HEAD 上 `fixtures/gym/drafts/` 不存在**（`git ls-tree -r --name-only "${rev}" -- fixtures/gym | grep -i draft` 命中 0，
   工作树亦无该目录）⇒ **一条草稿都没落过盘**，`cases/` 仍是 4 条冻结剧本。这一格是**通路齐备、样本为零**。
2. **新增的 bench 靶子是"更难"，不是"上次错的那条"**：`bench-long-horizon-30`、`bench-long-chain-32`、
   `bench-long-chain-48`（`0f8438df`「30 个 bug 只用 11 轮（≥30 轮的前提被 apply_patch 推翻）」、`f6619891`）
   由读数驱动新建，但它们住在**独立文件** `fixtures/bench/tasks-long30.json`／`tasks-chain32.json`／`tasks-chain48.json`，
   **没并进 `pnpm bench` 那 12 条**，且三条都**没有 held-out 面**（现读 `grep heldOut fixtures/bench/tasks*.json` 只命中 `tasks.json`）。
3. **B2 的失败形态（可见绿、隐藏红、撞 `maxSteps`）在盘上连翻 5 趟全复现**
   （`bench-baseline-2026-10-04` 18:10、`-a` 18:50、`-b` 18:50、`repair-arm a/` 18:59、`a50/`），
   而 12 条任务集**至今没为它补一条隐藏面之外的判据**——它现在只被 `heldOutPass` 一枚抓着，
   `--max-steps` 撞帽这件事**不进 `readings.json` 任何字段**（`commands.md:3-7` 已自认「预算未知」）。

---

## 五、只能补一格的话：补**读数身份键**（`headSha` + `ranAt`，顺带 `maxSteps`/`reps`）

### 为什么是这一格

对账表已经写完并**在等这个形状**：`scripts/eval/report.ts` 的 `Row` 已有 `headSha`/`ranAt`（`:29-32`）、
`parseReadings` 已同时兼容 `r` 内层与记录外层（`:144-145`）、`IDENTITY_KEYS` 与身份闸已落
（`:219-240`），判卷 45 条在 `tests/eval-report.test.ts`。
**缺的只有写侧**：`scripts/loop-eval.ts` 的 `Reading` 接口（`:306-338`）与落盘那一行（`:737`）没有这两枚键 ⇒
身份闸**永远咬**（`report.ts:215-218` 自陈「今天一定会咬」，出口码 3/5），
于是盘上 12+12+36+49 趟语料的任何 A/B **只能当量级、不能当结论**——
而「持续迭代」那一半要的正是"这次改动到底有没有变好"这个裁决。
**盘上普查（现读 31 份 `readings.json`）**：19 份是 loop-eval 的 `{r,g}` 形状（`eval-report` 读得动）、
12 份是 `ga-strategy` 的 `{caseId, arms}` 对象形状（`report.ts:122`「顶层不是数组」⇒ **直接抛**，对账面今天吃不到它们）；
**含 `headSha` 的 0 份、含 `ranAt` 的 0 份** ⇒ 身份闸对盘上全部语料必咬（`report.ts:233-240` 的 `identityOf` 是 fail-closed）。
补上写侧键，下一趟起 19+ 份这一族才从"量级"升成"可比"；顺手把 ga-strategy 的落盘形状（HEAD `scripts/ga-strategy.ts:264`）
对到同一形状，那 12 份也进得来。
副产物：把 `maxSteps`/`reps` 同笔盖进去，直接封掉 §4.2.3 那条「撞帽的趟次预算不可知」。

### 涉及文件：干净还是在飞

| 文件 | 状态 | 现读依据 |
|---|---|---|
| `scripts/loop-eval.ts`（要动：`Reading` 加 2–4 字段、`runOnce` 赋值、`writeFile` 那行） | **干净** | `git status --porcelain` 空 |
| `scripts/eval/report.ts`（**不用动**，读侧已就绪） | 干净 | `:29-32`、`:144-145`、`:219-240` |
| `package.json`（若顺手把 `--keep`/`--max-steps` 对齐留档那档） | 干净 | `:52` |
| `tests/eval-report.test.ts`（加一条"有身份键 ⇒ 闸不咬"的正控） | 干净 | 45 条已存在 |
| `tests/eval-heldout.test.ts`、`scripts/lib/eval-heldout.ts`、`scripts/replay/corpus.ts`、`src/agent/eval/task-set.ts`、`scripts/mutate-verify.mjs` | **在隔壁手里（脏）** ⇒ 本次刻意不碰 | `git status --porcelain` |

⇒ **动的那三个文件全在干净侧**，不与任何在飞改动相撞；`fixtures/bench/tasks.json` 也干净，
若选择补 held-out 覆盖（次优方案）同样不撞脏面，但 `eval-heldout.ts`/其判卷在飞。

### 量级

- 写侧 **约 6–10 行**（4 枚字段 + 4 个赋值 + 落盘不动）；判卷 **2 条**（身份齐 ⇒ 闸不咬的正控、缺任一 ⇒ 咬）。
- 变异锚点 **1 枚**（摘掉 `headSha` 赋值 ⇒ 判卷必须红）；落点 `scripts/mutate-verify.mjs` 是**脏文件** ⇒ 那一枚要等隔壁那笔落库，
  或按本仓惯例先只补判卷、锚点单独一笔。
- 零模型花费：不跑任何真趟次就能验（判卷吃构造出来的 `readings.json`）。
- **不能顺手解决的**：存量语料仍然没有键 ⇒ 身份闸对 `bench-reps3-2026-10-02`、
  `eval-base-a|b`、`bench-head-d0ffe15e-*` 这些历史档**继续咬**，这是设计意图（`report.ts:193`
  「取不到＝未证，不是通过」），补了也只是让**下一趟起**可比。

### 次优的两格（供对照，量级都更大）

1. **held-out 覆盖从 2/12 提到 12/12**：治的是「哄绿可见测试 = 修对根因」那一整类假绿，
   杠杆最高但每格要人写隐藏测试并核不变量（`src/agent/eval/task-set.ts` HEAD `:114-124`：隐藏文件不许住在靶子里）。
   `fixtures/bench/tasks.json` 干净，但 `scripts/lib/eval-heldout.ts` + `tests/eval-heldout.test.ts` **都在飞**。量级：12 份测试文件 + 12 段任务书。
2. **把 §4.2.1 那条通路走通一次**：拿 `outputs/eval-b4-diag/` 或 `-b` 那趟 B10 的 `events.jsonl` 跑一次
   `scripts/gym-draft.ts --apply` 产出第一份 `fixtures/gym/drafts/<id>`，再 `--check` 让 `promoteBlockers` 点名缺哪几件。
   两支脚本都**干净**，量级最小（一次人工补件），但**冻结/提升仍必须是人的动作**（HEAD `scripts/gym-draft.ts:1-6` 明写）。
