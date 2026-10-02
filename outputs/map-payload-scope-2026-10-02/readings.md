# 第 299 页取证 · 能力 1：地图候选面排掉载荷目录（前后同脚本 A/B）＋尺自己有了退出码

现读时间：2026-10-02 11:44–11:50（本机，同一台机器两棵树）。取料面：`scripts/probe-map-compose.ts`（本笔新增、两棵树跑**同一份文件**）、`scripts/probe-locate-recall.ts`（能力 1 那把尺）、一次性诊断 `/tmp/map14-rankdiag.mts`（未入仓，复现命令记在下面）。

## 1. 改动前后（同脚本、两棵树）

| 读数 | 改动前 `640b712`（`.worktrees/gate-head-cert`） | 改动后（工作树） | 日志 |
| --- | --- | --- | --- |
| 候选面总数 | **856** | **583** | `compose-before-640b712.log` / `compose-after-worktree.log` |
| 候选面里的载荷 | fixtures=268 ＋ outputs=16 ＝ **284（33.2%）** | **0** | 同上 |
| 渲染面 @1024 | 58 文件，载荷 4（6.9%），src=39 | 57 文件，载荷 **0**，src=39 | 同上 |
| 渲染面 @2048 | 114 文件，载荷 59（**51.8%**），src=39 | 77 文件，载荷 0，src=39 | 同上 |
| 渲染面 @4096 | 190 文件，载荷 128（**67.4%**），src=39 | 109 文件，载荷 0，src=39 | 同上 |

分母自证（两棵树的候选面不是同一份文件集，差值要逐根目录对上才算读数）：`640b712` 那侧非载荷 = 856−284 = **572**；工作树 = tests 293＋src 170＋scripts 102＋apps 17＋bin 1 = **583** ＝ 572 ＋ 11（在飞新文件：判卷 +8、`scripts/` +2、`src/agent/security/merge-gate.ts` +1）。⇒ 「−273」这一格不能读成「排掉了 273 个」，被排掉的是 **284 个**，同时我的树比那棵多 11 个在飞文件。

**同温警示**（规则：同分母还要同温）：两棵树的 mtime 不同（我这棵树刚被写过），而候选序＝mtime 降序 ⇒ 渲染面「哪些文件」两树不可逐字比；本表只比**计数与按根目录的分布**，这两个量对本次改动是稳的。`src=39` 在三档预算两棵树全都一模一样——这一位本身就是下面第 3 节的证据。

## 2. 尺（locate-recall）：读数没变，但退出码变了

- 改动前：`outputs/capability-rescore-2026-10-02/locate-recall-before-36a9ec6.log` ⇒ 候选 761、进图 761、渲染 58、tokens 911，正哨兵 `L-POS`（`src/main/settings.ts`）**三档全 MISS**，而脚本**退 0**（这就是立案的那格：不可引用的读数照样出数）。
- 改动后：`locate-recall-after-payload-scope.log` ⇒ 候选 **583**、进图 583、渲染 57、tokens 873；A 臂 **4/16**、B 臂 **3/16**（三档同值）；`L-POS` 三档仍全 MISS；负控 `L-NEG` 三档全 MISS（该有的样子）；末尾新增两行：
  - `[locate-recall] 自检 ❌ 正哨兵在所有预算档都 MISS ⇒ 图里真没有那个枢纽文件，命中率这一列不可引用（先修取料面或排序，别先报分数）`
  - `PROBE_EXIT=1`（取自日志自己那一行，不是包装层的 0）
- ⇒ **命中率一列仍然不可引用**。本笔没有把召回从 4/16 抬起来，也没有假装抬起来；它做的是两件独立的事：把预算从载荷手里拿回来（第 1 节），和让这把尺在自己不合格时出声（`scripts/lib/probe-self-check.ts` ＋ 接线，锚点 `map-ruler-*` 三条）。

## 3. 现读改掉了我的前提：墙不是「新近度」，是边覆盖

任务 #14 从前写的是「地图按新近度排序 ⇒ 稳定核心永不进图面」。这条**错了**，现读：

