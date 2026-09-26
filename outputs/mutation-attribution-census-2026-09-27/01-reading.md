# 变异表归因普查（2026-09-27，第 141 页）

## 为什么跑

第 140 页复认「针脚命中 2 处」时撞见一个更基础的问题：runner 判「这条锚点杀掉了」用的是
`hit.out.includes(m.expectFail)`，而 vitest 的默认 reporter **把通过的用例也逐条列出来**（`✓ …`）
⇒ 一条绿用例就能把这句满足掉。于是「锚点声明的 killer 到底红没红」这件事从来没被证明过。

修法见 `scripts/lib/mutate-gates.ts` 的 `failingTestText` / `killerAttributionOk`（只认失败面：
`FAIL <file> > <套件> > <标题>` 与 `× / ✕ / ✗` 行）。修完必须回答：**整张表里有多少条锚点其实一直红在别的用例上？**

## 怎么跑的

- 树：`.worktrees/attribution-census-727bad3`（`git worktree add --detach` 于 `727bad3`，`node_modules` 软链主树的）。
  **必须在独立树里跑**：831 次「就地改源文件再还原」落在共享工作树上，随时会把别人同时的编辑按原样盖回去。
- 命令：`node --import tsx scripts/mutate-verify.mjs`（整表），日志 `/tmp/attribution-census-727bad3.log`。
- 现态：`跑了 831/831 条`、`本次耗时 1308.6s`（21.8 分钟），汇总行印 `180 条变异存活或误伤`。
- 分类口径：取每条 `❌` 后面的**第一行判读**（不是我第一版那样在整块里 grep 关键字——那会把
  「基线不绿」块里的 `FAIL` 行误读成归因失败，我第一版就多算了 4 条）。

## 读数

| 判读 | 条数 | 说明 |
| --- | --- | --- |
| 归因成立（红在声明的那条用例上） | **651** | |
| 基线就不是全绿（**根本没量到**） | **167** | 见下面按因分组 |
| 测试红了但没红在期望用例上 | **10** | 真·假归因，全部复认完毕 |
| 突变未生效 | 2 | 与秒级静态尺的「钉在飞文本」两维**逐条对上**（见下） |
| 变异存活 | 1 | `agent-area-lexical-dropped`（逐行式 apply），另立任务 |

### 167 条「基线不绿」的成因（这才是这张表最贵的格子）

| 条数 | 成因 |
| --- | --- |
| 111 | `Cannot find module '../providers/capabilities'`——**#11 那批未入库模块**：HEAD 里 `src/main/agent-runner.ts:63` 指着它，文件本身只有盘上有 |
| 23 | `tests/mutate-verify-gates.test.ts` 红，红的那条是真表自证 ⇒ 内因 `supervise-retired-error-verdict-revived/not-found`：别人把锚点行入库了、判卷里那条新标题没入库（同一格半落库） |
| 16 | `tests/docs-check.test.ts > D-8 … > 迁移后无存量豁免` 红：HEAD 上残留 **10 项**（首条 `D-1|AGENTS.md`），修复只存在于盘上 ⇒ 属 #2/#6 |
| 6 | `tests/map-parse.test.ts` 红 |
| 4 | `tests/mutate-anchor-titles.test.ts` 红 |
| 7 | 其他 |

⇒ 结论要说准：**整张变异表里约 20% 的格子在 HEAD 上量不出分辨力**，而且这 20% 全部来自「别人半落库」，
不是代码坏。主树口径下全量判卷是绿的（237 files / 2759 tests）——这正是规则 220/211 说的「主树全绿看不见第二个方向」。
这条数是 #11、#4、#2 三条的成本凭证，写进了它们的任务描述。

### 10 条假归因：逐条去向

| 锚点 | 声明的 killer | 真红的用例 | 处置 |
| --- | --- | --- | --- |
| `econ-plan-coverage-check-vacuous` | requires all approved files… | will not cut an unfinished plan/pair… | 改指 |
| `sessions-lines-nonempty` | 新建 → 出现在列表… | 追加后按增量计数… | 改指（源文件在飞，待复跑） |
| `mem-budget-unit-chars` | 中文语料超预算… | 纯 ASCII 会话：换口径不收紧… | 改指，已复跑 ✅ |
| `prune-attachment-production-entry` | ②附件真落在盘上… | ①生产形状（组装点未传 workspace）… | 改指（源文件在飞，待复跑） |
| `entropy-path-veto-removed` | 绝对路径形状否决… | 刻意接受的口子… | 改指，已复跑 ✅ |
| `shape-downstream-option-both-faces-lost` | 五支写法在自主档… | 九支写法两支面都拦… | 改指，已复跑 ✅ |
| `silent-green-overreach-onto-red` | 红 + 空输出… | 绿 + 有输出… | 改指，已复跑 ✅ |
| `pc-face-change-named-shortcut` | PC3 变了且点名… | --self-test 全造得红… | 改指，已复跑 ✅ |
| `np-unmeasured-rule-escalated` | 本模块绝不主动终止… | 停滞 ⇒ escalate；… | 改指（`no-progress.ts` 在飞，待复跑） |
| `head-import-clause-spans-into-body` | clause 不许跨过语句边界 | HEAD 现读：悬空集合… | **不是指针错**，见下 |

### 其中一条是判卷零分辨力，不是指针写错

`head-import-clause-spans-into-body` 的指针标的用例名是对的，但那格判卷**对这个突变没有分辨力**：
把 `head-import-face.ts` 里 clause 的字符禁区 `[^();=]*?` 换成 `[\s\S]*?` 后，测试原来那个 fixture
（注释在函数体里）两种口径都只读出 `./ok` 一条边。实测（`/tmp/hifcmp.mts`，把改法套在临时副本上跑，不碰盘上文件）：

