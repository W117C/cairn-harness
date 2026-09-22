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

## 追加二（同日更晚）：体检这把尺自己被量出两处越界，顺手把「绿而零输出」接进未证

### 改了什么（三笔提交，都能重跑）

| 提交 | 面 | 一句话 |
| --- | --- | --- |
| `776eb14` | 门禁汇总 | 绿而一个字没吐的门按「未证」计（`silentGreenGate` + `gateUnverified` 一个数同时喂汇总与账本）；**不建豁免名单**，唯一真会沉默的 `typecheck` 改为自己报结论 |
| `97adc4c` | 本文 | 把"装置成因"补成机制（见追加段） |
| `fed3ac0` + `714dcb6` | 断言体检 | 扫描面收成一份共用实现（`scripts/lib/scan-scope.ts`）；空断言 / 恒真式从按行正则改成 AST |

### 体检这把尺的前后对照（同一批评测面，实测差集）

| 判据 | 旧（行正则） | 新（AST + 位置） |
| --- | --- | --- |
| 已跟踪 `scripts/` 命中 | 0 | **0**（两支都在判卷面上跑过，`tests/assertion-health-scan.test.ts` 断言零命中） |
| 未跟踪在飞草稿 `scripts/sidebar-probe.ts` | gates 扫到 → **2 条命中 → 整张门表判红** | 不在判卷面（口径同快路） ⇒ **0** |
| 三参等值签名 `check(名, actual, true)` | 误判为空断言（3 条里中 2、漏 1——漏的那条只因参数带括号才侥幸） | 不报（条件位只看 args[0]/args[1]） |
| label-first 带 detail 的真空断言 `check(名, true, detail)` | **漏**（旧正则要求 `true` 在尾部） | 报 |
| 判据自己的文档注释里举反例 | **自命中 3 条**（块注释续行 ` * …` 不被 strip） | 不报（注释不是 AST 节点） |

最后一行是本轮最贵的一条：**想解释一句判据，代价是整表红**。旧写法把注释与代码喂给同一条行正则，
而"体检命中"是判红的 ⇒ 判据越界与漏判一样贵，它训练人来忽略红的含义。

### 变异表反过来抓到我一条没有分辨力的用例

`empty-assert-arity-guard-dropped` 当场**存活**：我把判据写成"实参个数恰好 2"，用例样本却是
`check(名, actual, true)`——`=== 2` 与 `>= 2` 在这个输入上同答（第二位不是字面 true），
所以那条锚点必然存活。**错的是用例选点，不是判据**；真正的不变量是**按位置**。
改成 `>= 2` 之后补了一支旧正则一直在网外的真空断言（`check(名, true, detail)`），锚点拆成两支、
各钉一格分歧，正反两面都有用例。⇒ 5 条新锚点在真装 worktree（HEAD=`714dcb6`）逐笔跑，
全部「被正确杀死」。

### 装置侧的两处自我更正（同一会话内两次同形状）

往 `scripts/mutate-verify.mjs` 的锚点数组尾部追加时，`old_string` 取到了**上一条完整的 anchor 块**、
`new_string` 只写新块 ⇒ 静默删掉一条锚点，**两次**（第一次靠 `grep` 那条 id 命中 0 发现，
第二次靠元素计数：改前 671，加 3 条应到 674，实测 673）。`git diff --numstat` 两次都照不到。
⇒ 收口办法写进用户档记忆：**列表追加前后各数一次元素，要求 `after = before + 新增条数`**。

## 追加三（同日）：⑵ 之后把 ⑴ 的绿侧也补了

`8746aae`：绿门现在在汇总里带出自己那句结论（`└ typecheck: tsc --noEmit 通过（0 条报错）✅`）。
取行规则是**从后往前找结论记号**而不是取最后一行——vitest 的收尾是 `Duration`/`Start at`，计数在它前面；
剥色吃 `lib/vitest-summary.ts` 那份共用件（同一族在那边已修过一次）。两条锚点分别钉"取哪一行"与"剥不剥色"，
在真装 worktree（HEAD=`8746aae`）逐笔跑，两条都被正确杀死。
至此 ⑴ 与 ⑵ 两件小事都落地；本文件里那句「`pnpm gates` 只回显退出码、把 stdout 吞掉」对**绿门**已过期
（红门早就带尾 12 行；绿门现在带一句结论 + 帽 160 字）。

