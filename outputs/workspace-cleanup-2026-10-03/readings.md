# 工作区整理与清理 · 存证页

- 时点：2026-10-03 13:39–13:48（+0800）。清理对象＝`/Users/ze/Downloads/deepseek harness`（分支 `zcode`）。
- 起因：用户指示「整理和清理一下工作区，包括代码，worktree 分支，文档等」——本仓 PROGRESS 里那句「回收仍等用户点头」等的就是这一次点头。
- **并发事实（贯穿全程）**：另一会话（ZCode）同期在这棵树上连发页面。执行期间 HEAD 从 `2cd5fae` → `80ba2ca` → `7bb95b7` → `05be8f9`，并新建了两棵树（`gate-mutate-321`、`.worktrees/gate-head-cert-321`）。故本文所有读数都带时点，且**凡"另一会话自己提交/新产出"的差异一律不算本轮的账**。
- 证据目录：`outputs/workspace-cleanup-2026-10-03/`（`00-*` 基线、`01`–`08` 逐步日志、`02*` 勘误）。

## 0. 结论速览

| 项 | 清理前 | 清理后 | 说明 |
|---|---|---|---|
| 注册 worktree | 17 | **5** | 4 棵被我回收 + 空目录 1；另一会话同期新建 2 棵（在用它，按同一判据留给下一轮） |
| 本地分支 | 15 | **5** | 删 11 个；新增 1 个 `rescue/locate-weights-rev4` 保全分支 |
| 标签 | 2 | 2 | 都保留（它们是两笔否则不可达提交的唯一 ref） |
| 工作区总大小 | 1.8 G | **1.4 G** | 净减约 0.4 G；另一会话同期新增两棵树，故这是**下界** |
| `.git` | 94 M | **62 M** | 松散对象 513 → 0、包 4 → 2、size-pack 61.54 → 58.88 MiB、garbage 文件已删 |
| `git status` 里的机器垃圾 | 4 类 | **0** | `.vitest/`、根级 `gate-mutate-318/319/320/`、`dev/null`+`tmp/`+`32768/`+`工作区/`、`.DS_Store`×2 |
| 被跟踪文件的改动（我方） | — | **1 个文件 / +3 行** | 只动 `.gitignore`；另有一处**还原**（见 §5） |

## 1. 判据

1. **规则 120（本仓既有）**：一棵 scratch 树可回收 ⟺ `detached ∧ 0 项在飞 ∧ 那一笔已是 zcode 祖先`。
2. **package.json 写死的共享树不收**：`head-cert-check` 用 `.worktrees/gate-head-cert`、`mutate-verify` 用 `.worktrees/gate-mutate-verify`——删了下一轮要重装约 1 GB。
3. **本轮追加的「在用品」判据（用户 13:45 裁决）**：原计划要求 `pgrep` 全空；实测另一会话正连发页面，该条会把全部回收拦死（第一次尝试确实全被拦下，见 `03-phaseB-dead-trees.log` 前半）。用户选择改用更窄判据：**正在跑的门引用了这棵树？否** → 才动。三条同时成立才删。
4. **有货先保全**：任何有未落地内容（在飞文件或未入库提交）的树，先落 ref/commit，再删树。
5. **不在 `zcode`/`main` 上提交**；不改在飞文件；不跑全量门（评审 G3：并发下出伪红）。

## 2. 逐棵树的处置（14 棵回收 + 1 个空目录）

| 树 | HEAD | 判据命中 | 处置与证据 |
|---|---|---|---|
| `.worktrees/gate-mutate-import` | b4b4db3 | 120 全中 | 删（`03-phaseB-dead-trees.log`） |
| `gate-mutate-318` | e8a8ed5 | 120 全中 | 删 |
| `gate-mutate-319` | 07641c0 | 120 全中 | 删 |
| `gate-mutate-320` | 2cd5fae | 120 全中 | 删 |
| `.worktrees/locate-weights` | 36a9ec6 | 有货 | **先保全**：`rescue/locate-weights-rev4` @ `3719e5c`（4 文件 / +164 −4）→ 再删 |
| `.worktrees/suite-refresh-318` | e8a8ed5 | 有货（实为冗余） | 零损耗证明后 `--force` 删（`05-phaseC-preserve.log`） |
| `.worktrees/doc-layer` | da60f0d | 干净带分支 | 删树；**留分支** `doc-layer-migration`（2 笔未落地） |
| `.worktrees/opt` | 1de92fa | 干净带分支 | 删树；**留分支** `opt/agent-v2`（4 笔待判） |
| `.worktrees/port` | f789dac | 13/13 patch-id 已落地 | 删树 + 删分支 `port/opt2` |
| `.worktrees/port2` | eb140cc | 祖先 | 删树 + 删分支 `port2` |
| `.claude/worktrees/{charming-neumann-b4ee71, elastic-antonelli-ec59c9, laughing-burnell-7239e5, unruffled-dirac-5cf0e0}` | 3a6d63c | 祖先、干净 | 4 棵删树 + 4 个 `claude/*` 分支删 |
| `.worktrees/suite-refresh-2026-10-03` | — | 未注册空目录 | `rm` |
| `.worktrees/gate-head-cert-321`、`gate-mutate-321` | 7bb95b7 | — | **另一会话此刻在用**，不碰 |

