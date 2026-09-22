# HEAD 态整表门审计（2026-09-23 01:3x，HEAD `83b475b`）

## 为什么值得跑这一次

今天连着三次撞到同一件事：**门在主树里绿，在 HEAD 里红**（`mutate-needles-check` 差 4 条、`test` 差 2 条，
全是别人在飞改动把仓库补圆的）。既然单道门逐条复算贵，就一次性把整表搬到干净 HEAD 上跑。

## 装置（先说清楚它能不能测要测的东西）

```bash
git worktree add --detach /tmp/dsh-gates <HEAD>
ln -s "<主树>/node_modules" /tmp/dsh-gates/node_modules
cd /tmp/dsh-gates && TERM=dumb node --import tsx scripts/gates.ts --direct
```

- **别用 `pnpm gates --direct`**：AGENTS.md 那条在这个装置里连不上——`pnpm` 的装前自检在进脚本之前就炸，
  而且它把**主树的 `node_modules` 当成待清理目录**（`ERR_PNPM_UNSAFE_MODULES_DIR: Refusing to remove …`），
  只是被它自己的守卫拦住了。仓内早就有正确的入口：`gates.ts` 的 `--direct`（它自己第 10 行注释就写着
  「绕开 pnpm 的 deps 检查：主树被别的会话占着时，去隔离 worktree 跑整表」），直接 `node --import tsx` 起它即可。
  ⚠️ 我一开始没找到这个入口，自己另写了一个按 `GATES`+`gateCommand` 驱动的脚本——跑通后删掉了：
  **同一个入口不要建第二份**（找接缝要先看现有入口，这次是我自己踩自家记过的那条）。
- 顺带一条驱动 bug 的代价：`gateCommand` 是 `(name, opts)` 两参数（`scripts` 在 opts 里），我按三参数传，
  `opts.direct` 成 undefined ⇒ 每道门静默退回 pnpm 支 ⇒ 第一次读数是「32 道门全红」。
  那是装置坏了，不是仓库红了。**长表跑之前先打印前 2-3 道解析出来的命令看一眼**（一条 `console.log`）。
- `mutate-verify`（全量变异表）本轮**跳过**（单跑要一两个小时级）；其余 32 道全跑。

## 表：32 道跑了，27 绿 / 5 红，逐条归类

绿（27）：`typecheck`(3s) · `build` · `sandbox:check` · `fork-check` · `docs-check` · `autonomy-check` ·
`compaction-check` · `panels-check`(**137s**，186 条断言含 B24/B25) · `tools-check` · `map-check` ·
`prune-check` · `providers-check` · `provider:check` · `memory-check` · `plugins-check` · `sidechat-check` ·
`security-check` · `agents-check`(14s) · `schedule-check` · `commercial-check` · `gym-check` ·
`routing-check` · `supervisor-check` · `renderer-arch-check` · `model-surface-check` · `a11y-check` ·
`ipc-reachability-check`

红（5）——**只有第一条是能确证的 HEAD 事实**：

| 门 | 归类 | 证据 |
|---|---|---|
| `mutate-needles-check` | **真红**（与装置无关） | 4 条锚点针脚摸不到已提交的码：沙箱那 3 条（`bdaa6f4` 提交锚点、`git log -S` 证明被测串从未入库）+ `d7-snapshot-taken-for-new-file`（`src/tools/snapshot.ts` 在 HEAD 里根本不存在）。⇒ 待办 #37 |
| `e2e` | **装置红** | 靶子基线读数是 `-1 failed \| -1 passed (exitOk=false)`——`fixtures/todo-app` 的 `pnpm test` 在软链 worktree 里起不来；判卷文件 sha256 一致、事件流断言两条全绿 ⇒ 断的是"跑不了"，不是"跑坏了" |
| `ipc:check` | **装置红** | 同上（同一句 `-1/-1`，重放等价与事件序列断言全绿） |
| `gate-check` | **装置红** | 同上（4 项未过里含"靶子开工状态 = 1 failed"这条基线读不到） |
| `test` | **不能定名** | 红的正是 `gated-tools` 与 `runner-gates` 这两支**经 `run_shell`→`pnpm`** 的判卷面 ⇒ 规则 52 里"在软链 worktree 必红"的那两支；同装置跑的 `panels-check`/`agents-check` 全绿，说明不是代码塌了 |

## 由此要改的两处旧断言（都是我自己写的）

