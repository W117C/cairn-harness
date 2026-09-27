# 第一次在干净 HEAD 上跑全量判卷：5 红 / 2770 绿，逐条归因（2026-09-27）

线程：`head-full-census-2026-09-27`。任务 #4（HEAD-only 全量绿门）与 #21（本笔修法）。
命令：`git worktree add --detach .worktrees/head-full-e84f9c e84f9c8` ＋ 硬链主树 `node_modules`，
在树里跑 `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts`（`fileParallelism: false`）。
读数：**Test Files 4 failed | 234 passed (238)；Tests 5 failed | 2770 passed (2775)；退出码 1**。
日志留在 `/tmp/head-full.txt`（本仓外，会随 /tmp 清理；下面把每一条的判读原文抄进来）。

## 一、为什么这是第一次拿得到这个数

第 131 页立案的半落库（消费者入库、新模块未跟踪）让认证树长期报的是「8 条 typecheck 错 / 34 个判卷文件红」，
没人能把那张表和"代码到底红不红"对上。`14d2736`（别人那笔整树入库）把这批模块一次带进 HEAD 后，
`head-import-face` 现读第一次是 `模块悬空 0｜符号缺失 0｜存量已豁免 0` ⇒ 全量表才第一次"跑得起来"。

## 二、5 条红的归因（两类，都不算"代码坏"，但只有一类我能修）

### A 类＝环境载不动（2 条）——本笔修掉

| 判卷 | 断言 | 成因 |
| --- | --- | --- |
| `tests/gated-tools.test.ts:62` | `expect(shells[0]?.ok).toBe(true)` 收到 false | 这条在**靶子仓库** `fixtures/todo-app` 里真跑 `run_shell`；它的 `node_modules` 被 `.gitignore:3`（`node_modules/`）排除 ⇒ 干净树里没有 ⇒ 命令必败 |
| `tests/runner-gates.test.ts:77` | `expect(events.some(e => e.type === "verify_result" && e.ok)).toBe(true)` 收到 false | 同一根：plan 批准后那记 verify 拍也在 `fixtures/todo-app` 里跑 |

复现与判别：两条在主树单跑/全量都绿，在认证树里**稳定红**（我把这两个文件单独在隔离树跑过：2 failed / 2 passed）
⇒ 与运行处有关，与代码无关。这正是规则 227 那条分诊在"整表"面上的形状——不分开记，HEAD 的账永远说不清。

修法（收成一处、挂现状不挂手抄表）：`scripts/lib/head-cert-deps.ts` 新增 `depDirs(list, maxDepth)`——
从**盘上声明**（自带 `package.json` 的目录）派生"需要各自装依赖的目录"，排除 `node_modules` 与隐藏目录，带深度帽；
`scripts/head-cert.ts` 据此把缺的子仓库依赖从主树 `cp -al` 硬链接补上，补不齐就在汇总里点名
「这些靶子仓库的依赖补不齐 ⇒ 在其中真跑命令的判卷红**不可归因于代码**」。
判卷 6 条（含"本仓现读必含根与 `fixtures/todo-app`"的防空载自证、"接线钉循环头而不是函数名"），锚点 3 条。

### B 类＝存量待清（3 条）——不是本笔的活，但都点名了

| 判卷 | 现读 | 该谁做 |
| --- | --- | --- |
| `head-import-face` HEAD 悬空那一半 | 4 条 `stale-waiver`（`src/main/provider-runtime.ts` 等「已不再悬空 ⇒ 从 `HEAD_DANGLING_WAIVERS` 删掉」） | 尺在履职：#11 结案后名单必须删名。清理**正卡在别人未提交的 `scripts/head-import-face.ts`**（主树现读已经 0 findings，认证树读 HEAD 还是旧名单）⇒ 半落库第 N 次 |
| `head-import-face` 符号那一半 | 1 条 `stale-waiver`（`src/agent/glm-session.ts:SessionTransport`） | 同上 |
| `prose-needle-scan` 真仓读数 | `水位上涨：顶包候选 11（已提交 11 ＋ 在飞 0）> 登记的 10` | #2（登记帽只准下调）；上涨是 `14d2736` 那笔 AGENTS.md/BLOCKED.md/docs 改写带进来的真实增量，要逐条落点后再降帽 |

## 三、这条读数对任务 #4 的意义

「HEAD-only 全量绿」这道门从今天起**可判定**：5 红全部有单一归因，其中 2 条由本笔消除。

读数之后（同一小时内）B 类那 3 条也被别人补掉了：`d8a77f8 清空两张存量豁免表：14d2736 把它们记的债还完了`
与 `c728962 最小进度闸改钉它报出来的数…给顶包候选棘轮降一格`。
⇒ 本工件记的是**当时**那一读（5 红，两类），不是 HEAD 的当前值；当前值要在带上前置修复的新 HEAD 上重取，
凭证记在 PROGRESS 第 146 页末尾。「HEAD 有点红」这句话从此不再需要出现——每个数都有归因与出处。