`locate-weights` 里那 37 行新增中有 **28 行主树没有**（`EXTRACT_LOGIC_REV = 4`；成员位名字不再算跨文件可链接定义）⇒ 这是真未落地实验，已整棵保全成 commit。
`suite-refresh-318` 的零损耗证明三条：① 树里语料目录**只有** `suite-quiet.json`，sha256 与主树同名文件逐字节相同（`d3e1f9f6f840…`），两份日志主树更全；② 该树相对自己 HEAD 的 10 行新增里 9 行主树已有，唯一没有的一行是**被重写过的旧注释**（原文已抄进 `05-phaseC-preserve.log`）；③ 整份文件 145 行差异＝主树在这条线上往前走（路 B），不是树里多了东西。

## 3. 分支与标签

- 删 11 个：`agent/修复-todo-的-completedcount-worker-12`、`codex/r1b-renderer-subtraction`、`feat/goal-plan-mode`、`feat/m10-split-prompt-face`、`feat/ui-codex-bench`（5 个纯 ref，`-d`）、`claude/*`×4、`port2`（`-d`）、`port/opt2`（`-D`，依据 `git cherry` 13/13 全 `applied`，逐条落在 `06-phaseD-branches.log`）。
- 留 4 + 新增 1：`zcode`、`main`（落后 1321 笔、零独有提交，**按计划保留这个常规名字，不擅自删**）、`doc-layer-migration`（2 笔未落地文档分层提案）、`opt/agent-v2`（4 笔待判，见 §8）、`rescue/locate-weights-rev4`（本轮保全物）。
- 标签 2 个全留：`goofy-satoshi-0edc69` @`84850747`、`rescue/stash-chain-41772808` @`c9fdb400`——二者都**不是任何分支的祖先**，是那两笔的唯一 ref。

## 4. 机器垃圾（阶段 A）

删：`dev/null`（空）、`tmp/`（空）、`32768/`、`工作区/`（都只有空 `.agent/sessions`）、`.vitest/`（1 文件，全仓零消费者）、`.worktrees/suite-refresh-2026-10-03/`、`./.DS_Store`、`outputs/.DS_Store`、`.tmp/*`（3.0 M gate scratch，`.gitignore` 内）。
未删（别家 App 状态，共约 4.6 M，gitignored 不污染 git）：`.qoder/`、`.workbuddy/`、`.workbuddy-ai/`、`.pi/`；**活物一律不动**：`.codegraph/`（13:36 还在写）、`.mimosa/`、`.superpowers/`、`docs/facts/`、`.agent/`、`outputs/claims-*/`、`outputs/_audit*`。
命令与逐条 `files=` 计数见 `01-phaseA-removals.log`。

## 5. 文件级改动（只有两处）

1. **还原** `outputs/judge-timeout-2026-10-01/suite-quiet.json` → HEAD。理由：留档不许改，且差异在内容面不在时长。**勘误**：还原前只落了 `git diff --numstat`（1/1），没落完整 diff ⇒ 还原前那份字节不可恢复（核实：不在对象库/reflog/无 APFS 快照/无 Time Machine）；`02b`/`02c` 对照的是**历史提交 `43ace9e` 那一版**，不是还原前内容。详见 `02d-CORRECTION-archive-preimage-unrecoverable.md`。还原后与当前源码标题逐字一致（`tests/compaction.test.ts:500`），且此留档在判卷上的角色已被 `outputs/suite-refresh-2026-10-03/` 取代。
2. **`.gitignore` +3 行**：加 `.vitest/`（含一行动因注释）。这是本轮唯一新增的源码级改动。

## 6. `.git` 卫生（阶段 E）

删 `.git/objects/40/tmp_obj_Ly3va4`（git 自报的 garbage）；`git gc`（保守口径，**不带** `--prune=now`、不 expire reflog）实测 rc=0：松散对象 **513 → 0**、包 **4 → 2**、`size-pack` 61.54 → **58.88 MiB**。`git fsck` 复核：`garbage found` = 0。
**dangling 对象保留**：gc 后仍有 92 dangling commit / 165 dangling tree / 19 blob（清单 `00-dangling.log`、`08-fsck-after.log`）——默认 2 周才失效，本轮**故意不**建救生索也不 prune，留给你裁决。它们数量在涨，是各次 `worktree add/checkout` 的副产物。