- `src/agent/map/render.ts` 那句注释与实现：渲染是**按 PageRank 分数降序取前 k**（`renderMapBudget`），mtime 只决定候选**切片**次序；而 `cap.ts` 缺省＝上限＝**5000** > 候选 583 ⇒ 切片今天**根本没 binding**（`自述：候选=583 进图=583 帽=5000`）。所以「被帽挤掉」这个解释对 `settings.ts` 不成立。
- 一次性诊断（复现：`node --import tsx /tmp/map14-rankdiag.mts`，读数在 `rank-diag-scratch.log`）：全图 **14998 节点／13147 边**；`src/main/settings.ts` 有 **28 个节点、全是 `def`**（`AppSettings`/`LayoutState`/`PANEL_IDS`/`PROVIDER_KINDS`/`DEFAULT_SETTINGS`/…），**最好那个节点排 #1932/14998**；按「文件的最好节点」排 ⇒ **第 233/583 位**；它 19 个可引用名只被 **9 个文件**的裸名 `ref` 命中，其中在 `adj` 里真接成边的 (文件,名) 对 **11**。
- 前面 20 个文件（同一读数）：`tests/secrets.test.ts#1`、`src/agent/ledger.ts#2`、`src/events/index.ts#3`、`src/agent/loop.ts#4`、`src/agent/context.ts#5`……而 `src/main/settings.ts` 在 #233 ⇒ 4096 档只渲染 109 个文件，**结构上就进不去**，与预算无关（三档 `src=39` 不动是同一件事的侧面）。
- 为什么低：`src/agent/map/rank.ts` 与 `src/agent/map/parse.ts` 里 **零** import 说明符处理，`src/agent/impact/index.ts` 也只吃 `fileTags` ⇒ map 与 impact 两边的边都**只靠裸名 def/ref 相遇**。枢纽文件的内容多为类型/常量（`: AppSettings` 这类注解位若不产 ref 节点就没有入边），于是 rank mass ≈ 0。
- ⇒ 与 **#8②（模块路径解析边）**、**#9（裸名歧义）** 同根，收成一条动作：**给图补一条文件级 import 边**（`import … from "./x.js"` 解析到真实 rel，权重低于符号边、只作为 rank mass 的兜底）。这一格留作下一簇，不在本笔动。

## 4. 造红六台（`redmachines.log`，复原逐字节一致）

针脚不是我手抄的：脚本按锚点 id 从 `scripts/mutate-verify.mjs` 的表里切出条目、`apply` 那个函数直接执行（第一版按括号配平切整张表，在一条含 `]` 的串文字上截断 ⇒ 报语法错、什么都没改，改成逐条切片）。

| 台 | 锚点 | 红了哪些用例 | 汇总 |
| --- | --- | --- | --- |
| M1 | `map-payload-first-segment-lost` | 纯谓词只看第一段 ／ 仓库根视角 ／ 真仓现读 | 3 failed \| 8 passed (11) |
| M2 | `map-payload-filter-not-wired` | 仓库根视角 ／ 真仓现读 | 2 failed \| 9 passed (11) |
| M3 | `map-payload-exclusion-as-abs-glob` | 仓库根视角 ／ 反向那一半（夹具自己当工作区不被掏空） | 2 failed \| 9 passed (11) |
| M4 | `map-ruler-selfcheck-always-ok` | 正哨兵从没命中过 ⇒ 不 ok 且明说不可引用 | 1 failed \| 5 passed (6) |
| M5 | `map-ruler-exit-not-wired` | 尺吃 lib 里那一份判据，且自检不过就退非零 | 1 failed \| 5 passed (6) |
| M6 | `map-ruler-only-last-budget` | 每题的命中记录喂的是 hitAnyBudget，不是某单一档 | 1 failed \| 5 passed (6) |

三台载荷机没有「两台红在同一条」：M1 独有「纯谓词」、M3 独有「反向那一半」、M2 独有「真仓现读在 M3 下不红」——失败集合两两不同（M1⊃M2 是谓词层与接线层的包含关系，符合预期：谓词坏了接线必然也坏）。

## 5. 判卷与门

- `tests/map-build.test.ts` **11 条**（本簇 +4：纯谓词／仓库根视角／反向那一半／真仓现读分母自证）、`tests/locate-recall-ruler.test.ts` **6 条**（新文件：判据两半＋接线两条）。
- 全量核心判卷：`Test Files 289 passed`、`Tests 3969 passed`、181.11s（`suite-full.log`，`SUITE_EXIT=0`）。第 298 页那笔是 281 文件 3817 条 ⇒ 增量来自邻居在飞的判卷文件与我这两份，本簇净加 10 条（11−旧 7 ＋6）。
- `node --import tsx scripts/typecheck.ts` ⇒ 0 报错。
- 锚点表 1269 → **1275**（+6 ✓）；`改法语法体检：1275 条全部合法`；`killer 指针失效 0`；`阻断 8` 全为本簇「未入库面 4 ＋ 钉在飞文本 4」（尺与锚点同笔、未落库的预期读数，落库后应归零）。
- 门耗时声明：本簇**不新增门**；上面这些是既有门里的一次跑（`--check-needles` 约 6s 量级、全量判卷 181.11s、认证门 22 道另见凭证页）。
