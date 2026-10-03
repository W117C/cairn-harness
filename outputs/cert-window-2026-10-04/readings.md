# 认证窗口取料面（2026-10-04，独占窗口，HEAD＝`74254586`）

这一页只回答一件事：**每个数字是从哪棵树取的**。本仓多会话共用一棵工作树，
第 339 页量出现读时 9 道门的打印面不等于 HEAD 那把尺，所以两态读数分开登记。

| # | 命令（逐字） | 取料面 | 退出码 | 读数 |
|---|---|---|---|---|
| 1 | `git worktree add --detach .worktrees/verify-head-742545 HEAD` ＋ `cp -al` 打依赖 | 新建干净树 | 0 / 0 | `git status --porcelain`＝**0 项在飞**，`rev-parse --short HEAD`＝`74254586` |
| 2 | `node --import tsx scripts/typecheck.ts` | 干净 HEAD 树 | 0 | tsc --noEmit **0 条报错**（`typecheck-head.log`） |
| 3 | `node --import tsx scripts/mutate-verify.mjs --check-needles` | 干净 HEAD 树 | 0 | 针脚体检 **1421 条——阻断 0／待复认 1／未覆盖 1／逐行式 5／钉在飞文本 0／killer 指针失效 0（HEAD 侧 0）**（`needles-head.log`） |
| 4 | `node --import tsx scripts/docs-check.ts` | 干净 HEAD 树 | 0 | 受检项全绿，`UNVERIFIED=3`（`docs-check-head.log`） |
| 5 | `node --import tsx scripts/gate-check.ts` | 干净 HEAD 树 | 0 | **全部断言通过**；H7 三格逐字 `{"onDiskNotInTable":[],"inTableNotOnDisk":[],"tableDirsNotSwept":[]}`；`UNVERIFIED=1`（`gate-check-head.log`） |
| 6 | `node --import tsx scripts/repo-hygiene-check.ts` | 干净 HEAD 树 | 1 | **`ERR_MODULE_NOT_FOUND`**——不是缺陷：这支门在 HEAD 里不存在（见 8），是我在干净树上跑了暂存面才有的文件 |
| 7 | `node --import tsx scripts/commit-surface-check.ts` | 主树（真实 index） | 0 | 落库面 3097 条：一致 3090／index 缺 1（`bin/m0.mjs`）／更旧 0／别人新暂存 6｜门本体面差异 **9 道在飞**（`commit-surface.log`） |
| 8 | `git ls-tree HEAD scripts/repo-hygiene-check.ts`｜`git show HEAD:package.json \| grep -c repo-hygiene`｜`git show HEAD:scripts/gate-manifest.ts \| grep -n repo-hygiene` | HEAD 侧 | 0／1／1 | **0 行／0 命中／0 命中** ⇒ 体量门（脚本、package.json 声明、门表登记、判卷）此刻整体不在 HEAD |
| 9 | `node --import tsx scripts/head-cert.ts` | 认证树 `.worktrees/head-cert-7425458`（起前现读 0 项在飞） | **1** | 认证门面 **22 道（跑到 22）｜绿 22｜超预算 0**；`Test Files 3 failed \| 290 passed (293)`／`Tests 3 failed \| 4116 passed (4119)`；`并发判卷=起前 0 套／跑完 0 套（两端独占）`；`收尾复核=同一笔`；逐条日志 `/tmp/dsh-head-cert-7425458`（`headcert-summary.txt` 为本页 #9 汇总行落盘副本） |
| 10 | 三条红的原文 | 认证树全量 | — | `full-suite-failures.txt`（逐字 59 行，含断言两侧的值与行号） |
| 11 | `node --import tsx scripts/prose-needle-scan.ts`（改前） | 主树 | 1 | `顶包候选 11（已提交态 10 ＋ 在飞 1）> 登记的 10`——被点名的收料面 `tests/arch-cycle-check.test.ts:95` |
| 12 | `node --import tsx scripts/prose-needle-scan.ts`（改后） | 主树 | **0** | `顶包候选 10（已提交态 9 ＋ 在飞 1）`＝帽线内；`收料断言 156 → 155` |
| 13 | 造红 A：把 `cycleFindings` 里成员串插值换成「（成员略）」，跑 `tests/arch-cycle-check.test.ts` | 干净树＋本笔两支改动文件 | 1 | `Tests 1 failed \| 26 passed (27)`，红在「盘上有新圈 ⇒ fresh 红，且 detail 里点名成员与出口建议」⇒ **判据仍咬得住「不点名成员」** |
| 14 | 造红 B：把 `cycleMembersLabel` 的分隔符 `" → "` 换成 `" \| "` | 同上 | **0** | `Tests 27 passed (27)` ⇒ 这一格**不再被钉**，是本笔的取舍（拼法只有唯一事实源，渲染改动不该同时改两处），不是漏改 |
| 15 | 复原校验 `cmp` 两次 + `find .worktrees/verify-head-742545 -name "*.mutbak"` | 干净树 | 0 | 两台造红均**逐字节复原**；`.mutbak` 现存 **0** 支 |
| 16 | 主树 typecheck（本笔改动已在盘上） | 主树（脏） | 2 | 报错文件 1 支＝`tests/autonomy.test.ts`，归因器逐字标为「tracked 但工作树脏」⇒ **不在本笔两支文件里**；干净树那一跑（#2）是 0 条 |
| 17 | 治理读数：`du -sh .worktrees`、逐棵 `git status --porcelain`、`git merge-base --is-ancestor` | 主树 | — | `.worktrees`＝**1.8G／18 棵**，逐棵 `dirty=0`、`*.mutbak=0`、sha 全为 HEAD 祖先；`git ls-files --others --ignored --exclude-standard -- fixtures`＝**1421** 条，其中 `fixtures/todo-app/.agent/snapshots/**`＝**700** 份运行快照（`git status` 看不见它们） |

## 不在本笔的账（文件在别人手里，只记不修）

- `tests/head-cert-deps.test.ts`「真机整表」：`cell.notResolved` 期望 0、实测 **2**。该判卷与 `scripts/lib/head-cert-deps.ts` **都是 tracked 且脏**（对 HEAD 在飞）⇒ 归隔壁那一簇。
- `tests/mutate-needles-check.test.ts`「真 git 一次」：`expected '1f16bea7' to be '1f16bea'`。该判卷**在飞**。这一条的成因看着与在飞无关（git 对 `--format=%h` 的最小唯一缩写长度会随仓里对象数自动变长，钉死 7 位＝把尺的读数写成了字面量），但**判卷文件在别人手里 ⇒ 先只归因**，修法（改前缀断言）等让出。