## 7. 验证读数（阶段 F）

| 检查 | 读数 |
|---|---|
| `git worktree list` | 5：主树 + `gate-head-cert` + `gate-mutate-verify`（两棵 package.json 写死）+ `gate-head-cert-321` + `gate-mutate-321`（另一会话在用） |
| `git branch` | 5（§3） |
| `git worktree prune -n` | 空（无待清元数据） |
| `git status` 对账 | 我方消失的条目 4 类；新增 2 条（`.gitignore`、本证据目录）；其余差异全是另一会话自己提交/新产出（PROGRESS.md、kernel-host.ts、claims-3faces-*、gate-mutate-321/、tests/cli-surface.test.ts…） |
| `git diff --stat` | 29 文件——其中 **28 个是在飞会话的**，我方只有 `.gitignore` |
| `node --import tsx scripts/typecheck.ts` | rc=0，0 报错 |
| `node --import tsx scripts/docs-check.ts` | rc=0（`UNVERIFIED=3`） |
| `node --import tsx scripts/repo-hygiene-check.ts` | **rc=1**：面① `outputs/ 1744 / 已跟踪 2780 = 62.7%`（帽 60%）——**存量红 B2，不是本轮造的**；面②绿（最大 2783 ≤ 2800） |
| `git fsck --no-progress` | 无 error、garbage 0 |
| 体量 | `.` 1.8 G → 1.4 G；`.worktrees` 1.3 G → 1.1 G；`.claude` 42 M → 0；`.git` 94 M → 62 M；`outputs` 32 M → 32 M |

**未跑（按计划）**：`pnpm test`、`pnpm gates`、`mutate-verify`、`head-cert` —— 另一会话在飞，跑了只会得到伪红（评审 G3）并可能与它抢树。

## 8. 未做 / 待办（逐条带可复跑口径）

| # | 事项 | 为什么留着 | 复跑 |
|---|---|---|---|
| 1 | **B2：`outputs/` 占比撞帽（面①红 62.7%）** | 两条正路要用户裁决 + 独占窗口；且该门文件本身是另一会话的在飞 intent-to-add 改动，碰就是撞车。选项：(A) `git rm -r --cached outputs` + 入 `.gitignore`（取料离仓，§8 说红与其"无人见"一并消失；代价：`docs-check` 的 `outputs/<dated>/` 引用面与 CI 语义要重估）；(B) 按降帽流程把帽重定到 0.65、登记新读数、并把该门补进 `CERT_GATES` | `node --import tsx scripts/repo-hygiene-check.ts` |
| 2 | **`opt/agent-v2` 的 4 笔** | `git cherry` 报 4 笔未落地，其中 3 笔主题已在 zcode 日志（patch-id 漂移所致），剩 `fe14671`「打通无人值守闭环（方案门 auto 放行 + 退出码诚实化）」34 文件 / +2738 需逐笔判 | `git cherry -v zcode opt/agent-v2`；`git show --stat fe14671` |
| 3 | **`doc-layer-migration`（2 笔）** | 文档分层迁移提案（AGENTS.md 26020B→7934B）——属结构级决策，且 ADR 0001 仍 Proposed | `git log --stat zcode..doc-layer-migration` |
| 4 | **`gate-head-cert-321`/`gate-mutate-321`** | 另一会话正在用；同一判据下它用完即可回收 | 见 §9 的回收口径 |
| 5 | **根级树的成因** | `--in-worktree` 收仓外路径（`gate-mutate-3xx` 就直接长在仓根），而 `staleScratchTrees` 只把 `.worktrees/` 下的算本仓 scratch、其余报 `foreign` ⇒ **这类树永远不会被自动报成可回收**，只能靠人。建议门里拒绝或规范化成 `.worktrees/<名>` | 改 `scripts/mutate-verify.mjs` / `scripts/head-cert.ts`（两者此刻都是在飞文件） |
| 6 | **`PROGRESS.md` 1.7 M / 11353 行** | 拆分要同时动 `scripts/next-page.ts`、`docs-check.ts` 的 `LEDGER_FILE`/`CREDLEDGER_FILE` 与 e2e 冻结基线，且另一会话每页都往里追加 ⇒ 必须独占窗口、另立提案 | — |
| 7 | **G1 ADR 过期 / G4 存证页判据**（评审 §2.3/§5 遗留） | 要改被跟踪的文档或加判据，属在飞面 | 见 `docs/review-2026-10-03-technical.md` |
| 8 | **dangling 对象的救生索** | 92 笔 dangling commit 未逐笔看主题；如需保留请在此 2 周窗口内建 ref | `git fsck --dangling \| grep commit` |

