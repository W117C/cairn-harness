# 证据与原始输出（2026-10-21）

> 全部命令在仓库根 `deepseek harness/` 下执行。A–D 量的是**工作树**，不是 `HEAD` 认证。
> 原始日志保存在 `outputs/evolution-kernel-study-2026-10-21/logs/`。

## 0. 环境与前提

```
$ git rev-parse HEAD
6af24734ba957838e5584e01228499e5e77b61e9

$ git status --short | wc -l
127

$ git status --short | grep -E 'PROGRESS.md|BLOCKED.md|outputs/evolution-kernel-study'
 M PROGRESS.md
?? outputs/evolution-kernel-study-2026-10-21/
```

- 任务写的相对路径根 `/Users/ze/Downloads/Cairn` **不是 git 仓库**；真实仓库根是
  `/Users/ze/Downloads/Cairn/deepseek harness/`。HEAD 与任务给定值一致。
- 工作树有 127 项他人未提交改动；本轮未 reset/stash/清理/提交任何他人改动。
- 本轮新增仅 `outputs/evolution-kernel-study-2026-10-21/**`；`PROGRESS.md` 只追加本页；
  `BLOCKED.md` 只追加本轮小节。生产代码、判卷、fixtures、门脚本、权限、全局配置零改动。

## 1. A–D 基线（工作树）

### A. 进化相关判卷

命令：

```sh
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
  tests/evolution.test.ts tests/evolution-registry.test.ts tests/evolution-install.test.ts \
  tests/evolution-plane.test.ts tests/evolution-canary.test.ts tests/post-run-readings.test.ts
```

退出码：**0**。原始输出（末尾）：

```
 RUN  v5.0.0 /Users/ze/Downloads/Cairn/deepseek harness

 Test Files  6 passed (6)
      Tests  150 passed (150)
   Start at  16:59:29
   Duration  841ms (transform 51%, tests 37%, import 11%, worker 1%)
```

有效测试数：**6 文件 / 150 用例通过**。

### B. 类型检查

命令：

```sh
node --import tsx scripts/typecheck.ts
```

退出码：**0**。原始输出：

```
typecheck: tsc --noEmit 通过（0 条报错）✅
```

### C. 真实任务可行性

命令：

```sh
node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json --feasibility
```

退出码：**0**（仅表示检查完成，不代表能力通过）。原始输出：

```
[feasibility] B1-bugfix-crossfile        不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B2-feature-export          不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B3-refactor-callsite       不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B4-bugfix-pagination       不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B5-bugfix-async            不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B6-feature-flag            不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B7-feature-csv             不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B8-feature-memo            不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B9-refactor-rename         不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B10-refactor-dedupe        不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B11-refactor-signature     不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] B12-long-horizon           不可跑 ← 缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过
[feasibility] 逐名格：0 / 12 条带 judge 规格（FAIL_TO_PASS 合计 0 条／PASS_TO_PASS 合计 0 条）⇒ 这一批**没有一条**有第二半尺 ⇒ 「该转绿的没绿」与「该保住的坏了」仍只在同一枚退出码上同形
[feasibility] 工具链自检 ✅ node --version
[feasibility] 可跑 0 / 分母 12（未发任何模型请求 ⇒ 零花费）
[feasibility] 装配面（产品缺省开的键 ↔ 本跑器）：autoMemory:off-here autoVerify:same ctrlTabCycle:not-applicable impactAnalysis:off-here promptCache:off-here subagentTools:same
⇒ 12 条任务全部不可跑 ⇒ 基准读数无从谈起，先看 blockers 里缺什么
```

结论：真实任务成功率与成本收益**未验证**；不得写成 0% 成功率。

### D. 空任务集拒绝

命令：

```sh
node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json \
  --only __leader_nonexistent_case__ --feasibility
```

退出码：**1**。原始输出：

```
[loop-eval] --only 筛完一条不剩（这是指令写错了，不是「零通过率」）
```

## 2. 生产调用链证据