## 追加四（同日更晚）：第一次在真装 worktree 里跑完整张表（HEAD=`e65d9a8`）

装置：`git worktree add --detach` + root `pnpm install --prefer-offline --ignore-scripts`（1.2s）
⇒ `TERM=dumb node --import tsx scripts/gates.ts --direct`。**这一条是本轮全部结论里唯一"跑齐全表"的读数。**

| 读数 | 值 | 定性 |
| --- | --- | --- |
| 逐道退出码 | 绿 30 / 33，红 3 | 三门红全部可归因，见下 |
| `panels-check` 红 | `spawn …/node_modules/electron/dist/Electron.app/…ENOENT` | **装置缺件**：`--ignore-scripts` 跳过 electron 的 postinstall ⇒ 该 worktree 里根本没有 Electron 二进制。不是代码红，也不是那条时序 flake |
| `mutate-needles-check` 红 | 阻断 6（3 沙箱 + 3 d7；`src/tools/snapshot.ts` 整文件不在 HEAD） | 别人未提交的原子簇 ⇒ #37 |
| `mutate-verify` 红 | 跑 1167s 后抛死：`src/tools/snapshot.ts 未跟踪…拒绝` | 同 #37 的**另一面**：同一份信息在逐条循环里判，等于烧掉 19 分钟且账本无痕 ⇒ 本轮已修（预检 3s 退出） |
| 未证 | 12 项 | 各门自报 `UNVERIFIED=` 之和；与"绿而零输出"合并计数后**本轮一门都不静默**（汇总里没有那行 ⚠️） |
| 体检 | 扫描面 50 个已跟踪脚本，零命中 | 未跟踪探针不参与判卷（本轮改的口径） |
| 门清单条数 | 33（主树在飞那份是 34） | 不写进任何文档——AGENTS 的"别写死门数"规矩；这里只作该日快照 |

### 修掉的那一件：预检（`d48e12d`）

`mutate-verify` 现在开跑前一次性算出全部 `refused` 并直接退出：**同一条件下 19 分钟 → 3 秒**（实测），
理由与名字都打出来。判卷文件在飞仍然只让那一条 `unverified`，不进拒绝名单——
否则并发窗口里别人一个未提交的测试文件就能把整道变异门停摆（这条正反两面都有用例）。
顺带一处新缺口（已立待办）：被 `kill` 的整跑会留下 `src/.../*.mutbak`，
而收尾校验 `git status --porcelain -- <srcs>` 按**精确文件路径**查，看不见同名 `.mutbak` 残留。

### 装置结论（进规则 52 的那族）

真装 worktree 也要看装法：`--ignore-scripts` 省时间，但 electron 的 dist 是 postinstall 拉的 ⇒
**凡跑 Electron/CDP 的门（panels-check 及一切真窗口判据）在这种装置里必假红**。
要么整装（不帶 `--ignore-scripts`），要么把 Electron 类门的读数标成"未证"而不是红。

## 追加五（同日第二次整跑，HEAD `f81f71c`）：30/33 —— 三条红全部归因，其中一条是「门自己把表停了」

隔离 worktree 真装依赖跑整表（`pnpm gates`，执行器 pnpm run）。汇总行：
`绿 30 / 33，红 3（panels-check、mutate-verify、mutate-needles-check）`，另有 `未证 12 项`。
逐道退出码里 `typecheck=0 test=0 e2e=0 … gym-check=0 routing-check=0 a11y-check=0`，
**test 门 `Tests 2036 passed (2036)` exit=0**。三条红的归因：