## 9. 复原手册

```sh
# ① 恢复一棵被回收的树（以 locate-weights 为例）
git worktree add .worktrees/locate-weights 36a9ec6
# ② 取回被保全的未落地改动（本轮唯一一处）
git switch rescue/locate-weights-rev4        # 3719e5c，含 parse.ts/rank.ts 的 rev 4
# ③ 恢复被删分支（SHA 见 00-branch-shas.log）
git branch port2 eb140cca0cdd3b5e2d21bd65dd27a011e0f4cdf2
# ④ 本轮的下一步回收（等那段静默窗口）
pgrep -fl 'mutate-verify|head-cert|vitest'   # 须为空
git worktree list                            # 逐棵核 detached + 0 项在飞 + 是 zcode 祖先
git worktree remove <树> && git worktree prune
```

## 10. 教训

1. **还原/覆盖任何工作树文件前，先落完整 pre-image**（`git diff > pre.diff` 或 `git hash-object -w`）——只落 `--numstat` 等于没落（§5 那条不可恢复的勘误就是这么来的）。
2. **`pgrep` 全空这条"独占窗口"判据，在多会话连发页面的本仓里是"永远不满足"**；真正该问的是"**有没有在跑的进程引用这棵树**"。本轮据此把 4 棵死树一次收干净（第一次尝试全被旧判据拦下，这正是它该有的行为——拦住了，然后由人来改规则）。
3. **删树前先证明"零损耗"而不是"看着没用"**：`suite-refresh-318` 靠三条证据（语料 sha 相等、改动行 9/10 已在主树、差异方向是主树前进）才敢 `--force`。

## 11. 第二轮收尾（2026-10-03 13:56 起，用户授权「①②」）

### ② 已做：回收另一会话留下的 `gate-mutate-321`

判据读数（`09-phaseG-round2.log`）：`head=7bb95b7`、detached、0 项在飞、是 zcode 祖先、无进程在用 ⇒ `git worktree remove` rc=0。
**结果：注册 worktree = 3 棵**（主树 + `package.json` 写死的 `gate-head-cert` / `gate-mutate-verify`）——与 §0 的原计划目标一致。另一会话自己那棵 `gate-head-cert-321` 是它自己收的。

### ① 已查清：那 20 条**不该删**，本轮一条没删（结论与提出 ① 时的假设相反）

| 证据 | 读数 |
|---|---|
| **无重复** | 21 个残余文件逐个 `git hash-object` 与 **2771 个已跟踪 blob** 比对：重复 **0** —— 没有任何一条是别处的副本，删掉就是唯一副本没了 |
| **顶层 5 个 `_audit*.md` 是审计报告本体** | 197 / 316 / 183 / 266 / 756 行，标题分别是「声称 vs 现实对账」「工程质量审计」「可用性审计」「能力完整度核查」——不是日志碎片 |
| **其中一条被已跟踪文档直接引用** | `scripts/ci/README.md:5`：「质量此前**没有任何自动保险丝**（`outputs/_audit2-quality.md`，能力 9）」⇒ 删它＝在那份文档里留一条死指针 |
| **散落日志都在各自的主题归档里** | 每个目录有 1–13 个已跟踪文件；`outputs/landing-1c40df7-2026-09-30/readings.md` 本身就是那个归档的**存证页**（评审 G4 要求的东西） |
| **权威引用面** | PROGRESS.md / AGENTS / BLOCKED / README / `docs/**` / `tests/**` / `scripts/**` / `apps/**` 对这批的引用数 **全 0**（唯一例外是上面那条） |
| **本仓写死的口径** | `scripts/repo-hygiene-check.ts` 注释原文：「本门不追溯、不删历史取料（那是别的会话的证据）」 |

⇒ **① 的正解不是逐个删，而是 B2 那条治理路**：把取料移出索引（`git rm -r --cached outputs` + `.gitignore`）之后，这些文件仍是本地文件、`git status` 永久安静、面① 那道红一并消失（评审 §8 原话）。
**未做该治理的理由**：`git rm -r --cached outputs` 会一次留下 1744 条已暂存删除；另一会话只要下一次 `git add -A` 提交就会**把这份大删除吞进它自己那一笔**——必须等它停手 + 你点头才动。本轮只把清单与证据落盘，不越权处置别人的取料。

（另：`outputs/claims-3faces-2026-10-03/` 两份日志与 `outputs/claims-cli-spec-2026-10-03/` 是另一会话的**在飞产物**，也不动。）
