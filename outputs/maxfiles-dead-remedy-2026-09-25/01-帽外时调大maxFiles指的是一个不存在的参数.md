# 第 50 页 · 「帽外时调大 maxFiles」是一句指向不存在参数的指令

日期 2026-09-25。基线 HEAD `dcfbb84`。
起因是第 49 页那一族（共用文案里的「下一步」要在每个消费者自己的形状上重测）：
我顺着 `impact_query` 的分诊文案往下读，那句 `要么调大 maxFiles 后重问` 里点名的参数
**在这把工具的规格里根本不存在**。

## 一、结论与它的确切形状

三件事同时成立，而它们本该互斥：

| 面 | 事实源 | 状态 |
| --- | --- | --- |
| 引擎支持这个帽 | `BuildImpactOptions.maxFiles`，`src/agent/impact/index.ts`（`opts.maxFiles ?? MAX_FILES_DEFAULT`） | **早就有** |
| 文案教模型用它 | `graphAbsenceNote()` 的 `pos >= cap` 那一支 | **早就有** |
| 模型够得着吗 | `impactQuerySpec.parameters.properties`：只有 `symbol` / `file` / `deps` | **没有这一位** |

⇒ 缺陷不在引擎也不在文案，在**中间那根线没接**：模型照做 ⇒ 参数被忽略 ⇒ 同一句"帽外"原样回来，
白跑一轮。这是本仓点名的「两头断」的第 N 次，方向是新的：**声明面与文案面各对一半，中间断**。

顺带量出同族的第二处：`symbol` 支那句 `被 ${String(MAX_FILES_DEFAULT)} 帽挡在图外` 把缺省值**写死在文案里**，
所以即使接上帽，那一支也会对着 `maxFiles: 1` 的图报"被 400 帽挡住"——**接一根线不够，要看有几处读它**。

## 二、实测的成本读数（决定上界用，不是拍的）

冷建（每档换一个新缓存目录），本仓 448 个候选源码：

| `maxFiles` | 收录 | 解析 | 用时 | 每文件 |
| --- | --- | --- | --- | --- |
| 50 | 50 | 50 | 587ms | 11.7ms（含 wasm 首启） |
| 100 | 100 | 100 | 259ms | 2.6ms |
| 400（缺省） | 400 | 400 | 827ms | 2.1ms |
| 458 → 全量 | 448 | 448 | 836ms | **1.9ms** |

⇒ 稳态 ≈2ms/文件，`5000` 的上界最坏 ≈10s，与一次模型往返（8.7–42s）同量级，
且 tags 缓存按文件 `{mtime,size}` 记账，第二次只解析新增那批。
**上界必须是硬数**：这一位现在由模型传，没有上界等于给它"解析任意多个文件"的开关。

非法值（`0` / 负 / 小数 / 字符串 / 超上限 / `NaN`）一律**点名拒绝**，不静默回落成缺省——
回落就是把"你的取值没生效"这件事藏起来，而这条文案的全部意义正是让取值生效。

## 三、规格的体积账（为什么描述只写一句）

`tests/impact-query.test.ts` 有一条硬棘轮：规格 `JSON.stringify` **< 600B**（工具面是按轮重送的固定成本）。
现值 494B、余量 106B。逐字量过三种描述：

| 描述 | 规格总字节 | 判定 |
| --- | --- | --- |
| 「图收录的文件数帽（缺省 400，按最近改动取）。被报「帽外」时调大它重问」 | **640B** | 破帽 |
| 「帽外时调大（缺省 400）」 | **571B** | 过 |

⇒ 采纳短的，并把长解释**留在真用到它的那条报错文案里**（`graphAbsenceNote` 本来就报"第几位 / 收录几个 / 出路"）。
默认值不手抄：描述里那句 `缺省 ${MAX_FILES_DEFAULT}` 由常量派生，否则 400 改成 500 时规格会静默说错话。

## 四、判卷（六格，前五格 RED 全部先见过，第六格当场造红）

`tests/impact-query.test.ts` 新增一个 describe，靶子自建并**用 mtime 钉死候选序**
（`scanSourceFilesAll` 按 mtime 新→旧排，所以"谁在帽外"是确定的，不依赖 fixture 的 checkout 时间）：

1. `file 出口：maxFiles 同时到得了建图与那句说明（报的是**实发**的帽，不是缺省 400）`
2. `deps 出口：同一格（反向一跳走的是另一处建图调用，漏接就静默按 400 建图）`
3. `symbol 出口：那句「被 N 帽挡在图外」里的 N 也必须是实发的帽（此处原先写死 MAX_FILES_DEFAULT）`
4. `反向缺省：不传 maxFiles 时行为逐字不变（目标在图内，且帽按缺省说）` ← 这条**RED 阶段就绿**，
   它是收窄判定面的反向哨兵，不是新功能
5. `非法 maxFiles 点名拒绝（0/负/小数/字符串/超上限），不静默回落成缺省`

