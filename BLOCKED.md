# Blocked

## 2026-10-25 00:19 · cn:hy4-preview 没有可用的 low 档

- 模型表写明：`only_reasoning: true`、`reasoning_supported_efforts: ["high"]`、默认 `high`；没有 low。
- 实测探针：low 的 reasoning_tokens 22/33/91，high 53/105/44；`off` 46/52、不传字段 25/63。
  三档都还在推理，且 low/high 区间重叠 ⇒ low 不能当独立低档臂，跑出来的“low”是假的。
- 按「API/模型报 reasoning 不支持就停」处理：**未启动 pilot，未写任何读数**。要 low/high 对照，
  换 `cn:minimax-m3.1-flash`、`cn:deepseek-v4-flash` 或 `cn:step-5-preview`（三者都声明 low+high）。

## 2026-10-25 00:01 · L32 3 对 rep：单趟差异是噪声

- L32 @60 各 3 对：low **3/3**（262,949 / 232,440 / 66,096 tokens），high **3/3**
  （98,148 / 145,451 / 62,974）。之前单趟「low 0/32、high 32/32」不可复现，已从主结论撤回。
- **high 没有多修好任何一条**；token 代理 low 平均 187,162、high 102,191（−45.40%），但 B12 −48.29%、
  B1 +55.30%，方向不一致；实付 `cny=0`，`$/success` 百分比不可知。
- 结论：这套题对该模型没有成功率上的 thinking 收益；主实验若只看「多修几条」，3 对已够。
  要检测几个百分点的差异，需要更多题/更多任务，不是只加 L32 rep。没有新的阻塞项。
- 预算：GLM 累计 **3,383,233 in / 96,417 out**；用户明确「没有预算」，不再按 2M 帽停。

## 2026-10-24 23:42 · L32 @60 找到差异；外部适配器不再是必需

- **L32 @60 配对**：low FAIL 0/32（60 请求，1,092,735 in / 14,057 out，撞 `maxSteps=60`）；
  high PASS 32/32（8 请求，60,782 in / 5,129 out，86s）。同模型、同 `max-steps`，只换 thinking。
  这是本轮唯一「low 失败、high 成功」的配对；high 同时少用约 94% token。n=1，尚无方差。
- **主实验**：同一 L32、同 `max-steps=60`，low/high 各 3 对 rep；3 是预注册最低档，不是从这对
  读数算出的方差。B12/B1 已封顶，不应作为主实验题。
- **外部集**：仍受 `scripts/loop-eval.ts:473`（`t.external` 直接抛）与 `:829`（含 external 直接
  exit 1）限制，要外推需另立适配器；但回答本问题已不必先做外部适配器。
- **预算**：GLM 累计 **2,515,175 in / 57,920 out**，越过 2M input 帽；停止。

## 2026-10-24 23:35 · 外部集接不了；L48 也封顶

- **L48-long-chain low 也 48/48**（`max-steps=55`，11 请求，96,037 in / 8,212 out，150s）⇒ 预注册的
  L48 也是天花板，high 上界同为 48/48，未跑 high；不再在仓库 16 题里换题。
- **外部题集（SWE-bench 类）当前跑器接不了**：`scripts/loop-eval.ts:473` 对 `t.external` 直接抛
  「本跑器跑不了」，`:829` 在任务集含 external 时 exit 1；`--feasibility` 只能量缺口。
  `outputs/eval-benchmark-adapter-2026-09-24/swebench-sample.jsonl` 只有两行样本且第二行缺
  `FAIL_TO_PASS`；`docs/optimization-plan-2026-10-02.md:185` 已裁「缺快照 fetch + 语言侧判卷适配」。
  要真跑外部集，需新增外部快照/仓库、pytest/语言适配、任务生成器和预算——是新流程/新依赖，
  按任务规矩只登记，不在本笔擅自加。
- **预算**：GLM 累计 **2,454,393 in / 52,791 out**，越过 2M input 帽；停止。此前 hy3/OpenRouter 另计。
- **可选但未做**：换一个会在 B12/L30/L48 掉分的模型，或授权外部基准适配器；二者都需要用户拍板。

## 2026-10-24 23:03 · 停止换题：L30 也封顶，继续挑题就是过拟合

