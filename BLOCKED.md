# Blocked

The requested desktop layer removal is complete. No desktop blocker is tracked in this core-only checkout.

The remaining verification surface is the agent/core test and headless-check surface. Any future desktop work must start from a new explicit design and implementation decision.

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