前三条第一次跑各红一次（读数分别是 `expected true to be false`、同、
`expected '[impact] legacyHelper 的定义在 1 个文件…' to contain '被 1 帽'`——最后这条正好证明参数被整支忽略）。

为什么三个出口各钉一条：`impact_query` 有**三处**建图调用（`symbol` 支、`file` 支、`deps` 支），
只测一支就是本仓第六/十二族反复踩的"同族只硬化一支"。一次改动的不变量由 N 支取料面共同成立时，
判据也要逐支各一条（规则 72）。

## 五、跑了什么（两次整表读数不同，都留下）

- `tests/impact-query.test.ts` **31/31**（含既有那条 <600B 棘轮；本轮新增 6 条）；
- 整张 `test` 门**第一次**（00:28:45 起，79.1s）：`210 passed (211)` 文件、`Tests 2273 passed (2273)`
  ——**零条用例失败**，那 1 个失败文件是"文件级崩"，见下方归因；
- 同一天**第二次**（00:34 复跑）：`Tests 2 failed | 2282 passed (2284)`。
  两条红都在**别人未跟踪的新机件** `tests/mutate-anchor-titles.test.ts` 里，且它自己点名的是
  `cc-head-survival-never-recorded` / `cc-coordinator-ignores-config-override`
  （`src/agent/glm-session.ts`、`src/agent/compaction.ts` × `tests/compaction-cost.test.ts`）
  ⇒ 属任务 #28 那一线（`a966cd9` 刚改了那两条锚点的 `expectFail`），**与本改动无关**；
  用例总数从 2273 涨到 2284 也是同一原因：他们那对文件在两次跑之间落了盘（+11 条）。
- `typecheck` 0 错；`tools-check`、`model-surface-check`（6/6）各自 exit 0；
  参数面对账探针 exit 0（`impact_query` 一行：声明与自读同为 `[deps,file,maxFiles,symbol]`）。
- **未证**：本轮全部判卷是**直调工具**。`impact_query` 只在 `impactAnalysis === true` 时才与规格同时注入
  （默认关，属待裁那一格），所以"真会话里模型会不会自己去调大它"零观测——与第 44 页那条同源，不是本轮能收的。

### 一次"别人的红"的归因（记下来是因为差点记错）

整表跑到一半出现过 `Test Files 1 failed / Tests 2273 passed` ——**文件级失败而零条用例失败**。
第一反应是"HEAD 悬空：测试 import 了一个没入库的模块"，但那条断言要证据：

| 事实 | 读数 |
| --- | --- |
| `tests/mutate-anchor-titles.test.ts` | 盘上有、`??` 未跟踪，mtime **00:29:23** |
| `scripts/mutate-anchor-titles.ts` | 盘上**有**（`ls` 到）、`??` 未跟踪、不在 HEAD，mtime **00:30:16** |
| 我那次整表 | 起点 00:28:45、时长 79.10s ⇒ 结束约 **00:30:04** |

⇒ 收集阶段正好落在"测试已到、lib 还差 12 秒"这个窗口里 ⇒ 是**与并发会话的写盘赛跑**，
不是 HEAD 自洽性问题（HEAD 里根本没有那对文件），也不是我这轮的东西。
判据：**"存在性"与"归属"是两问**——`git cat-file -e HEAD:<path>` 判在不在 HEAD，
`ls` 判在不在盘，`git status` 的 `??` 判归谁；三条各跑一次才不会把别人的在飞写成仓库的坏。
（本仓老规矩：报"红属他人改动"之前必须补一次空闲态同树复跑。）

## 六、这台机器本来在，但它**结构上**看不见这一格（先说破，再补握手）

我第一版把这一条写成"26 道门里没有一道判规格↔实现"——**错了，重测后更正**：
对账机是 `outputs/tool-param-drift-2026-09-24/measure-param-drift.mts`（任务 #2 那笔，`0e542fa`），
声明面问的是活面，且**确实覆盖 `impact_query`**。本轮改完的逐字读数：

```
impact_query  面=1 声明[deps,file,maxFiles,symbol] 自读[deps,file,maxFiles,symbol]
obs_recall    面=1 声明[by,byteInLine,id,max,offset] 自读[by,byteInLine,id,max,offset]
对账结论：可判 24 个工具里 0 个有偏差；未解析 schema 节点 0 处；无声明面 0 个；…退出码 0
```

而**改之前**它是 `声明[deps,file,symbol] 自读[deps,file,symbol]` ——两边一样、零偏差、门全绿。
⇒ 这台机器比的是「规格声明的键」↔「代码里真读的 `args.<k>`」，
而本轮的缺陷住在**第三个面**上：输出文案里点名了一个参数，那个参数既没声明也没被读。
两边自洽的机器对这一格天生无分辨力（不是它的 bug，是它的射程）。