- 收到「注意不要过拟合」后不再 task shopping。最后一个预注册替代 L30-long-horizon low 跑出 **30/30**
  （`namedSets.notGreen=0`，8 请求，78,433 in / 4,949 out，92s）；low 已封顶，high 上界也是 30/30，
  不可能多修好，故不跑 high，也不再试 B5/B6/L48。
- B4/B7/B2 的三次探测只作换题探测记录，不进入主结论；若拿它们挑出「看起来有差异」的题再跑 high，
  就是按结果挑样本，不能回答 thinking 的因果问题。
- 现有题集对该模型没有可区分的部分成功样本；主实验应换**预注册的更难外部题集**，而不是继续在 12 题里挑。
- 预算：GLM 累计 **2,358,356 in / 44,579 out**，越过 2M input 帽；停止。

## 2026-10-24 23:00 · 换题探测：没有「部分成功」的题

- B4-low PASS（2/2）、B7-low PASS（5/5）⇒ 低档已满分，high 没有可提升空间，故不跑 high；这不是 high 的读数。
- B2-low 产品面 `verifyOkLast=true`、held-out 绿，但逐名判据 `unreadable`：judge 规格写 `tests/fit.test.js`，测试输出里对不上号（`unmatched=1`）。这是判据坏，不是模型失败；按任务规矩只登记不改判据。
- 结果：现有 12 题里，B4/B7 封顶、B12 封顶、L32 两臂撞步数帽、B2 判据不可读；没有一条能产生「low 失败、high 成功」的配对。继续加 rep 或换小工具题都不会回答 thinking 值不值。
- 预算：GLM 主线 2,163,176 in；换题探测后累计 **2,279,923 in / 39,630 out**，越过 2M input 帽；停止。

## 2026-10-24 22:50 · GLM-5.3-Flash pilot：B12 封顶 + L32 撞帽 + 预算越界

- **B12 两臂都 20/20**（`notGreen=0`），high 多修 0 条；B1 两臂都过。题集对 GLM-5.3-Flash 仍封顶。
- **L32 是地板不是刻度**：`max-steps=35` 两臂都因 `maxSteps` 中止；把 low 抬到 60 仍因 `maxSteps` 中止（60 请求，1,092,735 in / 14,057 out）。没有出现「一臂过、一臂不过」的部分成功样本，无法估 thinking 的边际收益；主实验应换一条能出现部分成功的题，而不是加 rep。
- **预算越界，已停**：GLM pilot 累计 **2,163,176 input / 37,333 output**，越过 2,000,000 input 帽；L32-high 60 未跑。此前 hy3/OpenRouter 的消耗另计，合计更高。该越界是执行事实，不冒充「仍在预算内」。
- **端点成本为 0**：`usage.credit=0`、模型表 `credits=x0.08`（仅倍率，不是账单），四趟 `cny=0`；`$/success` 实付为 0→0，百分比无分母；token 代理方向在 B1/B12 相反（+55.30% / −48.29%），不能当稳定结论。
- **模型别名**：用户给的 `glm5.3flash` 在上游返回 401 `no_healthy_account`；改用模型表精确 id `cn:glm-5.3-flash` 才跑通，读数只对该 id 有效。

## 2026-10-24 22:24 · hy3 pilot 的天花板（第 701 页）

- **B12 与 L32 都封顶，pilot 无法回答「多想值不值」**：B12-low/high 都是 20/20（`notGreen=0`），
  按止损加跑 L32-long-chain low，仍 32/32（`readings-l32-low.json`）。题集对 `hy3` 太容易，
  两臂没有可区分的失败样本；主实验若继续用这套题，增加 rep 只会重复满分。需要更难的题集，或
  换一个会在 B12/L32 上掉分的模型，才能量出 thinking 的边际收益。
- **原 OpenRouter 配额阻塞已由用户提供的本地端点解除**：`http://127.0.0.1:7863/v1`、模型 `hy3`；
  该端点 `usage.credit=0`、模型表 `credits=x0.00`，所以四趟 `cny=0`，`$/success` 的百分比没有
  非零分母；token 口径只能作代理（B12 high 比 low 少 7.07%），不能当美元账单。
