# 第 411—413 页这一簇的原始读数取料面（补 provenance.md 没覆盖的那几格）

目录＝`outputs/head-cert-6020f99-2026-10-07-1636/`。`provenance.md` 是 head-cert 自己生成的认证面（门表／逐道门耗时／全量判卷汇总），**它不含**下面这些——第 413 页引用的 `14`、`2` 两格读数在这一份里有原文，别的页若引用下面任何一行，取料面也是这一份。

所有命令都在本机 macOS（Node v24.18.0）实跑；每格都写了取料面是**主树（脏）**还是**干净树（detached，0 项在飞）**，同一个计数在这两个面有两个真值。

## 1. 本簇两份新判卷（主树，脏工作树）

命令：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/lessons-recurrence.test.ts tests/replay-faces.test.ts`

```text
 ✓ tests/replay-faces.test.ts (3 tests) 3443ms
   ✓ 复跑面保护 · replay:lessons-round-ab（可达那一半 + 诚实声明面） (2)
     ✓ 真跑：exit 0，且「不可达」那句声明仍在（防被删掉、让这面看起来测了全部） 1341ms
     ✓ 硬不变量：跑前跑后 fixtures/todo-app **整棵树**逐字节不变（面只动自己的隔离目录） 1867ms
 ✓ tests/lessons-recurrence.test.ts (11 tests) 5ms

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  00:16:40
   Duration  3.91s (tests 91%, import 2%)
```

退出码直接取、不接管道：`VITEST_EXIT=0`。14 = 11 + 3，两份都是新文件（`git show --numstat` 里 `tests/lessons-recurrence.test.ts 169 0`、`tests/replay-faces.test.ts 126 0`）。

## 2. 针脚体检（同一把尺跑两遍，用来互相印证归因）

命令（两个面同一条）：`node --import tsx scripts/mutate-verify.mjs --check-needles`

主树（脏，212 项在飞）：

```text
针脚体检：1476 条 —— 阻断 2，待复认 2，未覆盖 1，逐行式 5，未入库面 0（被测面 + 判卷两面），钉在飞文本 0，killer 指针失效 0（其中 HEAD 侧 0）
[mutate-needles-check] 2 条锚点针脚/改法失效 ❌
NEEDLES_EXIT=1
```

干净树 `.worktrees/gate-mutate-verify`（`TREE=46cde6b7 DIRTY=0`）与 `.worktrees/verify-6020f99`（`TREE=6020f999 DIRTY=0`）两棵各跑一次，输出同形：

```text
针脚体检：1476 条 —— 阻断 0，待复认 2，未覆盖 1，逐行式 5，未入库面 0（被测面 + 判卷两面），钉在飞文本 0，killer 指针失效 0（其中 HEAD 侧 0）
[mutate-needles-check] 全部锚点针脚可判定 ✅
NEEDLES_EXIT=0
```

脏树那 `阻断 2` 的归属探针（`grep -cF` 逐字串，退出码不接管道）：

```text
needle A "if (view === null || view.stopped !== null) return null;"
  git show HEAD:src/main/agent-runner.ts | grep -cF → 1
  grep -cF src/main/agent-runner.ts            → 0
needle B "DEFAULT_MODEL_TABLE.filter((s) => s.provider === picked.prov"
  git show HEAD:src/agent/orchestrator.ts  | grep -cF → 1
  grep -cF src/agent/orchestrator.ts                → 0
```

⇒ 两条针脚在 HEAD 逐字在场、在当前工作树不在场＝实现正被别人搬走，不是针脚坏了。

## 3. 认证树里那条红（两半分开算）

命令：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/prompt-surface-check.test.ts`（干净树 `gate-mutate-verify@46cde6b7`）

```text
 ✓ tests/prompt-surface-check.test.ts (32 tests) 30ms
      Tests  32 passed (32)
PS_EXIT_CLEAN=0
```

命令：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/scratch-tree-naming.test.ts`（同一棵干净树，且我这侧的多余复认树已回收之后）

```text
 ❯ tests/scratch-tree-naming.test.ts (13 tests | 1 failed)
      Tests  1 failed | 12 passed (13)
AssertionError: 暂存树 gate-mutate-verify 的名字没编码提交（约定是 <前缀>-<sha>）⇒ 回收时无法从名字认出它钉在哪一笔: expected [ { kind: 'no-sha-name', …(1) } ] to deeply equal []
NAMING_EXIT=1
```

同一份判卷在认证那一趟（`.worktrees/verify-6020f99` 还在时）的第二条读数是 `2 棵暂存树钉在同一个提交 6020f99957dd：head-cert-6020f99、verify-6020f99`——那一半由我自己造成（多开了一棵复认树），回收后只剩上面这一条。

## 4. 变异复认：派生名单与那一刀

命令：`node scripts/mutate-verify.mjs --changed-since=46cde6b7 --lock-tag=judge-411-412`（在 `.worktrees/verify-6020f99`）

```text
改动面派生：rev=46cde6b7 → 变更文件 7 个 ⇒ 选中锚点 0/1476 条
ℹ️ 选中 0 条：改动面里没有文件是任一锚点的两面之一（纯文档/配置改动会这样）⇒ 这**不是**「整表验过了」。
[mutate-verify] 锁=本进程持有（.git/dsh-tool-locks/mutate-verify-judge-411-412.lock）
变异验证：1476 条
```

⇒ 派生取到 0 条之后机器把「无限制」当默认、**升级成整表跑**（`scripts/mutate-verify.mjs` 里 `const requested = targets.length ? MUTATIONS.filter(...) : MUTATIONS` 那一支）。我在 `493/1476` 处主动终止（工具调用超时后由我下手砍）：

```text
KILLED_AT=493
SURVIVORS=1（其中真变异存活 0 条）
❌ finish-throw-orphans-terminal-waiters — …… ｜本机实测 9.9s／2 拍
   finish-throw-orphans-terminal-waiters — 突变这一拍选中 未取到（收尾行没读到＝取料坏）⇒ 不许当成绿也不许当成红
```

那条 ❌ 是被砍出来的第三态（取料坏），不是判卷红也不是变异存活；493 条里真存活 0 条。

## 5. 体量帽与主树门（隔壁在飞，本页只登记）

命令：`node --import tsx scripts/repo-hygiene-check.ts`（主树，脏）

```text
  ❌ 面② 单文件体量 — 超帽 1 支：src/main/agent-runner.ts 3107 行
     为什么要有这条：src/main/agent-runner.ts 3107 行 > 帽 3100；见 docs/optimization-plan-2026-10-02.md W4
[repo-hygiene-check] ❌ 1 面红
HYG_EXIT=1
```

同一文件行数两面各一：`git show HEAD:src/main/agent-runner.ts | wc -l` ⇒ `2970`；`wc -l src/main/agent-runner.ts`（工作树）⇒ `3107`。认证树里 `repo-hygiene-check exit=0 355ms`（见 `provenance.md`）⇒ 这条红只在脏工作树面，属隔壁在飞。

命令：`node --import tsx scripts/typecheck.ts`：主树 `TC_EXIT=0`、干净树 `TC_EXIT=0`（`typecheck: tsc --noEmit 通过（0 条报错）✅`）。
