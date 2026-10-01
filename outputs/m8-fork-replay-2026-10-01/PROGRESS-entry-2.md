### 2026-10-01 · M8 增量 · worker diff 逐文件接受/拒绝（终端多选）落地；并修掉「diff 整块渲染在主干路径从未生效」的断口（两侧标记加棘轮）

取料面（全名逐支）：`outputs/m8-fork-replay-2026-10-01/` 下 `LEDGER.md`（"增量"一节）、`reverse-verify-review-hash-{before,after}.txt`、`reverse-verify-review-flip.log`、`reverse-verify-review-restored.log`、`full-suite.log`；判卷 `tests/diff-review.test.ts`。

1. **交付**：`src/agent/diff-review.ts`（纯逻辑 + 真 git 还原；交互留在 cli.ts）+ `src/cli.ts` 的 `reviewWorkerDiffs` 流程 + `fork-cli` 同判定 + `tests/diff-review.test.ts` 14 条。PLAN §M8 的「把 worker diff 输出成可逐文件接受/拒绝的交互流程（终端多选，不依赖 UI）」履约：跑完后（TTY）逐 worker 列出文件（新增/修改/删除 + numstat），`a` 全合并 / `r` 全拒绝 / `1,3`（或 `1、3`）编号子集 / 回车跳过。
2. **三个决策落点全部走既有协议**（不另立第二套合并机制）：全要 ⇒ merge 卡；全拒 ⇒ reject 卡；子集 ⇒ **先把被拒文件在 worktree 里还原**（worker 改动 merge 前未提交地留在 worktree，`commitAndMerge` 才 `git add -A`）**再发 merge 卡**，payload 记 `accepted_files/rejected_files` 进事件流审计。还原失败或遇改名/复制（manual）时**不发合并卡**——拒绝的绝不混进合并。
3. **实测断口（本增量修）**：第 245 页起 diff 收据的 callId 走 **spawnCallId**（回执合并语义），而 CLI 的"整块打"判定还写着 `callId.startsWith("diff-")` ⇒ **主干路径上 diff 从未整块渲染**（`cli-surface` 夹具当年喂老形状所以一直绿——判卷与被测现实分家）。修法：按生产端有意埋的 `[diff] v` 头判定（老兜底支保留）；`diff-review.test.ts` 配跨文件棘轮（orchestrator 源码仍写 `[diff] v`），再分家当场红；`cli-surface` 夹具同步成真形状。
4. **真 git 读数**：判卷在 tmp 仓库真跑还原——被拒的改回原样、被拒的新档删掉、被接受的改动与删除原样保留；越界路径拒绝执行。porcelain 的 `-z` 改名条目顺序按**真 git 实测**钉死（目的地在先、来源在后，`R  new\0old`——与人类可读格式相反）。
5. **反向验证**：把「新增⇒删文件」错分成「checkout」⇒ 2 条红（计划单测 + 真 git 夹具），exit=1；复原 sha256 `c3fa6c9…` 逐字节同 ⇒ 14 绿。
6. **边界（如实记，全文在 LEDGER）**：未做真 TTY 端到端（逻辑全在可离线判卷的 helpers；合并动作由既有 m3c/orchestrator 判卷覆盖）；改名/复制条目不自动还原；合并塔随进程退出失效（跳过/非交互打出现场与手工命令）；全拒会清 worktree（prompt 明写）。
7. **判卷/门/typecheck**：全量判卷 `Test Files 270 passed (270)｜Tests 3628 passed (3628)｜exit=0`（较 M8 主笔 3613 ⇒ 只增不减）；typecheck 0 报错（`typecheck-inc.log`）；受影响批次（diff-review/cli-surface/cli-fork-replay/cli-exit-code/tool-surface-parity）102 条全绿。
8. **实测踩坑（值得全仓记一笔）**：本增量润色过 `cli-surface` 里一条 `it` 标题，全量随即在 `head-cert-deps` 的「真机整表」红一条——那条判卷把**留档全量 json**（`outputs/judge-timeout-2026-10-01/suite-quiet.json`，已入库）里每一行的**标题**当重数键，在现源码里重找成因；标题一改，`notResolved` 0→1。处置：标题**逐字恢复**（准确描述移进块注释）＋在测试块头写明「改名要同时重产那份留档 json」。与 `cfa91e1`（路径转义把分母吃光）、M2 探针（截断被读成不符）同族：**判定输入的键漂了，红的是覆盖它的每一笔**。
