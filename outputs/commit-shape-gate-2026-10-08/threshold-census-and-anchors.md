# 第 435 页 · 提交面的删除形状那道闸（#16）：阈值怎么来的、六根锚点各咬哪一格

## 1. 动因（一次真实事故，不是假想）

第 431 页：我在构造临时 index 时按记忆补完了文件名，`GIT_INDEX_FILE=` 指着一个**没有 read-tree 过的 index**
⇒ git 认为「索引里该有的东西」是零 ⇒ 落出一笔 `3647 files changed, 441768 deletions(-)`、树里 0 支文件的**空树提交**。
当时拦住我的是**我看见 `git commit` 的 stdout 那一行**，不是任何一道门。本仓口径：重复疏忽要搬进工具——
这一页把它搬进去。

## 2. 阈值不凭愿望写（现读 120 笔，HEAD 往回逐笔量）

取料：`/private/tmp/p435-commit-shape.mjs 120`（逐笔 `diff-tree --numstat`、`--diff-filter=D`、父树 `ls-tree`）。

| 维度 | 现读 | 定成的判据 |
| --- | --- | --- |
| 从父树**消失的文件数** | p50=0、p90=0、p99=1、**最大 4**（`c68ea0c`） | `DELETED_FILE_CAP = 4`，**含等号，超帽才红**；超了就要求说明里写「删除备案：<为什么>」 |
| 树文件数 | 事故那一笔 = 0 | `treeFiles === 0` ⇒ `emptyTree` 单独一格并阻断 |
| 删除行数占比 | p50=1.5%、p90=36.8%、**最大 94.2%**（`3c99f31`：合法的「退回隔壁夹带的 10 支在飞文件」，消失文件 0 支） | **只出声不阻断**（`dominantDelete`）——拿它判红会误伤真实历史，那会把门的信用花光 |

回放核对：把这两条阻断规则套到那 120 笔上 ⇒ **0 条红**（最大消失数 4 恰好压在帽上）。
事故那一笔（消失 3647、树 0）⇒ 两条都红。这就是"帽是水位不是愿望"落在阈值形状上。

## 3. 两个消费者，一份判据（防第二把尺）

- `scripts/commit-surface-check.ts`——**提交那一刻**（缺省问 HEAD，`--landed=<rev>` 问那一笔）；有阻断项 ⇒ 退 1。
  这一面是唯一能让交笔当场停下来的位置；它原有那两面（#47 落库面对账、#49 门面对账）仍只出声不决定退码，
  因为那是**邻接会话的状态**，不是这一笔的失败。
- `scripts/repo-hygiene-check.ts` 新增**面③**——认证那一拍（GATES 里的 `repo-hygiene-check`，门预算 1200ms，
  本轮实测这道门 `0.38s`＝380ms，加这一面没换档）。忘了跑上面那道尺，认证也拦得住。
- 四段 git 取料的**参数表只在 `scripts/lib/commit-surface.ts` 里出现一次**（判卷有一条专门钉这件事：
  两个消费者里都不许再出现 `--diff-filter=D`）。lib 不起进程：`GitRunner` 由调用方注入。

## 4. 六根锚点 → killer 用例（每根一条，不重叠）

| 锚点 | 突变 | killer |
| --- | --- | --- |
| `commit-shape-empty-tree-not-blocking` | 空树那格 `blocking: true`→`false` | 树里 0 支文件 ⇒ 单独一格 emptyTree 并阻断 |
| `commit-shape-null-face-folds-to-zero` | `treeList === null ? null : …`→`?? 0` | 四段全取不到 ⇒ 两个计数都是 `null` 而不是 0 |
| `commit-shape-waiver-marker-ignored` | `message.indexOf(DELETE_WAIVER_MARK)`→`-1` | 备案标记的认法（有标记有话／只有标记／话太短／没标记） |
| `commit-shape-cap-raised-without-census` | 帽 4→5 | 帽的取值有现读出处（4＝近 120 笔最大值） |
| `commit-shape-hygiene-face-not-counted` | 摘掉面③ 的 `failed++` | 卫生门那一面：接进 failed 的计数 |
| `commit-shape-cli-exit-hardcoded-zero` | CLI 退码写回 0 | CLI 那一面：退码接的是阻断数（不是恒 0） |