- **原默认模型仍不可用**：`stealth/space-bunny-alpha` 404；`mimo-v2.6-flash` 403 未实名；
  `z-ai/glm-5.2` 402 无 credits。hy3 是用户明确指定后的替代，读数只对该模型有效。

The desktop layer removal of 2026-09-27 (`69fbb0d`) was followed by a reintroduced desktop shell
under `apps/desktop/` on 2026-10-02 (M1 slices), so this file's "core-only" premise had stopped holding;
doc alignment landed in README.md / docs/CODE-WIKI.md / docs/DOCS-MAP.md / docs/README.md.

[`docs/adr/0001-core-only-vs-desktop.md`](docs/adr/0001-core-only-vs-desktop.md) — status **Accepted
(scope decision)**, closed 2026-10-04: **the desktop layer is not a v1 delivery surface** (decision D1,
option A). Consequences, stated precisely so nobody reads them backwards:

- v1's delivery surface is core-only again, **but `apps/desktop/` still exists in the tree and is still
  being committed to**. "Not a v1 delivery surface" is a scope ruling, not a claim of absence.
- The desktop defects recorded in the 2026-10-03 technical review (unwired invoke channels, desktop
  outside the root gates / CI / cert surface) **remain true as defects** — they are merely off the v1
  acceptance surface. Do not read "moved out of scope" as "fixed".
- Consequently, no desktop item blocks v1 sign-off. Desktop work that is already in flight is not in
  conflict with this ruling.

The remaining verification surface is the agent/core test and headless-check surface. ⚠️ 本文件此前那句
「`apps/desktop` is not scanned by any root gate or CI」**在 2026-10-12 之后已失真**（第 476 页更正）：
`desktop-test`（145 条 + `desktop-boundary-check`）现在同时在 `GATES` 与 `CERT_GATES` 里，CI 也单跑
`pnpm --filter cairn-desktop test`。「桌面不属 v1 交付面」这条裁决保持不变——变的是"它没人看"这半句。

## 2026-09-30 · `tests/map-self-report.test.ts:95` 判据依赖 checkout 路径深度 —— **已解（第 476 页，2026-10-13）**

> 解法的形状：判据从「原因里含某个魔词」换成「原因按**身份**带着」（降级行里的原因＝构建器那条错误
> 本身、按 200 字截断），并给那个 200 字帽补了一只观测者（纯函数用例，长原因）。
> 造红证据：`outputs/map-degrade-criterion-476-2026-10-13/repro.log`（同一份错误串：前缀 40 字时旧判据绿、
> 104 字时旧判据红、而新判据三档全绿）。被锚的实现一个字没动。

**现象**：`地图降级要出声，并且不许被读成「仓库没有结构」` 这一条红，报
`expected '[map] 仓库地图本次不可用（原因：spawn …）' to contain 'rg'`。
本轮在嵌套 worktree（`…/goofy-satoshi-0edc69/.claude/worktrees/audit-zcode/`，前缀 104 字符）下必红。

**根因**（已追到代码，不是推断）：`src/agent/map/build.ts:190` 的 `mapUnavailableText` 把原因截到
**200 字**（`why.slice(0, 200)`），而这条测试的失败原因是一条 `spawn <rg 绝对路径> ENOENT`——
绝对路径长度 = 仓库根绝对路径 + `node_modules/.pnpm/@vscode+ripgrep-darwin-arm64@1.18.0/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg`。
根路径短于 ~90 字符时 `bin/rg` 落在 200 字内，断言绿；本 checkout 前缀 104 字符 ⇒ `rg` 被截在窗外 ⇒ 红。
（`build.ts:51` 的 `spawn(rgBinary(), args, { cwd: workspace })` 传了本测试故意指向的不存在目录，
Node 对缺失 `cwd` 返回 ENOENT，于是 rg 根本没跑起来，走了 spawn 错误而不是它本该有的退出码 2。）

**为什么不动代码**：`mapUnavailableText` 的 200 字截断是有理由的（注释原文：「那是别人的文本，不是我们承诺的长度」），
而 `tests/map-self-report.test.ts` 是冻结判卷文件。按纪律：判据有缺陷 ⇒ 换判据，不许改代码去绕。

