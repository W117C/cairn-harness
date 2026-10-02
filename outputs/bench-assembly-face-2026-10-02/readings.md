# 基准装配面 · 2026-10-02（能力 5 的测量有效性那一格）

任务号 #11。一句话：**跑器少装了产品缺省开的那一环，而读数不区分「模型没做」与「跑器没装」**。

## 1 现读（改动之前，全部实跑取值）

| 量 | 读数 | 取法 |
| --- | --- | --- |
| `DEFAULT_SETTINGS` 里值为 `true` 的键 | 5 枚：`autoMemory` `autoVerify` `impactAnalysis` `promptCache` `subagentTools` | `node --import tsx -e` 直接枚举 `Object.entries` 筛 `=== true` |
| 基准递给 `runLoop` 的参数 | provider/events/workspace/mode/maxSteps/stuckNudge/clarify/plan/verify/userMessage —— **上述 5 枚一枚都没递** | 读 `scripts/loop-eval.ts` 的 `await runLoop({` 实参表 |
| 基准的工具面 | 22 把，含 `verify`/`remember`/`spawn_agent`；**无 `impact_query`** | `sessionToolSpecs({mode:"auto"})` 逐条取 `s.function?.name`（第一次按 `s.name` 取，22 个空串——那是嵌套 wire 形，见 §5） |
| 盘上真模型跑批的 `autoVerifyBeat` | **false 49/49**（bench-reps3 36 ＋ eval-long30 1 ＋ eval-baseline-1 12） | 逐条读 `outputs/*readings.json` |
| `verified`（模型自调 verify 次数）直方图 | 0 次：34 趟｜1 次：13 趟｜2 次：1 趟｜3 次：1 趟 | 同一批 readings |

结论：`autoVerifyBeat` 那一列被读成「模型从不自己验证」，而它同时兼容「跑器没装这一环」。
`src/agent/loop.ts:573` 的收束闸要求 `opts.autoVerify === true`，基准缺省不给 ⇒ 这一格在自动路径上是空的，
而基准是这条能力**唯一的读数来源**。这是本仓反复立案的「两头断」最新一例：判据字段在场、生产者从未被接上。

## 2 交付

- `scripts/lib/eval-assembly.ts`（新）：`KnobFace`（same / off-here / not-applicable / **undeclared**）、
  `BENCH_KNOBS` 五枚逐条带接线点、`assemblyRows`（只取缺省为真的键）、`assemblyOverrides`、
  **`runLoopKnobsFromAssembly`**、`undeclaredKnobs`/`missingKnobs`/`renderAssemblyFace`。
- `scripts/loop-eval.ts`：装配面在**花钱之前**出声；有未表态的缺省开键 ⇒ 退 1 拒绝出数；
  `--auto-verify` 是唯一改口通道，且递给 `runLoop` 的键**由表投影**（`...BENCH_RUNLOOP_KNOBS`），不另起 if；
  `--feasibility` 那条零花费路也印装配面；每一格读数新增 `assembly` 字段（日志那行不在 readings.json 里）。
- `tests/eval-assembly.test.ts`（新）：**16 条**，162ms。
- `scripts/mutate-verify.mjs`：**11 条**锚点（`asm-*`）。

本模块**不打开任何东西**：它只把差值印出来。要不要按产品的样子跑，是 `--auto-verify` 那一步——
那一步每趟可能多真跑一遍 lint/test（钱），而「准确率 vs 每成功任务花多少」的实测口径至今未裁 ⇒ **归用户裁**。

## 3 真机读数（改动之后）

```
$ node --import tsx scripts/loop-eval.ts --feasibility
[feasibility] 可跑 0 / 分母 4（未发任何模型请求 ⇒ 零花费）
[feasibility] 装配面（产品缺省开的键 ↔ 本跑器）：autoMemory:off-here autoVerify:off-here impactAnalysis:off-here promptCache:off-here subagentTools:same
```
全文见 `feasibility-face.log`。退 0、未发请求；缺省那副仍是 4 枚 off-here，与 §1 的现读同一张脸。

