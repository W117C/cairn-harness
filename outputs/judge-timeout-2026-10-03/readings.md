# 贴帽取料刷新（#29 结案）：为什么这一格的红不许放宽，以及新语料的出处

## 红是谁造成的

`tests/head-cert-deps.test.ts` 的「真机整表」那格吃一份**冻结**的安静态全量 json，按**用例标题**回源码取该条的显式预算。
第 313 页（提交 `204f017`）把 `tests/tool-choice.test.ts` 的一条标题从
「重复探测只按「同 action + 逐字相同结果」判；换参数就不算」
改成
「重复探测只按「同 action + 结果前 200 字相同」判；换参数就不算」
（旧标题写着"逐字"而正文只证过"换参数不算"——标题承诺了 ≠ 正文在判）。
⇒ 语料里的旧标题在源码里查不到 ⇒ `cell.notResolved` 现读 1，判卷要求 0 ⇒ **此后每一笔认证的全量判卷都带一条红**。

红是对的：标题就是这张表的取料键，漂移必须响。**不放宽、不改留档**，按既有先例换取料。

## 新语料的出处（可回查）

- 仓/树：`.worktrees/gate-head-cert`，checkout 到 `9dd1e8a`（第 314 页落地后的 HEAD）；跑前该树 `git status --porcelain` 为空。
- **独占**：起跑前 `pgrep -f vitest` 命中数 = 0（隔壁那批单文件击杀已结束）；这是"安静态"的定义的一部分——
  并发窗口跑出来的时长是脏的，一旦当 quiet 语料入档，此后每次认证都在读一个假基准。
- 命令（与 `scripts/head-cert.ts` 里产 `suite.json` 那一条逐字同形，不另创口径）：
  `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts --reporter=default --reporter=json --outputFile.json=…`
- 读数（取自 `suite-quiet.log` 与 `suite-quiet.json` 本身，不是回忆）：
  `Test Files 1 failed | 285 passed (286)`、`numTotalTests 3952`、`numFailedTests 1`、`Duration 162.45s`、`Start at 04:03:47`。
- 那条红就是本判卷自己（它当时还指着 10-02 那份旧语料）⇒ 与 10-02 那份语料的形状相同，红不影响时长读数。

## 换指之后

`jsonPath` → `outputs/judge-timeout-2026-10-03/suite-quiet.json`；那段注释写明"为什么又换一份"与"刷新必须等独占窗口"。

复跑 `tests/head-cert-deps.test.ts`：**115 条全绿、2.91s**（此前那一格红）。

## 这格里没有的东西（不说成有）

- **没有新锚点**：本笔不新增判据，只是把既有判据的取料键对齐现状。若有人想给它加一把"语料必须安静态"的尺，
  要回答的是"谁来证明跑的时候场上没别人"——现读只有 `pgrep` 这一个弱证据，写进注释而不是写成门。
- **没有**改动 10-02 那份留档（它是那一天的证据，AGENTS.md 也禁改冻结夹具）。
