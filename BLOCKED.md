# Blocked

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