**请求的判据替换**（任一即可，倾向第一条）：把 `expect(line).toContain("rg")` 换成对**原因非空且可辨**的断言
——例如 `expect(line).toMatch(/（原因：[^）]{8,}）/)`，判的是「模型看得见原因」这件真事，
而不是「原因里恰好含某个子串」这件与 checkout 路径深度耦合的假事。次选：让 `buildMap` 的失败原因只带
rg 的 basename（`rg`）而不带绝对路径——但那改的是被测代码，同样需要走换判据的流程。

## 2026-10-01 · 第 261 页（影响面持久化索引＋准确率基准）

无。本笔（任务 1/2/3：索引持久化＋增量、准确率基准、真仓探针固化）零阻塞项；「能力 10 真模型基准无凭据不做」沿用第 258 页裁决④，非新增阻塞。

## 2026-10-21 · 自进化内核路线调研（第 637 页）

- **能力收益不可测**：本机无 `CAIRN_API_KEY` / `CAIRN_ENDPOINT`，bench 12/12 不可跑；本轮只证明机制，
  不证明成功率或成本收益。解除条件：提供凭据并显式授权花费。
- **真实任务配对评价缺判据** —— ~~`fixtures/bench/tasks.json` 12/12 无逐名 judge 规格~~
  **已解（2026-10-22，第 640 页，工作树未提交）**：五份清单 15/15 条拿到 `judge` 两列，
  由盘上现读生成（`scripts/bench-judge-spec.ts`，不手抄），`--check` 门守漂移。
  `--feasibility` 从 `逐名格：0 / 12` 变成 `12 / 12（FAIL_TO_PASS 43 条／PASS_TO_PASS 13 条）`。
  ⚠️ **剩下的一半没解**：真实模型跑不出读数（见上一条「能力收益不可测」），
  所以这一格现在证的是「尺子在、且分得开两件事」，不是「模型做得好不好」。
- **路径前提差异**：任务写的 `/Users/ze/Downloads/Cairn` 不是 git 仓库；真实仓库根是
  `/Users/ze/Downloads/Cairn/deepseek harness/`。HEAD 与任务给定 `6af24734...` 一致，故 A–D 结论不受影响。
- **已知债（非本轮阻塞）**：`EvolutionPlane` / `GateRunner` / `Installer` / `PermissionBroker` / `GrantsStore`
  仍**只有判卷消费者**（`tests/evolution-*.test.ts`）——它们不是"忘了接"，是
  `docs/sema-proposal.md` §11 立案的**刻意分期**：Phase 4 才放开自动安装与自治分级，v1 的"跑通"定义到
  "指针切上、账本可回滚"为止。**接线的接线位在方案里写着，不是没人认领**。
  ⚠️ **同一条里另外三个名字已经不成立了**（2026-10-22 现读）：`CanaryController` / `RuntimeLoader` /
  `activation-host` 自第 638 页首期接线起就有**生产消费者**——`src/main/agent-runner.ts:57,1254`
  （content-pack 注进 system prompt）与 `src/main/post-run-readings.ts:14,79`（收束缝喂 canary tick）。
  原文那句"生产零消费者"是接线**之前**的读数，别再引它。
  `STATE.md` 的债表与第 640 页同笔改过。

### 2026-10-21 · 首期接线施工（第 638 页）补充

- **首期接线已落地、未提交**：`src/main/evolution/activation-host.ts`、`candidate-record.ts`、
  `evaluator.ts`、`scripts/evolution-eval.ts` 与两条生产缝（`src/main/post-run-readings.ts`、
  `src/main/agent-runner.ts`）。工作树含他人 127 项改动，提交等业主明确指示。
- **能力收益仍不可测**：未发模型请求；评价入口的 `--runner` 目前只有脚本化 demo。
  解除条件不变：提供凭据并显式授权花费。
- **真实任务配对仍缺判据**：bench 12/12 无逐名 judge 规格；解除条件是补 FAIL_TO_PASS / PASS_TO_PASS。
- **未跑 HEAD 面**：`mutate-verify` / `head-cert` 量的是提交；本轮未提交，故不冒充已认证。
