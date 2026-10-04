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

The remaining verification surface is the agent/core test and headless-check surface; note `apps/desktop`
is not scanned by any root gate or CI.

## 2026-09-30 · `tests/map-self-report.test.ts:95` 判据依赖 checkout 路径深度（未改代码，待换判据）

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