- `fixture`（注释在体内）：原 1 条 ｜ 变异 1 条 ⇒ 分不开；
- `between`（注释独立成行、夹在两条语句之间）：原 1 条 ｜ 变异 2 条（多出 `./doc`）⇒ 分得开；
- 真文件 `head-cert.ts`：两边都是 5 条。

⇒ 修法是把**判卷补强**（`tests/head-import-face.test.ts` 加那个分得开的形状），指针一字未动；
改完在干净 HEAD 上单跑：✅ 红在声明的那条用例上。
通例：**「没红在期望用例上」有两种相反成因**——指针指错格（改指针），或判卷那一格本来就量不出来（改判卷）。分诊要靠"这个突变在两种实现下分别产出什么"，不能靠读标题猜。

## 两条独立尺对上了（这张普查表自带的交叉验证）

「突变未生效」的 2 条（`sessions-delete-force-false`、`supervise-retired-error-verdict-revived`）
正是秒级静态尺 `--check-needles` 点的**钉在飞文本**那 2 条：锚点行入库了、被锚定的实现没有 ⇒ 干净 HEAD 上是空操作。
两把尺不同源（一个是 20 分钟的实跑，一个是盘上文本静态判），读数逐条一致。

## 顺带修掉的两个洞

1. **`--list` 的列协议会被字段里的换行打断**：表里 `impact-closure-glob-broken` 的 desc 带换行 ⇒ 那一条被印成两行、
   列数不对 ⇒ 吃这份取料面的两把静态尺**同时少读一条**（833 条只读到 832），而且谁都不报错。
   修法：`--list` 把每个字段压成一行；判卷加「行数列数都要等于表内条数」的自检，另配锚点 `list-rows-not-flattened`。
2. **指针 vs 标题的口径盲区**：先按「指针必须等于某条 `it` 标题」量，报 32 条假缺陷；
   补上「指针可以是某条标题的子串」后剩 2 条，再查这 2 条：一条指 `describe` 套件名（`FAIL` 行里确实含它），
   一条指**循环生成的标题**（`for (const cmd of WRAPPED) it(cmd, …)`，运行时是真标题、静态抽不出）。
   ⇒ 现读 **0 条指不到用例标题**，而"把它收紧成只认标题"会造出 2 条假红——这条口径是靠跑出来的，不是推出来的（规则 223⑵ 的又一次）。

## 复跑口径（别人要复核时照抄）

```bash
# 静态：秒级，两把尺的现读
node --import tsx scripts/mutate-verify.mjs --check-needles
node --import tsx outputs/mutation-attribution-census-2026-09-27/measure-pointer-title-face.mts
# 运行时归因：整表 21.8 分钟，**必须在独立 worktree 里跑**（见上）
git worktree add --detach .worktrees/<名>-<sha> <sha> && ln -s "$PWD/node_modules" .worktrees/<名>-<sha>/node_modules
cd .worktrees/<名>-<sha> && node --import tsx scripts/mutate-verify.mjs
# 单条复认（几秒）：主树里跑就行，源文件在飞的那条会被预检拒（那是正确行为，不是失败）
node --import tsx scripts/mutate-verify.mjs <锚点 id>
```

## HEAD 上「量不出来」那 167 条：逐签名归因（去重后只有 7 个源头，全在半落库）

`基线就不是全绿` 的 167 条不是 167 个缺陷，是 7 个源头被 167 条锚点各自踩到。逐条在干净 HEAD 树里复现过：

| 条数 | 签名 | 归因 |
| --- | --- | --- |
| 111 | 判卷载不动：`Cannot find module '../providers/capabilities'`（被已入库的 `src/main/agent-runner.ts:63` 指着） | **#11**：那 4 个模块只盘上有——`git cat-file -e HEAD:<四个路径>` 四个全「无」 |
| 25 | `mutate-verify-gates > 真表自证：killer 指针必须 0 失效` | 锚点 `supervise-retired-error-verdict-revived` 的标题只在盘上有 ⇒ 第 142 页新加的**静态第 6 维**现在 6.6 秒就点名它 |
| 16 | `docs-check > D-8 迁移后无存量豁免`（HEAD 上残留 10 项，首条 `D-1|AGENTS.md`） | 修复只存在于别人未提交的改动里 ⇒ #2/#6 |
| 10 | `map-parse > 真仓库里那四个…` | HEAD 版清单写着 `scripts/ipc-reachability-check-core.ts`——**盘上与 HEAD 都没有这个文件**；该判卷正被别人改着（`M tests/map-parse.test.ts`） |
| 4 | `mutate-anchor-titles > 真表：漂移必须 0` | 同一个 `supervise-retired…`（漂移名单里就是它） |
| 2 | `sessions.test.ts` 的两条增量计数用例 | 被锚定的实现只在盘上（`src/main/sessions.ts` 在飞）⇒ 与 `sessions-delete-force-false` 同格 |
| 1 | `prefix-churn > --self-test 全造得红…` | PC3 那条的反向对照在别人未提交的改动里（与 `outputs → scripts` 那两笔改名同源） |

⇒ **HEAD 上量不出来的格子，100% 来自「半落库」**（未跟踪的模块 ＋ 只在盘上的修复），没有一条是代码本身坏。
但这张表也暴露变异机自己的一个口径错：它把环境的红收进自己账本，报成 `基线就不是全绿（不应发生）`＝**阻断**。
按规则 92（三态）这一格应是**未证**——不是"没守住"，是"量不了"。第 143 页已把这条改判（点名缺的是哪个模块），
否则下一次普查仍会把 167 条环境噪声混进"表退化"的信号里。