## 4 分辨力：四台造红（备份 `cp`，复原后逐字节 `cmp` 一致）

| 台 | 改法 | 红在哪些用例 | 用时 |
| --- | --- | --- | --- |
| A | 投影谓词 `&& r.face === "same"` 取反 | 「缺省那副：表说没装…」「带 --auto-verify 那副…」2 条 | 165ms 内 |
| B | `assemblyRows(...)` 少递第三个实参 | 「缺省表与旗标改口是同一条调用算出来的」1 条 | 同上 |
| C | 筛选 `v === true` 放宽成 `v !== undefined` | 「真缺省确实投影出行…」「每一枚…都有表态」「缺省关的键不进这张表」3 条 | 同上 |
| D | `undeclaredKnobs` 返空 | 「缺省新开一枚键而表里查无…」1 条 | 同上 |

四台各红在**不同**用例上 ⇒ 判据有分辨力；复原后 `cmp` 逐字节一致，残骸 0。

## 5 过程中自己错的两次（登记，免得被当成尺没问题）

- 第一次取工具面用 `face.specs.map(s => s.name)` 拿到 22 个空串——规格是嵌套 wire 形，名字在 `s.function.name`。
  若照当时的读数写，会写成「基准面上没有 verify/remember/spawn_agent」，方向整个反了。
- §3 那条命令我先用 `grep -E "装配面|可跑" | head -5` 读，命中被 `head` 截掉，于是读成「feasibility 没印装配面」。
  回读 `tail -8` 才看到那一行本来就在。**读数不许来自被截断的输出**——这条规矩又一次是靠违反它才被记住的。
- 顶包候选那格我写成了「未涨」，可它取的是**提交之前**的树态：这张帽按已提交态算，而我那笔提交正是往里加东西的那一笔。
  ⇒ 同一会话里「改动前量到的水位」不能拿来给「改动后」背书，落库后要重量一次（§6 已改成两态各一条）。

## 6 门耗时声明（分清是哪把尺，四个量纲不许互借）

- 本簇**不新增门**：判据活在 `loop-eval`（花钱路径）与单测里，`CERT_GATES` 22 道不变。
- 秒级自检：`tests/eval-assembly.test.ts` 单文件 **162ms**（16 条）。
- 针脚体检（只读）：见 `needle-audit-precommit.log`，末行
  `针脚体检：1263 条 —— 阻断 22，待复认 1，未覆盖 1，逐行式 5，未入库面 17（被测面 + 判卷两面），钉在飞文本 5，killer 指针失效 0`；
  另有一行 `改法语法体检：1263 条改法全部产出合法源文件 ✅`。
  **阻断 22 全归本簇**（尺与锚点同笔未落库 ⇒ 17 条「不在 HEAD 的树里」＋5 条「钉在飞文本」），落库后应归零；
  `killer 指针失效 0` ⇒ 11 条 expectFail 都指得到真用例。
  条数 1252 → 1263 ＝ 本簇 +11 ✓；`待复认 1`（`verify-lang-timeout-same-as-npm`）与
  `未覆盖 1`（`heldout-install-before-change-list`，上一簇的搬块形 apply）均**非本簇新增**。
- 全量判卷：288 文件 / **3947 条**全绿，188.31s（`suite-full.log`）。
- `docs-check` 退 0（3 项未检＝STATE.md 不存在，非本簇）；`typecheck` 本簇文件 0 错
  （唯一报错来自隔壁会话未跟踪草稿 `tests/worktree-pure.test.ts`）。
