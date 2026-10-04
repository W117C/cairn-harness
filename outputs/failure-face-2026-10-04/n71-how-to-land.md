# `#71` 落地手册（簇已在 `.worktrees/verify-c7f2ea0f` 逐条跑过，只差那一步"永远由人做"的动作）

## 现状读数（同一棵隔离树，HEAD 面＝主树 HEAD）

| 项 | 读数 |
| --- | --- |
| 门 `no-progress-check` | NP0／NP1／NP2／NP3／NP4 **全绿**，只有 **NP5 红**：语料 9 份／表内核对 9 份 ⇒ 不在表上 2 条（就是新增的两份） |
| `tests/no-progress.test.ts` | **26／27 绿**，唯一红的那条正是 NP5 的测例镜像（`expected false to be true`，点名那两份文件） |
| 改动面 | `src/agent/no-progress.ts` +23/−11 内 · `scripts/no-progress-check.ts` +19/−1 · `tests/no-progress.test.ts` +20/−2 · 新增夹具 2 份（各 9 行） |

补丁本体：`n71-ready-cluster.patch`（147 行，含两份新夹具的全文）。门与判卷读数：`n71-gate-in-tree.log`／`n71-judges-in-tree.log`。

## 唯一还缺的一步＝人做的冻结

往 `scripts/frozen-sha256.json` 追加两行（现读该区 7 条、文件干净）：

```
"fixtures/no-progress/synth-red-repeat-readonly-shell.events.jsonl": "e9726ed369bb06b7ae4e8e06e4eb65dd45f239e1d86e04fdb27d572c078774af",
"fixtures/no-progress/synth-red-repeat-shell-write.events.jsonl": "643257dc8942d39289d6f1c5fb341473fb5dbb5e6cd6cbdef8429720d59c5de3"
```

**这两行为什么不由我写**：`scripts/gym-draft.ts:48` 把「新文件登记进 `frozen-sha256.json`」明确列为
**永远是人的动作**（冻结判据是本仓第一纪律里唯一必须由人做的那一步）。上面那两串 sha 是我算的，
但它们进入冻结表这个动作本身就是"业主认这几行事件是标准"的签字，不该由改判卷的人代签。

## 顺手要说清的一格：翻 label 冻结表拦不住

`scripts/no-progress-check.ts:33` 的注释写着「标签是判卷标准的一部分——改标签等于改判据，走 `scripts/frozen-sha256.json`」。
现读：标签住在**脚本里**（`NO_PROGRESS_CASES`），冻结表钉的是**夹具文件** ⇒ 把 `fire` 改成 `silent` 这件事
**不发生哈希变化、NP5 一声不响**。本次那格改判（`real-red-verify-stagnation`：fire → silent）有证据
（第 245 步 `printf … > .npmrc` 是真写盘，见 `r1-drift-notes.md`），但机制上它确实是一次**门拦不住的改判**
⇒ 更该由人判，而不是由我贴上去就落库。这一格值得单开一条：要么把 label 表也纳入某只哈希，
要么在页面点名规则里强制"改 label 必须同页给证据"（现有 D-11 只管工件，不管 label）。

## 落库时的顺序（别拆）

1. 业主拍 ③（那条真实录制到底算不算停滞）；拍了再动。
2. 五件事**同笔**：`no-progress.ts` 迁移 + 两份夹具 + `no-progress-check.ts` 表 + 测例三条 + 冻结表两行。
   拆开任何一半都会留下"门绿而判据分叉"或"夹具在场而无人读它"的中间态。
3. 落库后立刻在干净树里逐条杀本笔新增的两根锚点候选（`#50` 债）：摘迁移 ⇒ `synth-red-repeat-shell-write` 必红；
   删只读那一份 ⇒ `synth-red-repeat-readonly-shell` 必红。