```
src/main/agent-runner.ts:1242-1247
  let evolutionNote = "";
  try { evolutionNote = await evolutionPromptNote(opts.workspace); }
  catch { evolutionNote = ""; }

src/main/agent-runner.ts:1287
  provider: createProvider(promptText, systemPromptFor(opts.mode) + evolutionNote, ...)

src/main/agent-runner.ts:1548-1552
  await emitPostRunReadings({ logPath: opts.logPath, workspace: opts.workspace, ... });

src/main/post-run-readings.ts:69-77
  const evo = await runEvolution(events, input.workspace, input.sessionId ?? input.logPath);

src/agent/evolution/index.ts:57-95
  runEvolution：extractSignals → evaluatePatchEffects → strategyPatches → carryOverPatches
               → evolutionAdvice → persistEvolution(.agent/evolution.json)
  evolutionPromptNote：loadEvolution → renderPatches + renderEffects + renderAdvice
```

判定：建议闭环是**真实执行**且**影响下一轮 system prompt**；但没有配对任务/判据，**收益未证**。

## 3. 控制平面「有组件、无生产消费者」证据

命令：

```sh
grep -rn --include='*.ts' -E "EvolutionPlane|submitProposal|installApprovedProposal|CanaryController" src scripts apps
```

结果：仅命中定义文件本身；无生产 import。`grep -rln` 结果：

```
tests/evolution-canary.test.ts
tests/evolution-plane.test.ts
```

同类：

```sh
grep -rn --include='*.ts' -E "RuntimeLoader|LOADABLE_KINDS|tickAll|begin\(" src scripts apps
```

结果：仅 `src/main/evolution/canary.ts` 自身定义；无外部调用者。

`STATE.md:47` 原文：

```
| 进化面：canary 控制器尚未在生产接线 | `PROGRESS.md` 第 619 页 |
```

`sema-proposal.md` 的自我边界：

- §11（第 235-239 行）：「运行面装载」（installed → src/agent 生效、桌面挂载）不在 Phase 2 落。
- §12（第 269-272 行）：desktop-panel 的运行面装载仍不在本笔，到「指针切上、账本可回滚」为止。

结论：**组件存在 ≠ 真实执行 ≠ 影响下一轮 ≠ 证明收益**。真实断点是装载与观察，而非生成。

## 4. 外部原始资料（版本核对）

| 资料 | 抓取方式 | 版本/日期 | 可复用点 | 不适用点 |
|---|---|---|---|---|
| DGM — Darwin Gödel Machine, arXiv:2505.22954 | `https://arxiv.org/abs/2505.22954`（2026-10-21 抓取） | Submitted 29 May 2025 | 版本档案树、父→子谱系、经验证而非形式证明、沙箱+人工监督 | 开放式自改代码搜索空间过大；当前无 judge 规格/凭据；会触 TCB |
| GEPA — Reflective Prompt Evolution, arXiv:2507.19457 | `https://arxiv.org/abs/2507.19457`（2026-10-21 抓取） | Submitted 25 Jul 2025 | 用执行轨迹做自然语言反思、Pareto 前沿、组合互补经验、比 RL 少 rollout | 针对 prompt；摘要未给失败模式/候选预算细节；不足以直接证明 Cairn 收益 |
| MiroFish — 666ghj/MiroFish | `https://raw.githubusercontent.com/666ghj/MiroFish/main/README.md`（2026-10-21 抓取；GitHub API 限流） | README 当次内容 | 多 agent 沙盘可作为**可选候选生成手段** | 完整社会模拟/预测平台，与 Cairn 任务无关，不引入 |

DGM 摘要关键句（抓取页）：archive 扩展为分支树；agent 修改自身实现；用 coding benchmarks 经验验证；
报告 SWE-bench 20.0%→50.0%、Polyglot 14.2%→30.7%；「All experiments were done with safety precautions
(e.g., sandboxing, human oversight).」

GEPA 摘要关键句（抓取页）：从轨迹（reasoning / tool calls / tool outputs）做自然语言反思；
用自身尝试的 Pareto 前沿并组合互补经验；六任务上比 GRPO 平均高 6%、最高 20%，rollout 最多少 35 倍。