## 5. 落库前现读

- `typecheck` `TC_RC=0`；`tests/commit-surface-check.test.ts` 47 条全绿（本轮新增 20 条：取料 5 ＋ 判据 8 ＋ 备案 2 ＋ 接线 4 ＋ 帽出处 1）。
- 判卷注入的是 **fake git**（按参数表分派，参数表里没有的一律抛）——lib 改了 git 参数而判卷没跟着改，会在这里喊，
  不会安静返回 `null` 让纯核把「没量到」当结论。
- 卫生门真跑（脏主树）：`面① ✅ 68.1%`、`面② ❌ src/main/agent-runner.ts 3107 行 > 帽 3100`——
  那一格是**隔壁在飞**的（帽 3000→3100 与那个 3107 行的文件都还没入库），HEAD 上是绿的；本笔不动它。
  `面③ ✅ 出声 0 条（阻断 0）`；整道门 `real 0.38`。
- 提交面尺真跑 HEAD：`问的是 HEAD｜提交面删除形状：出声 0 条（阻断 0，只报 0）｜帽：消失文件 ≤ 4`、`CSC_RC=0`。
- 针脚体检（脏树，落库前）：`1512 条｜阻断 12`，其中本簇 6 条 `commit-shape-*`（同笔未落库＝预期读数）
  ＋ 隔壁 4 条 `d13-*` ＋ 2 条待复认（`cascade-ladder-cross-provider`、`goal-stopped-flag-ignored`，都不是本簇文件）。
- 取料自证（`/private/tmp/p435-needle-selfcheck.mjs`）：六根针脚在各自 src 文件各命中 1 处、六个 killer 标题各命中 1 处，
  反面哨兵（问突变后的写法）＝ 0。

## 6. 刻意不做

- 不装 `.git/hooks/pre-commit`：那是共享状态、且本仓把「写 `.git/hooks`」列为安全面，需要业主单独授权。
  现阶段的兜底是「提交那一刻的尺 ＋ 认证那一拍的同一份判据」两道；真要第三道（钩子）请明说。
- 门预算没抬（`repo-hygiene-check` 1200ms，实测 380ms）；帽也没抬。
- `dominantDelete` 不做成阻断维——理由见上表那一行，这条读数现在只负责让人看见。

## 7. 落库后复验（第 436 页凭证引的时间量原文，取在干净树上）

```text
改动面派生：rev=26d2da0c → 变更文件 7 个 ⇒ 选中锚点 40/1508 条
全部变异被正确杀死（断言非恒真）
[mutate-verify] 本次耗时 45.0s · 跑了 40/40 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）
成本分母：判卷 spawn 80 次／40 条（每条次数分布 2×40）· 单次中位 第1次 0.4s／第2次 0.4s· 最贵一条 changed-since-list-mode-always-filters 3.0s
针脚体检：1508 条 —— 阻断 0，待复认 2，未覆盖 1，逐行式 5，未入库面 0（被测面 + 判卷两面），钉在飞文本 0，killer 指针失效 0（其中 HEAD 侧 0）
改法语法体检：1508 条改法全部产出合法源文件 ✅
```

跑法（可复算）：`git worktree add --detach .worktrees/verify-cb0f5c6 cb0f5c68` ＋ `cp -al` 依赖，
在树里 `node --import tsx scripts/typecheck.ts`、`node --import tsx scripts/mutate-verify.mjs --check-needles`、
`node scripts/mutate-verify.mjs --changed-since=26d2da0c --lock-tag=judge-435`；核过 0 项在飞后回收。