1. **待办 #33 的「HEAD 上有 2 条红测」这句话没有证据**。它和我今天这份读数是同一台不称职的装置给的。
   要判这两条，得在**真装 `node_modules` 的 worktree**（或把那两个文件从主树临时移出后在主树跑）里读；
   在软链 worktree 里读出的红一律不得当成 HEAD 事实。
2. AGENTS.md「HEAD 现态」段引用过同一个读数 ⇒ 该段也要按 ⑴改口径。**那张表面此刻在别人手里**
   （`M AGENTS.md`），不代改，写在这里等那笔提交一并收（已并进待办 #6 的邻项）。

## 这次审计换来的正面结论

`panels-check`（137s、真窗口 + CDP）、`agents-check`、`map-check`、`security-check`、`a11y-check`、
`renderer-arch-check`、`build`、`typecheck` 在**只有已提交代码**的树里全绿 ⇒ 本会话这几笔交付
（壳不变量的逐型通判、「恰好一个壳」的另一半、影响面读端三分诊、grep/glob 阴性说明、三份记录）**没有把
任何一道门从绿推成红**；HEAD 上确证的缺口只有「锚点先落地、被测码没跟上」这一族。
（这里刻意不写「N 笔提交」——数字一漂就成了下一颗过期字，本仓对门数/测试数早立过同一条规矩。）

## 换装置重跑（真装 worktree）：上一条读数里有一处假红，另一处红变得更严重

`git worktree add` + `pnpm install --prefer-offline` 在暖 store 上是 **3.4 秒 / 288MB**——我原先假设它"慢"，
为了省这 3 秒一直用软链，而软链正是规则 52 里"测不到 pnpm 那一跳"的装置。换上真装后（HEAD `4bc60d5`）：

| 门 | 软链 worktree | **真装 worktree** |
|---|---|---|
| `test` | 2 failed（`gated-tools`、`runner-gates`） | **exit 0，196 files / 1982 tests 全绿**（65.5s） |
| `e2e` | ❌ 装置红 | **exit 0**（3.3s） |
| `ipc:check` | ❌ 装置红 | **exit 0**（2.0s） |
| `gate-check` | ❌ 装置红 | **exit 0**（2.1s） |
| `mutate-needles-check` | 阻断 4 | **阻断 6** |

### 由此撤掉一条待办的立论

**#33「HEAD 上有 2 条红测」是从一开始就是假的。** 那两条正是经 `run_shell`→`pnpm` 的判卷面，
在软链 worktree 里必红（规则 52 早就这么写，我自己 09-22 还引用过它，却还是把红登记成了 HEAD 事实）。
真装装置下它们 4 条全绿。⇒ 待办已结案为"假红·装置成因"，AGENTS.md 的「HEAD 现态」段也该按这个口径改（待办 #6 第 ⑶ 条）。
**立"HEAD 有红"这类待办之前，先用真装 worktree 复现一次——它只要 3 秒。**

### 反而更严重的：HEAD 上断针从 4 条变 6 条

新增两条与沙箱那族同形状（锚点先提交、被测码还在别人工作树里）：
`d7-worker-optout-ignored`（`src/tools/write_file.ts`）、`d7-snapshot-id-not-in-event`（`src/agent/loop.ts`）。
`d7-snapshot-taken-for-new-file` 的 `src/tools/snapshot.ts` 在 HEAD 里仍不存在。⇒ 已并入待办 #37（现记 6 条）。

### 顺手量到的一处可诊断性缺口（以及我在这段里写错的一句话）

`scripts/gates.ts` 只回显每道门的 **exit code**，把门自己的 stdout 吞掉（`▶ test … ✅ test exit=0 66906ms`，
没有任何 `Test Files / Tests` 行）。⇒ 整表跑完看不出"这道门到底跑了多少东西"，要数就得单独复跑那道门。

**但这一段最初给出的理由是错的，按实测改在这里**：原文写「`vitest run` 在收集到 0 个测试文件时退出码也是 0」，
并据此把它说成 fail-open（"零观测也算绿"）。真装 worktree 里跑一次便知：

```
$ node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/no-such-file-xyz.test.ts
exit=1
No test files found, exiting with code 1
```

⇒ 空集**是**判红的，退出码这条链没漏；缺口只到"看不见跑了多少 / 红的时候看不到输出"这一级。
（规则 75 的同一条：结论连着证据走，证据一翻就先撤结论再改口径，别把错话留在往下引的位置上。）