## 5. 最小机制实验（本轮实际结果）

源码：`outputs/evolution-kernel-study-2026-10-21/experiment/`
- `run.ts`：编排（真实调用 ModuleRegistry / EvolutionPlane / GateRunner / Installer / CanaryController）
- `consumer.ts`：真实经 `RuntimeLoader` 装载 active content-pack，再产出报告
- `check-pack.mjs`：实验本地预装门（只查静态形状，故意不查运行期正确性）
- `judge.mjs`：独立判据（只读任务输入与产物，不读 recipe / 账本）

运行数据：临时目录 `$TMPDIR/cairn-evo-XXXXXX`（路径记录在 `logs/experiment-workspace.txt`）。

### 5.1 phase1 原始输出（退出码 0）

```
[exp] submitted content-pack.report-recipe@1.0.0 staging=.../modules/staging/content-pack.report-recipe/1.0.0
[exp] gates 1.0.0 => [{"gate":"pack-check","passed":true}]
[exp] baseline artifact producer=1.0.0 judge={"ok":true,"checks":{"summary":true,"citations":true,"status":true},"producerVersion":"1.0.0","artifactDigest":"sha256:15617fa23e3aff34db4974867dd28fbb63a5a84106a60c2bdd9ad0f118f7b8ee"}
[exp] submitted content-pack.report-recipe@1.1.0 staging=.../modules/staging/content-pack.report-recipe/1.1.0
[exp] gates 1.1.0 => [{"gate":"pack-check","passed":true}]
[exp] candidate 1.1.0 artifact producer=1.1.0 judge={"ok":true,"checks":{"summary":true,"citations":true,"status":true},"producerVersion":"1.1.0","artifactDigest":"sha256:f3d77085068b1d4ccc9e760591538f7fe5b2bcab75eb9c2db0fd6280064b1c6f"}
[exp] canary begin 1.1.0 => {"id":"content-pack.report-recipe","candidateVersion":"1.1.0","previousVersion":"1.0.0","state":"observing","samples":0,...,"maxSamples":1,...,"recordWritten":true}
[exp] canary tick 1.1.0 => [{"id":"content-pack.report-recipe","outcome":"resumed","observation":{...,"state":"promoted","samples":1,...,"recordWritten":true},"acted":true}]
[exp] submitted content-pack.report-recipe@1.2.0 staging=.../modules/staging/content-pack.report-recipe/1.2.0
[exp] missing-evidence install refused => InstallRefusedError: content-pack.report-recipe@1.2.0 未过全门（pack-check）——未过验证的包不进安装序
[exp] gates 1.2.0 => [{"gate":"pack-check","passed":true}]
[exp] candidate 1.2.0 artifact producer=1.2.0 judge={"ok":false,"checks":{"summary":false,"citations":false,"status":true},"producerVersion":"1.2.0","artifactDigest":"sha256:edddc8159143c690ca0dba4efc0165df7566cd2553d8f094a66413d3f19e496d"}
[exp] canary begin 1.2.0 => {"id":"content-pack.report-recipe","candidateVersion":"1.2.0","previousVersion":"1.1.0","state":"observing","samples":0,...,"maxSamples":10,...,"recordWritten":true}
[exp] canary tick 1.2.0 red#1 => [{"id":"content-pack.report-recipe","outcome":"resumed","observation":{...,"state":"observing","samples":1,"consecutiveFailures":1,...,"recordWritten":true},"acted":false}]
[exp] canary tick 1.2.0 none#2 => [{"id":"content-pack.report-recipe","outcome":"resumed","observation":{...,"state":"observing","samples":2,"consecutiveFailures":1,...,"recordWritten":true},"acted":false}]
[exp] phase1 done; canary record on disk = .../.agent/canary/content-pack.report-recipe.json
```

要点：
- 候选 1.1.0 的真实产物 `producerVersion=1.1.0` 且判据全绿 ⇒ **生效**不是只看指针。
- 1.2.0 先因**缺门证据**被安装序拒绝（原始拒绝如上）。
- 1.2.0 过静态门后，运行期判据 `summary=false, citations=false` ⇒ 故意退化被独立判据抓到。
- `none` 样本让 `samples 1→2`，但 `consecutiveFailures` 保持 1、`acted=false` ⇒ **缺证据不判绿也不判红**。