- 顶包候选水位：**第一笔（`d8d6167`）之后读数是 11 条 ＞ 帽 10 ⇒ 认证树里那条真仓判卷红了**
  （`tests/prose-needle-scan.test.ts > 真仓读数必须在帽内`）。新增那一格是本项目自己带的：
  判卷字段 `.why「BENCH_KNOBS」` 同时命中两处生产字面量（lib 的未表态原因串 ＋ loop-eval 的拒绝出数文案）。
  修法不是抬帽，是把 lib 那句改成「装配表里查不到这一枚…」⇒ 判卷字段只对一处生产字面量，
  第二笔后回到 **10 条（帽 10）**、`prose-needle-scan` 退 0。
  我原先写在下面的那句「10 未涨」取的是**提交之前**的树态（那时我的新文件还不算已提交态），
  而这张帽按已提交态算——同一会话内两次读数隔着一笔我自己的提交，方向就反了（见 §5 第三条）。
  松钉指针 10 条同样未涨。

## 7 锚点复验与认证（干净树，逐笔）

- **锚点复验**（`.worktrees/gate-mutate-verify`，`--changed-since=HEAD~1 --lock-tag=…`）：
  改动面派生 → 变更文件 10 个 ⇒ 选中锚点 **50/1263** 条，末行 **全部变异被正确杀死（断言非恒真）**，
  耗时 60.9s；成本分母＝判卷 spawn 100 次／50 条（每条 2 拍），最贵一条 5.0s。
  本簇 11 条逐条 ✅，单条 0.7–0.8s（`mutate-verify-50.log`）。
- **认证第一笔 `d8d6167`**（`head-cert-d8d6167.log`）：门面 **22 道跑到 22、绿 22、超预算 0**；
  `DIRTY_JUDGED=0`、依赖完整=是、收尾复核=同一笔、并发判卷 起前 0／跑完 0、墙钟 223.37s；
  **但全量判卷 `1 failed | 3804 passed (3805)`、exit=1** —— 那一条红就是 §6 说的帽（真仓判卷）。
  ⇒ 第一笔**不算认证通过**。（外层包装又报了 exit 0，红只在日志自己的那一行——规则 206 那一族，本次没上当。）
- **认证第二笔 `e48cc2e`**（`head-cert-e48cc2e.log`＋`-summary.txt`）：**认证门面 22 道跑到 22、绿 22、超预算 0**；
  全量判卷 **281 文件 / 3805 条全绿，`exit=0`（日志自己那一行，不是包装层报的）**；
  `TREE=e48cc2e`、`DIRTY_JUDGED=0`、依赖完整=是、**收尾复核=同一笔**；本趟墙钟 250.57s。
  ⇒ **`e48cc2e` 认证通过**（凭证等级＝全量绿；`d8d6167` 那笔见上一条，不算通过）。
  两条要照实说的读数：① `并发判卷=起前 0 套／跑完 1 套`——跑到收尾时场上多了一套别人的判卷（撞窗口径见规则 120 那一族），
  本次两态都绿、且收尾复核仍是同一笔，所以不改判，但不能写成"全程独占"；
  ② 认证跑完报告 `常驻残留树=1`（`.worktrees/gate-mutate-verify@d8d6167`，detached∧0 项在飞∧那一笔已入库＝命中残留判据）。
  **判据不是授权**：那棵树是我这一簇用过的，回收动作等用户点头，没有就地删。

## 8 仍欠（写清归属，别让它默默消失）

1. **一次带 `--auto-verify` 的真跑**：两副装配同分母对照（准确率 ＋ ¥/成功任务）。要花真钱、要凭据 ⇒ **等人点头**，不由这把尺替用户翻缺省。
2. `#7` 的另一半：能产出 ≥2 拍 verify 的题形（`verified` 直方图现在 2 次以上只有 2 趟）。
3. `autoVerifyRepair` 在产品是缺省**关**（实测 `DEFAULT_SETTINGS.autoVerifyRepair === false`）⇒ 基准不装它**不在这张表里**，
   谁翻那一枚，`undeclared` 那一格会当场要求表态。