真正值得补的两件小事（干净表面，已立待办 #39）：⑴ 门红时把该门自己的输出尾几行带出来——现在只有一句
`exit=1`，本次审计 5 条红里有 3 条我是靠单独复跑才看清"红的是装置"；⑵ **绿而一个字都没吐**的门，
应进现成的「未证项汇总」（`DSH_STRICT_UNVERIFIED` 那条链已在），而不是当通过。

## 追加（同日夜间，HEAD=776eb14）：把"装置成因"这句补成机制，并记下我试错的那一次

上面已定名"假红·装置成因"，但**没写下机制**——只写结论的话，下次换一个人还是会踩。现在补上，并顺手在
我自己的新提交（`776eb14`，门禁「绿而零输出」那笔）之后重算了一次，读数照旧：

| 装置 | 命令 | 读数 |
| --- | --- | --- |
| 软链 worktree（root node_modules 是指向主树的 symlink） | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/agents.test.ts tests/gated-tools.test.ts tests/runner-gates.test.ts` | **2 failed / 26 passed**（红在 `gated-tools:62` 的 `run_shell` 结果 `ok=false`、`runner-gates:77` 的 `verify_result` 缺 `ok=true`） |
| 同一 worktree + 把 `fixtures/todo-app/node_modules` 也软链过去 | 同上 | **一字未变**（2 failed / 26 passed） |
| 真装 worktree（root 跑 `pnpm install --prefer-offline`，1s） | 同上 | **3 files / 28 tests passed，exit 0** |
| 主树（HEAD 码 + 别人的在飞 hunk） | 同上 | 28 passed（不能拿来定名 HEAD，只是说明在飞态没坏） |

### 机制（这次是量出来的，不是猜的）

`fixtures/mock/todo-fix.jsonl` 第 6 行是冻结剧本：`{"name": "run_shell", "args": {"command": "pnpm test"}}`。
⇒ 这两条用例的**被测路径内部还有一跳 `pnpm`**（不是 vitest 直接跑断言）。在软链装置里那一步当场报：

```
[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove the modules directory at
"/Users/ze/Downloads/deepseek harness/node_modules" because its resolved target is not a strict
subdirectory of the project root at "/private/tmp/dsh-anchor-776".
```

（这条不是我复述规则 52——是我在同一个装置的 `fixtures/todo-app/` 里真跑 `pnpm install` 时它自己吐出来的。
红在工具结果里，所以断言面只看得见 `ok=false`，看不见这句话。）

**我试错的那一次**：先假设"红是因为靶子缺依赖"，把 `fixtures/todo-app/node_modules` 软链进 worktree ——
读数一字未变。原因随后查明：`fixtures/todo-app/package.json` **一个 dependencies 都没有**，
`vitest run` 靠向上走到仓库根的 node_modules 解析；靶子目录本身不是缺失项，缺的是**那一次 `pnpm` 调用的
目录安全检查**。⇒ 记法：**先量"红在哪一跳"，再挑补哪个目录**；补错了地方而读数不动，本身就是排除证据。

### 于是规则 52 的边界清楚了一格

不是"worktree 里跑了 pnpm 就不可信"，而是：**判卷路径上任何一跳 `pnpm`（含被测 agent 自己执行的
`run_shell` 命令、verify 门、e2e 剧本）在软链装置下必红**，红形是"工具结果 `ok=false` / `verify_result` 缺
`ok=true`"这种**没有差异可看的断言**，而不是数值对不上。看到这两形状先换真装装置，别去改代码或改判据。
真装装置代价：root 一次 `pnpm install --prefer-offline` = 1s（靶子目录不用装）。

顺带重算：`node scripts/mutate-verify.mjs --check-needles` 在 HEAD=776eb14 上仍是 **阻断 6**（3 沙箱 + 3 d7，
`src/tools/snapshot.ts` 整文件不在 HEAD）。⇒ 待办 #37 记数不变；那 6 条属于别人未提交的原子簇，不该由我改指。
新增的 3 条锚点（`silent-green-not-charged` / `-predicate-dead` / `-overreach-onto-red`）在同装置下逐笔验过，
全部"被正确杀死"。

**编号校正**（往上读第二段「已立待办 #39」时会被带错）：那件「绿而零输出按未证计」已落地 = `776eb14`。
⑴ 那件的**红侧**半边实测早就有（`── 失败输出尾 12 行 ──`），不必再立；**绿侧**没做——门绿的时候 stdout
整段丢掉，所以"这道门到底跑了多少东西"仍要单独复跑才看得见。
`#39` 这个号现在指本轮新量的两处体检判据缺陷（扫描面混入未跟踪草稿 + 空断言误判三参等值签名）。