### 5.2 phase2 原始输出（新进程；退出码 0）

```
[exp] restart tick 1.2.0 red#3 => [{"id":"content-pack.report-recipe","outcome":"resumed","observation":{"version":1,...,"candidateVersion":"1.2.0","previousVersion":"1.1.0","state":"rolled-back","samples":3,"consecutiveFailures":2,...,"degradations":[{"rule":"consecutive-failures","detail":"连续 2 个样本 verify 未转绿"}],...,"rollbackTo":"1.1.0",...,"lessonWritten":true,"recordWritten":true},"acted":true}]
[exp] registry after rollback: active=1.1.0 previous=1.2.0
[exp] restored artifact producer=1.1.0 judge={"ok":true,"checks":{"summary":true,"citations":true,"status":true},"producerVersion":"1.1.0","artifactDigest":"sha256:f3d77085068b1d4ccc9e760591538f7fe5b2bcab75eb9c2db0fd6280064b1c6f"}
```

要点：
- 新进程空内存，`samples` 从盘上续到 3（不是 1）⇒ **重启续跑**成立。
- `consecutiveFailures=2` 命中规则 ⇒ `state=rolled-back`，`rollbackTo=1.1.0`。
- 回滚后真实产物回到 `producerVersion=1.1.0` 且判据全绿 ⇒ **回退是行为层面的还原**，不只是指针。
- `lessonWritten=true`，lesson 文件见下。

### 5.3 观察档（原始）

```json
{
  "version": 1,
  "id": "content-pack.report-recipe",
  "candidateVersion": "1.2.0",
  "previousVersion": "1.1.0",
  "state": "rolled-back",
  "samples": 3,
  "consecutiveFailures": 2,
  "baselineTokensPerBoundary": null,
  "maxSamples": 10,
  "maxConsecutiveFailures": 2,
  "costDegradeFactor": 2,
  "degradations": [{ "rule": "consecutive-failures", "detail": "连续 2 个样本 verify 未转绿" }],
  "startedAt": "2026-10-21T09:03:10.188Z",
  "rollbackTo": "1.1.0",
  "endedAt": "2026-10-21T09:03:14.432Z",
  "lessonWritten": true
}
```

### 5.4 账本事件（原始，节选）

```
{"op":"register",...,"version":"1.0.0",...,"gates":["pack-check"],"actor":"evolution-plane-pipeline-v1"}
{"op":"gate",...,"version":"1.0.0","gate":"pack-check","passed":true,"actor":"gate-runner"}
{"op":"activate",...,"version":"1.0.0","actor":"owner-human"}
{"op":"register",...,"version":"1.1.0",...}
{"op":"gate",...,"version":"1.1.0","gate":"pack-check","passed":true,"actor":"gate-runner"}
{"op":"activate",...,"version":"1.1.0","actor":"owner-human"}
{"op":"register",...,"version":"1.2.0",...}
{"op":"gate",...,"version":"1.2.0","gate":"pack-check","passed":true,"actor":"gate-runner"}
{"op":"activate",...,"version":"1.2.0","actor":"owner-human"}
{"op":"rollback",...,"id":"content-pack.report-recipe","actor":"canary"}
```

### 5.5 候选档案（原型；原始）

`1.1.0.json`：

```json
{
  "id": "content-pack.report-recipe",
  "version": "1.1.0",
  "parentVersion": "1.0.0",
  "contentDigest": "sha256:9befa222838e07ad507b8e57345676dbb11005839502b6e1d9cc1ea64467678e",
  "generator": { "kind": "handwritten-demo", "model": null, "tools": [] },
  "taskSet": { "id": "tiny-report", "version": "1", "digest": "sha256:handwritten-demo" },
  "transform": "good",
  "evaluation": {
    "status": "passed",
    "runs": [{ "runId": "run-good-1", "ok": true, "artifactDigest": "sha256:e36b...", "costUsd": 0, "failureReason": null }]
  },
  "approvedBy": "owner-human"
}
```