补的握手（`tests/impact-query.test.ts` 第 6 条）：
`文案里点名的参数必须真的在规格上（说「调大 X」而 X 不存在＝教模型走一条走不通的路）`
——从 `graphAbsenceNote()` 的输出里正则取出所有「调大 <标识符>」，逐个要求它在 `impactQuerySpec` 上。
**当场造过红**：临时摘掉规格里那一行 ⇒ `AssertionError: 文案点名 maxFiles，规格里却没有它`，
复原后 `shasum` 与摘前一致、重跑回绿。⇒ 它不是空载棘轮，是真会咬的针。

 generalize 到全仓还欠的（登记未施工）：同一形状在别的工具文案里也可能出现（`write_file` 那句
 "同类改动用 `edit_file` 更省 output"、`impact-query` 那句"先 glob 确认"点的是**别的工具名**）。
 要收成机器，判据得同时吃「参数名」与「工具名」两类指称，并把"工具存在"挂到活面上——
 这已经是一张表而不是一条断言，等第二次命中再做，避免为假想需求先造抽象。

## 七、我造成了一道红并把它逐字交给热表

`mutate-verify --check-needles`：**改动前 阻断 5 → 改动后 阻断 6**，新增那条是我的：

```
❌ impact-query-deps-ghost-file-silent — src/tools/impact-query.ts — 针脚已不在源文件里
```

它的 `apply` 要删的正是 deps 分支那一行 `if (!graph.files.includes(rel)) return { ok: false, output: await notInGraphNote(ctx.workspace, rel, abs) };`
——而本轮**必须**改这一行（帽不传进去，deps 那支就静默按缺省建图，正是"同族只硬化两支"）。
⇒ 这不是判据有缺陷，是**被锚定的实现搬动了**，按体检自己给的修法改指新行：针脚尾部加 `, maxFiles`。

为什么不当场改表：`scripts/mutate-verify.mjs` 此刻在别人手里（`M`，含上百条未提交锚点），
而 `git commit -- <file>` 是 `--only` 语义＝取工作树那份 ⇒ 会把别人的 hunk 一起提交掉。
为什么不改代码形状来保住针脚（局部同名闭包 shadowing、或换个调用名）：
**为了能对上字符串而扭曲源码**＝让判卷面反过来决定产品形状，下一次没人记得这里为什么有 shadow。
已挂任务 #11，带这条的逐字新针脚。

**判据形态（本轮学到，写下来是为了下次少付一次）**：给一支工具"接一根线"之前，
先跑 `--check-needles`（秒级）看这根线经过的每一行有没有被锚点钉着——我是改完才知道的。

## 八、把这一类**全量**核完再收（分母 = 6 处，不是一处修完就算）

一天之内同类命中两次（第 49 页的 glob 逃生口、本页的 `maxFiles`）⇒ 值得把"模型可见文案里点名的参数/工具"
整个数一遍。**取料法**：扫 `src/tools/**` 与 `src/agent/**` 中含「调大 / 用 / 可用 / 按 + 标识符」的句子，
再剔掉**代码注释**（模型看不见 ⇒ 不进分母；这一步不能省，否则命中数虚高数倍）。
判定时拿**活面**（`sessionToolSpecs({mode:"auto"})`，实测 20 把）逐条对：

| 出处 | 那句话点名的东西 | 活面真值 | 判定 |
| --- | --- | --- | --- |
| `read_file` 超大文件截断 | 「用 grep 定位后再按 **offset** 读」 | `read_file: path, offset, limit`；`grep` 在活面 | **真** |
| `read_file` 行窗截断 | 「可用 **offset/limit** 继续读」 | 同上 | **真** |
| `write_file` 整份重写提示 | 「同类改动用 **edit_file**」 | `edit_file: path, old_string, new_string, replace_all` | **真**（跨工具指称） |
| `remember` replace 未命中 | 「新建请用 **append**」 | 声明面只有 `op`；`RememberOp = "append" \| "replace"` | **真**（点的是**取值**不是键 ⇒ 键与取值两级都要查才敢下判） |
| `grep` 零命中 | 「把 **path** 显式指到那个目录」 | `grep: pattern, path, context, fixed_strings` | **真**（本轮实测：显式路径确实穿过 `.gitignore`） |
| `glob` 零命中 | 同一句 | 参数在，**行为不通**（它自制的 `--glob` 排除不让位） | **假 → 已修 `dcfbb84`（第 49 页）** |
| `impact_query` 帽外 | 「调大 **maxFiles**」 | 规格里**根本没有这一位** | **假 → 已修 `dfcc4bc`（本页）** |

⇒ **6 处里 2 假，两处都已修；4 真且各有实测依据**（不是"看着像真"）。

**暂不立门的理由写下来，免得下次再手算一遍分母**：分母只有个位数，而机器的豁免面
（跨工具指称、"点的是取值不是键"、注释与输出串必须分开）比判据本身还宽。
按本仓老规矩（触发面太小 ⇒ 由读数裁否，如 D8 / W1b），**第三次命中时再收成 AST 机器**；
判据形状本页已备好：AST 取 `src/tools/**` 的字符串字面量 → 抽「动词 + snake_case」→
按**归属工具的声明面**判存在，取值型指称再往下判一层（枚举值集合）。
