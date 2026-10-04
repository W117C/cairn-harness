# 落库手册 · apply_patch 截断定位回执（2026-10-04）

本簇在隔离 worktree `.qoder/worktrees/agent-general-purpose-7f5785bb`（基线 `9099989e`，分支
`worktree-agent-general-purpose-7f5785bb`）里做完。**没有提交、没有推送**：工作树面是

    M  src/tools/patch-parse.ts                          (+171 / −8)
    ?? tests/apply-patch-truncation-receipt.test.ts      （新判卷，11 条）
    ?? outputs/apply-patch-receipt-2026-10-04/           （本目录四件）

> 本机 node_modules 不在隔离树里，本树用了一条符号链接 `node_modules -> <主树>/node_modules` 才能起 vitest/tsc。
> 它在 `.gitignore` 的两条覆盖之下（`node_modules/`、`.qoder/`），**不要**把它当本笔的一部分。

## 第 0 步：归属检查（现读，不许抄本页的数）

本笔写的数在下面这一节是 **2026-10-04 现读**的，隔壁会话随时在提交，落库前必须重新取一遍：

1. 主树 HEAD 与我的基线差几笔：现读 `git log --oneline 9099989e..HEAD | wc -l` ＝ **3**（HEAD `f91217dc`）。
2. 我动的/依赖的四支有没有被别人改过：
   `git diff --numstat 9099989e..HEAD -- src/tools/patch-parse.ts src/tools/apply_patch.ts tests/apply-patch.test.ts tests/promise-recall-inventory.test.ts`
   ⇒ 现读**空**（没变）。非空就先比 hunk，别直接贴。
3. 主树工作面脏不脏（`git status --porcelain -- src/tools tests/ src/agent/fork-cli.ts`）：现读
   `src/agent/fork-cli.ts`／`src/tools/process.ts`／`src/tools/run_shell.ts`／`src/tools/web-search.ts` 四支 ` M` 在飞。
   **本笔一支都不碰它们**（只**依赖** `fork-cli.ts` 的既有 import：它走的是解析成功路径，本笔没改成功路径的形状，
   只给 `PatchHunk` 加了一个可选字段）。⇒ 我这四支路径干净，pathspec 提交吞不到别人的行。
4. 贴得上验（只读）：把本簇导成 patch 后在主树**当前工作面**上验一遍，别只对 HEAD 验——
   `git -C <本树> diff HEAD -- src/tools/patch-parse.ts tests/apply-patch-truncation-receipt.test.ts > /tmp/p.patch`
   `git -C <主树> apply --check -3 /tmp/p.patch`（新文件要带 `--uncommitted`/`-3` 判读，退 0 才算贴得上）。

## 第 1 步：三件事**同笔**（拆半必留中间态，而且中间态是红的）

本笔的三件必须一起落，理由逐条是现测而不是推测：

- `src/tools/patch-parse.ts` ——实现。
- `tests/apply-patch-truncation-receipt.test.ts` ——判卷。**它必须先 `git add` 再 pathspec 提交**：
  第 366 页刚记的那格（裸 `git commit` 带 pathspec 时，未跟踪文件根本不进提交），而且
  `tests/promise-recall-inventory.test.ts` 的证人面**只吃 git 已跟踪的 `tests/**`**——判卷没进索引时，
  它把本笔新写的那句能力断言读成"没人判过"，该条**必红**（本树实测：未跟踪 ⇒ 红，`git add` ⇒ 绿 46/46）。
- `outputs/apply-patch-receipt-2026-10-04/`（四件）——工件。台账页若点名这个目录，D-11 要求它在 HEAD 追得到，
  所以**页与工件同笔**（第 365/366 页那条"新工件先 add 再 pathspec"照用）。

建议的 pathspec 形状（在主树，索引里躺着别人的暂存项，所以"只提交我的"只能由 pathspec 保证）：

    git add src/tools/patch-parse.ts tests/apply-patch-truncation-receipt.test.ts outputs/apply-patch-receipt-2026-10-04
    git commit -- <上面这四条路径> [<你的 PROGRESS 页文件>]

## 第 2 步：落库后立刻重跑（顺序就是分辨力的顺序）

1. 本笔判卷：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/apply-patch-truncation-receipt.test.ts`
   ⇒ 期望 11/11 绿。
2. 家族 10 支（读这个回执或吃 `patch-parse` 的全部判卷；本笔实测**只有全量家族里的那一支会喊**，见 §第 3 步）：
   `… tests/apply-patch.test.ts tests/apply-patch-truncation-receipt.test.ts tests/diagnose.test.ts tests/write-face.test.ts tests/prompt-surface-check.test.ts tests/permissions-tool-registry.test.ts tests/cli-fork-replay.test.ts tests/diff-review.test.ts tests/glm.test.ts tests/line-delta.test.ts`
   ⇒ 期望 151/151 绿（含 28 条既有 apply_patch 判卷：`ok` 与退出路径没动，就是为了让这 28 条一字不改照样绿）。
3. `tests/promise-recall-inventory.test.ts` ⇒ 期望绿（判卷已跟踪之后）。这条是**本笔唯一撞上的既有判卷**，
   它不吃文案、只查"能力断言有没有证人"，见 `change.md` §5 撞面①。
4. `node --import tsx scripts/typecheck.ts` ⇒ 期望退 0（本树实测退 0）。
5. 全量核心判卷：本树落库态现读 **6 条红**，6 条都在**摘掉本笔之后照样红**（靶子/机器态/台账态，逐条对照见
   `readings.txt` T4）。若主树那趟的红条数与名单对不上，先按第 363 页的口径去分"哪条是我这笔、哪条是隔壁在飞"，
   别拿"全量红了"当本笔的否决，也别拿"以前也红"当豁免。

## 第 3 步：认证与变异锚点（排在实现之后，且 `mutate-verify` 只测 HEAD）

- `pnpm mutate-verify` 度量的是 **HEAD**，且它要求实现已提交（本树是隔离树，AGENTS.md 那条"主检出里直接跑会被拒绝"照旧）。
- 若要给这一格补锚点，`scripts/mutate-verify.mjs` 现读**没有**指向 `src/tools/patch-parse.ts`／`apply_patch.ts` 的条目。
  两根候选（本树的 `red-mutations.txt` 已经把分辨力量过了，可直接照抄成锚点的 `expectFail`）：
  ① **摘掉接线**（删掉抛错时的 `patchTruncation(…)` 实参）⇒ 恰好红 8 条定位类用例、三条反向守卫照绿；
  ② **符号位取反**（`over = false`）⇒ 恰好红"实收比声明多"那一条。
  插锚点前先 `grep` 一遍用例标题（`scripts/mutate-anchor-titles.ts` 那把尺会点名字面），别钉字面、要钉调用后的结果。
- `scripts/mutate-verify.mjs` 主树现读在隔壁手里（`#50` 债）⇒ 锚点那一笔与本笔**分笔**，别把别人的在飞面卷进来。

## 第 4 步：回收

本树用完可以回收（`git worktree remove`），但**先把 `src/tools/patch-parse.ts` 的 diff 与本目录四件取走**：
`node_modules` 那条符号链接是本树自建的，回收前删不删随流程，它不在任何提交里。