`1.2.0.json`（节选）：

```json
{
  "version": "1.2.0",
  "parentVersion": "1.1.0",
  "contentDigest": "sha256:ddfab55d0574c9afbd670c4fa7ba9d607745da6c999feddffdfd0debf23e7aa0",
  "generator": { "kind": "handwritten-demo", "model": null, "tools": [] },
  "evaluation": {
    "status": "rolled-back",
    "runs": [
      { "runId": "run-bad-1", "ok": false, "failureReason": "judge red" },
      { "runId": "run-bad-2-none", "ok": null, "failureReason": "no evidence (none)" },
      { "runId": "run-bad-3-after-restart", "ok": false, "failureReason": "consecutive failure limit" }
    ],
    "rollbackTo": "1.1.0"
  }
}
```

### 5.6 canary lesson（原始）

```
SEMA canary：content-pack.report-recipe@1.2.0 观察期退化（consecutive-failures），已回退到 1.1.0
session-line:canary
- consecutive-failures：连续 2 个样本 verify 未转绿
evidence-line:[canary] content-pack.report-recipe@1.2.0 · run=run-bad-3-after-restart · samples=3
```

### 5.7 独立复跑（全新临时工作区）

命令同 §7 的机制实验，换一个新的 `mktemp -d` 工作区；原始日志 `logs/experiment-rerun.log`。
关键行与首跑逐字一致（时间戳除外）：

```
baseline artifact producer=1.0.0 judge={"ok":true,...,"artifactDigest":"sha256:15617fa2..."}
candidate 1.1.0 artifact producer=1.1.0 judge={"ok":true,...,"artifactDigest":"sha256:f3d77085..."}
missing-evidence install refused => InstallRefusedError: ... 未过全门（pack-check）
candidate 1.2.0 artifact producer=1.2.0 judge={"ok":false,"checks":{"summary":false,"citations":false,"status":true},...}
canary tick 1.2.0 none#2 => ..."samples":2,"consecutiveFailures":1,...,"acted":false
restart tick 1.2.0 red#3 => ..."state":"rolled-back","samples":3,"consecutiveFailures":2,...,"rollbackTo":"1.1.0"
registry after rollback: active=1.1.0 previous=1.2.0
restored artifact producer=1.1.0 judge={"ok":true,...,"artifactDigest":"sha256:f3d77085..."}
PHASE1_EXIT:0
PHASE2_EXIT:0
```

两次复跑的产物摘要相同 ⇒ 实验不依赖上一次工作区状态。

## 6. 哪些步骤真实执行、哪些仅演示

| 步骤 | 性质 | 说明 |
|---|---|---|
| 生成候选 | **仅演示** | 手写 content-pack；无模型请求 |
| 提交/契约校验/落 staging | 真实执行 | `EvolutionPlane.submitProposal` |
| 预装门 | 真实执行（实验本地门） | `GateRunner` + `check-pack.mjs`；不是仓库 GATES |
| 安装/指针/previous | 真实执行 | `Installer.installStaged` |
| 状态存储/账本 | 真实执行 | `ModuleRegistry`（JSONL + 重建索引） |
| 内容装载 | 真实执行 | `RuntimeLoader.load` 读 installed 包 |
| 任务运行 | **仅演示** | 脚本化 consumer，不是模型 |
| 判定 | 真实执行（独立本地判据） | `judge.mjs`，只读任务输入与产物 |
| 观察/退化/回退/续档 | 真实执行 | `CanaryController.begin/tickAll`、`Installer.rollbackInstalled` |
| 候选档案 | **演示原型** | sidecar 由实验脚本写；生产尚无此模块 |
| 生产接线 | **未做** | `post-run-readings` / `agent-runner` 未改 |

## 7. 复跑方法