1. **`panels-check` 第一次红＝设备，不是代码**：`spawn …/node_modules/electron/dist/Electron.app/… ENOENT`。
   原因是**新装 worktree 根本没有 Electron 二进制**——`pnpm install --prefer-offline`（不带 `--ignore-scripts`）
   也不会跑 electron 的 postinstall 下载：`node_modules/electron/` 里只有 `index.js`/`.d.ts`，没有 `dist/`。
   ⇒ 补一条设备事实：**光「真装 worktree」不足以判 Electron/CDP 门**，还要
   `node node_modules/electron/install.js`（或直接在主树跑那一道）。
   补上之后同 HEAD 两次单跑：第一次 `滚动一屏 max 401.9ms ≤ 200ms` 红；**第二次同一断言 16.6ms 绿，
   整道门 `全部断言通过 ✅`（真退出码 0）**。24 倍的抖动幅度 + 只有这一条红＝AGENTS 记的那族挂载/宿主负载抖动，
   不是回归（这条判据是计时断言，与它相邻的 scrollTop 落位、DOM ≤300 两条都绿）。
2. **`mutate-needles-check` 红 6 条**＝待办 #37 那一簇（3 条 sandbox + 3 条 d7，`src/tools/snapshot.ts` 至今未跟踪）。
   锚点先落地、被测码从未入库，别人的原子簇，不在本轮改。
3. **`mutate-verify` 红＝门的形状有缺陷，本轮已修**：预检写的是「有条目不安全 ⇒ **一条都不跑**」。
   于是第 2 条那一个未跟踪文件，让 698 条锚点里与在飞改动毫无关系的 695 条**今天全部没判**，
   而红门只报一句「拒绝 1 条」——读起来像保护还在。改成**逐条跳过 + 其余照跑 + 仍判红**：
   不安全的那几条一个字节都不会被写（安全性没让），退出码照旧 1（AGENTS 说的「主动拒变在飞文件＝属正确红」不变），
   只是先把能跑的跑完，并把两类未证分开数（`未证 N 条（其中 R 条源文件在飞/未跟踪 ⇒ 根本没跑，U 条判卷文件在飞）`）。
   真跑到主树验过两条路径：混合 3 条 ⇒ 跳过 1、判 2、`UNVERIFIED=1`、**退出码 1**；全安全 1 条 ⇒ 杀、**退出码 0**。
   新增判卷 4 条 + 锚点 2 条（一边守「别停摆整张表」，一边守「不安全的一条都不许跑」——
   后者防的是我为了绿把安全性改回去）。

## 追加六（同日更晚，HEAD `f6eb35a`）：整张表第一次真跑完 —— 690 杀 / 8 未判，其中 2 条是假覆盖

逐条跳过生效后，那张几十分钟的表**第一次在没有在飞文件挡道的情况下跑完了全部 698 条**
（真装 worktree `/Users/ze/Downloads/dsh-gates-f81`，日志 `/tmp/mut-all-f6eb.log`，实测约 22 分钟：起 21:28:29、止 ≤21:50:40）：
**✅ 690 · ❌ 5 · ⏭️ 2 · ⚠️ 1**（`UNVERIFIED=3`）。8 条未判的分诊，全部读的是它们各自的第二行，不是标签：

1. **3 条 sandbox ❌**（`sbx-network-branch-dropped` / `sbx-network-escort-ors-conditions` / `sbx-note-gate-dropped`）
   原因一律是「**突变未生效（锚点可能已失效）**」⇒ 针脚匹配的是**主树里在飞的 `src/main/sandbox.ts`**，
   不是 HEAD。与 `--check-needles` 在主树报 0 阻断并不矛盾：那把尺量的是工作树（记忆第 61 条同族）。
   这就是待办 #37 那一簇，等那个原子簇入库。
2. **3 条 D7 ⏭️/⚠️**：`src/tools/snapshot.ts` 与 `tests/snapshot-d7.test.ts` 都未跟踪 ⇒ 源侧拒跑、判卷侧不可判。同一簇。
3. **2 条真缺陷（本轮已修）**：`worker-git-newline-not-a-separator` 与 `shape-downstream-option-forms-lost`
   都报「变异存活：测试全绿」——**这两条锚点在假装自己是覆盖**。

### 3-①：换行归一化那条，被 ⑩ 的按序面替掉了一半职责