```sh
cd "/Users/ze/Downloads/Cairn/deepseek harness"

# A–D
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
  tests/evolution.test.ts tests/evolution-registry.test.ts tests/evolution-install.test.ts \
  tests/evolution-plane.test.ts tests/evolution-canary.test.ts tests/post-run-readings.test.ts
node --import tsx scripts/typecheck.ts
node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json --feasibility
node --import tsx scripts/loop-eval.ts --tasks fixtures/bench/tasks.json --only __leader_nonexistent_case__ --feasibility

# 机制实验
WS=$(mktemp -d "$TMPDIR/cairn-evo-XXXXXX")
node --import tsx outputs/evolution-kernel-study-2026-10-21/experiment/run.ts phase1 "$WS"
node --import tsx outputs/evolution-kernel-study-2026-10-21/experiment/run.ts phase2 "$WS"
```

## 8. 限制

- 未发任何模型请求；无模型凭据；候选与任务是脚本化 demo ⇒ **能力收益未验证**。
- 12/12 bench 任务无逐名 judge 规格 ⇒ 真实任务无法做「正确性优先」的配对评价。
- 实验门/判据是实验本地实现，不是仓库 GATES / 冻结判卷；不得当作生产门证据。
- 生产接线未施工；本轮的生效/回退证据只覆盖实验工作区。
- 未跑 `pnpm gates` / `mutate-verify` / `head-cert`；它们量的是提交，而本轮无提交。

## 9. 首期接线施工（2026-10-21 续）

本轮按 `design.md` §6.1 白名单施工；仍未提交（工作树含他人 127 项改动，提交需业主明确指示）。

### 9.1 新增 / 修改

新增：
- `src/main/evolution/candidate-record.ts` — 候选 sidecar schema、排序摘要、原子读写、fail-closed 校验。
- `src/main/evolution/evaluator.ts` — 配对评价编排（正确性优先，再成本/耗时；缺证据不晋升）。
- `src/main/evolution/activation-host.ts` — active content-pack 装载 + 收束 `tickCanaryFromSignals`。
- `scripts/evolution-eval.ts` — TCB 评价入口；真实执行面由 `--runner` 注入，缺它退出 2。
- `tests/evolution-kernel.test.ts` — 12 条判卷。

修改：
- `src/main/post-run-readings.ts` — `runEvolution` 后把同一份 signals 喂 `tickCanaryFromSignals`。
- `src/main/agent-runner.ts` — 在 `evolutionNote` 同一装配缝追加 active content-pack 文本（并入同一变量，
  保持 `provider` 行的既有行锚定不变）。

未改：`src/permissions/`、冻结判卷、`fixtures/`、既有测试断言、`apps/desktop/` 边界、全局配置。

### 9.2 判卷读数（工作树）

```
$ node --import tsx scripts/typecheck.ts
typecheck: tsc --noEmit 通过（0 条报错）✅
EXIT 0

# 进化面 + 新判卷
$ node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
    tests/evolution.test.ts tests/evolution-registry.test.ts tests/evolution-install.test.ts \
    tests/evolution-plane.test.ts tests/evolution-canary.test.ts tests/post-run-readings.test.ts \
    tests/evolution-kernel.test.ts
Test Files  7 passed (7)
     Tests  162 passed (162)
EXIT 0

# 改动接缝
$ node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts \
    tests/base-system-discipline.test.ts tests/system-prompt-mode-contract.test.ts \
    tests/head-import-face.test.ts tests/wiring-coverage.test.ts tests/runner-gates.test.ts \
    tests/run-admission.test.ts tests/prompt-surface-check.test.ts
Test Files  7 passed (7)
     Tests  116 passed (116)
EXIT 0
```

全量核心（**出沙箱**；沙箱内 29 个 `listen 127.0.0.1 EPERM` 假红，见 `logs/wired-full-core.log`）：

```
$ pnpm test
Test Files  454 passed (454)
     Tests  6236 passed (6236)
EXIT 0
```

桌面（**出沙箱**；沙箱内 5 条 Electron Mach 端口 / PTY 假红，见 `logs/wired-desktop.log`）：

```
$ pnpm --filter cairn-desktop test
Test Files  169 passed (169)
     Tests  1224 passed (1224)
EXIT 0
desktop-boundary-check: 绿（src 无反向依赖、无 UI import）
```

文档门与边界：

```
$ pnpm docs-check
docs-check: 受检项全绿
EXIT 0

$ pnpm desktop-boundary-check
desktop-boundary-check: 绿（src 无反向依赖、无 UI import）
EXIT 0
```

诚实记录：出沙箱全量首跑有 1 条 `tests/lsp-request-lifecycle.test.ts` 失败（取消与请求同批到达的竞态），
单独连跑 3 次均 24/24 通过 ⇒ 全量并发下的抖动，与本轮改动无调用关系；随后全量复跑 454/6236 全绿。

`pnpm gates`（出沙箱）读到：**28 道门绿**（含 typecheck / test / e2e / docs-check / prompt-surface-check /
head-import-check / repo-hygiene-check / sandbox:check / security-check 等）；`head-cert-check` 红：
它量的是 **HEAD `6af2473`**（不含本轮未提交改动），`tests/main-run-routing.test.ts` 一条超时
（33103ms / 30000ms）。`mutate-verify` 随后启动，因同样只量 HEAD 且需约 35 分钟，已停止后台任务。
原始日志：`logs/wired-gates.log`；HEAD 认证失败明细：`/tmp/dsh-head-cert-6af2473/test.log:1848`。

### 9.3 机制实验（走新生产缝）

`logs/experiment-wired.log`，phase1/phase2 退出码均 0：

```
baseline artifact producer=1.0.0 judge={"ok":true,...}
candidate 1.1.0 artifact producer=1.1.0 judge={"ok":true,...}
canary tick 1.1.0 => state=promoted, samples=1
missing-evidence install refused => InstallRefusedError: ...@1.2.0 未过全门（pack-check）
candidate 1.2.0 artifact producer=1.2.0 judge={"ok":false,"checks":{"summary":false,"citations":false,"status":true}}
canary tick 1.2.0 red#1 => samples=1, consecutiveFailures=1, acted=false
canary tick 1.2.0 none#2 => samples=2, consecutiveFailures=1, acted=false
restart tick 1.2.0 red#3 => state=rolled-back, samples=3, rollbackTo=1.1.0
registry after rollback: active=1.1.0 previous=1.2.0
restored artifact producer=1.1.0 judge={"ok":true,...}
```

收束 tick 现在经 `activation-host.tickCanaryFromSignals`（生产缝），候选档案经 `candidate-record`。

### 9.4 TCB 评价入口（脚本化 runner）

```
$ node --import tsx scripts/evolution-eval.ts --tasks ... --baseline 1.1.0 --candidate 1.2.0
[evolution-eval] 缺 --runner（真实执行面必须由 TCB 注入；本脚本不内置模型调用）
EXIT 2

# 脚本化 runner（demo，成本基线 1.0 / 候选 0.5）
[evolution-eval] passed / promote · 正确性不劣；成本 6 ≤ 基线 12 的 0.95 倍
EXIT 0

# runner 全失败
[evolution-eval] unmeasurable / keep-old · 有 24 个 run 没有可判证据 ...
EXIT 0
```

`--record` 指向的候选档案被更新为对应 `evaluation/runs`（原始 JSON 见 `logs/eval-promote.json`、
`logs/eval-unmeasurable.json`）。

### 9.5 未完成 / 未验证

- **未提交**：工作树包含他人 127 项改动；本轮只新增/修改白名单文件，未 reset/stash/提交。
- **能力收益仍未验证**：未发模型请求；`--runner` 是脚本化 demo，不是真实 agent 执行。
- **真实任务配对仍缺判据**：`fixtures/bench/tasks.json` 12/12 无逐名 judge 规格（C 读数）。
- `pnpm gates` 的读数是 28 绿 + `head-cert-check` 红（HEAD 上的 `main-run-routing` 超时，与本轮未提交改动无关）；
  `mutate-verify` 只量 HEAD、约 35 分钟，已停止。`mutate-verify` / `head-cert` 都不覆盖未提交工作树。