`echo hi\ngit push --force` 在突变（去掉 `command.replace(/\r?\n/g, ";")`）后仍然被拦：
`push` 在破坏动词表内，⑩ 那段「扫本段独立 `git` 词 + 表内动词」不看切段也能命中 ⇒ 我原来的用例**恰好落在两支同答的那一格**
（记忆第 78 条：用例必须挑新旧规则答案分歧那一格）。分歧格是**表外但非只读**的动词：
`echo hi\ngit fsck` —— `fsck` 不在 `DESTRUCTIVE_GIT_SUBCOMMANDS`、切段后 `inv.bin === "git"` 成立且不在只读白名单 ⇒
只有归一化这一支撑得住。用例补了它，并配一条成对的放行侧 `echo hi git fsck`（无换行 ⇒ 两支都不认，
防「为绿而全拦」）。锚点文案未改，改的是判卷面 ⇒ 现在这条锚点真的会红。

### 3-②：下游选项族如今由两支共同成立 ⇒ 端到端那条必须一次废两支

`shape-downstream-option-forms-lost` 的存活是**结构性的**：⑩ 的按序面（`rules.ts:195` 的 token 候选）
对 `git -C /tmp push --force` 也能命中，且命中下标为 0 ⇒ 依旧是 deny。单废形态面，端到端结论一字不变。
拆成两条（表 704 → 705）：
- 原 id 改挂**这一支自己的观测者** `tests/command-shape.test.ts:104`「五类写法都产得出「git push --force」那一形」
  ——生产者侧有没有产假形，本来就该由生产者侧的尺量；
- 新增 `shape-downstream-option-both-faces-lost`（src=`rules.ts`），在同一个消费点上把 `commandForms` 与
  `invocations` 候选**一起**摘掉 ⇒ 剩下裸前缀匹配 ⇒ 「五支写法在自主档全由 L1-deny 拦下」必红。
  这条与既有的 `rule-matcher-deny-ignores-wrappers` 是同一对改法、不同判卷清单。

**这条给"同族"记法补的一面**：一支面被后来的面**接管**职责之后，旧锚点若仍挂在端到端结论上，
它就从"守门"悄悄变成"永远活着的假警报"——全表跑是唯一能看见这件事的手段（`--check-needles` 只看针脚还插不插得进去，
插得进去但踩的是别人的地板，它看不见）。

## 追加七（同日更晚，HEAD `daf8167`）：把「门被超时掐死」从一次性事故改成可自愈的状态

**触发**：追加六那次整跑是被外层掐死的（`pnpm gates` 对单道门约 1200s，实测 `exit=124`，用时 1200003ms；
这张表按当时条数要 20+ 分钟）。被掐死的位置若正好在「源文件已经是突变体、还没轮到还原」那一拍，
盘上就留下一对东西：未还原的突变体 + 它的 `.mutbak`。下一道门读到的是污染内容——
`--check-needles` 因此报出一条**假陈旧针脚**（当时是 `gemini.ts`），读的人去改一条本来好好的锚点。

### 现场是怎么造出来的（读数，不是推演）

用真信号做，不构造假状态：`node scripts/mutate-verify.mjs gym-draft-worker-writes-as-parent` 起在后台，
外部以 50ms 轮询 `git diff`，一命中突变窗口就 `kill -STOP` 冻住再 `kill -9`。
第一次尝试没冻住、只轮询——**整整 60 秒没看见窗口**：单条锚点实测 0.9s 跑完（三次 vitest 调用都在里面），
窗口是几百毫秒级 ⇒ 慢轮询永远量不到，这也是「被掐死」在真实链路里为什么难复现的原因。
落地污染：`src/agent/gym/draft.ts.mutbak` + 该文件 1 行 diff（正是那条锚点的改法）。

### 三条读数，改前 / 改后

| 读数 | 命令 | 结果 |
| --- | --- | --- |
| A（改前） | `mutate-verify gym-draft-worker-writes-as-parent` | 只报「预检拒 1 条 ⇒ 一条都不安全，判红退出」，**盘上残留一根手指都没碰** |
| B（改后） | `mutate-verify --check-needles` | `exit=1`（真退出码，不带管道），点名「残留 `…draft.ts.mutbak` ⇒ 同名源文件可能是未还原的突变体，下面的针脚不可信」 |
| C（改后） | 与 A 同一条命令 | 「⚠️ 自愈：还原 src/agent/gym/draft.ts」→ ✅ 该锚点判为被杀死 → `exit=0`，`md5` 与开跑前的纯净快照逐字相同，全仓 `.mutbak` 残留 0 |

**A 这一条是本轮真正的发现**：处置块原先排在预检分流**之后**，而「重跑被打污文件自己那条锚点」恰恰是
被污染那一轮**最容易想到**的动作——它会在 `entries.length === 0` 处提前退出。也就是说：唯一必然知道
「该文件被我们污染过」的那个人，被安排在一个看不见残留的出口后面。
判据只要 HEAD/备份/当前三份内容，与「本次跑哪几条」无关 ⇒ 提到分流之前调用（顺带：`stateOf` 的缓存
此刻还空着，自愈后那些锚点本轮就能照判，不必等下一轮）。

### 自愈的边界：不能越权

`leftoverActionOf(head, backup, current, isOurMutant)` 只有三条出路：
`restore` 要求 **备份 == HEAD 且当前 != HEAD 且当前这份正好等于本表某条锚点作用在备份上产出的突变体**；
`drop-backup` 只删过期备份；**其余一律 manual** 并打印两步人工判读（先 `git diff HEAD -- <src>` 看清两边）。
`isOurMutant` 这一支不能省：省了之后「备份落盘后别人自己改了同一个文件」与「我们上次没还原」
在那三份内容上**完全同形**，一次自愈就把别人的在飞改动抹掉——那是本仓最忌的不可逆越权。

信号处理器（SIGINT/SIGTERM/SIGHUP → `restoreInFlight`）留着，但注释写清它**不是**超时保险：
`runTest` 走 `execFileSync` 同步阻塞事件循环，实测 SIGTERM 打到 node 后 1.5s 内什么都没发生。
可靠的口子是下一次开跑按证据自愈，因为只有那一刻三份内容同时都在盘上。

### 判卷

新增 4 条锚点（`leftover-heal-ignores-is-our-mutant`、`leftover-heal-trusts-non-head-backup`、
`budget-missing-value-silent`、`budget-value-slot-treated-as-anchor-id`）+ 2 条因 `classifyArgs`
加值位分流而整行失效的旧锚点改指（`classify-unknown-flag-ignored`、`classify-flags-counted-as-ids`）
⇒ 这六条一次性跑完、变异全部被正确杀死（4.8s，`exit=0`）。
`--check-needles` 现 714 条：阻断 0、待复认 0、未覆盖 0；**改法语法体检当场逮到我写的一条把源文件改坏的
变异**（把 `consumed.add(i + 1);` 整句替换成注释，留下空 `if` 体）——这正是这一相存在的理由：
秒级能查出来的事，不留到几十分钟后伪装成「误伤无关用例」。

预算这条路（`--budget-ms` / `DSH_MUTATE_BUDGET_MS`）现在会**自己**在条目边界收尾，
未证从一类分成三类点名：源文件在飞没跑 / 判卷文件在飞量不出 / 预算用尽没轮到，
并新增本次耗时与「跑了几条 / 共几条」的读数——这张表到底要跑多久，此前没人打印过。

### 没做完的（一条，且被别人的在飞集挡着）

那道**约 1200s 的每道门超时本身**在 `scripts/gate-manifest.ts`，而该文件此刻在另一会话的在飞改动集里
（`git status` 显示 ` M scripts/gate-manifest.ts`）⇒ 按「只追加不改写别人的原子单元」的规矩没动它。
等它落地后要接的一行：给这一道门传 `--budget-ms`（或设 `DSH_MUTATE_BUDGET_MS`）**低于**外层超时。
在那之前 `pnpm gates` 仍会掐断整表——区别是：掐完留下的污染现在会被下一次开跑按证据自愈并出声，
而不是变成一条指向无辜锚点的假陈旧针脚。
「被掐死」这一相仍**没有**常驻判卷：它是脚本接线（调用顺序），没有任何测试观察得到；
本轮以读数 A→C 为证，留在本文里而不是伪装成一条锚点。


