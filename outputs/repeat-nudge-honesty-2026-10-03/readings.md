# 第 313 页读数：每句只声称"真比过的那件事"——两个受众（模型看的换路提示、人看的重复率）

取料时间 2026-10-03（本地 03:42 前后），仓＝`/Users/ze/Downloads/deepseek harness`，基线 HEAD=`f674eee`（本簇起点 `b5e65af`；隔壁那笔 M2-8 只动 `apps/desktop/*` 与 `scripts/desktop-boundary-check.ts`，与本簇文件零交集，归属现读确认）。

## 1. 这一格从前说的是什么（三处越界，都不是"措辞不好"而是"为假"）

| 位点 | 旧句 | 实际比了什么 | 为假的形状 |
| --- | --- | --- | --- |
| `src/agent/stuck.ts#detectStuck` 规则二 → `src/agent/loop.ts#runLoop` | 「已连续 N 次失败——**原样重试不会改变结果**」 | `action` 相同 **且** 全部 `ok===false`；**没有比 observation** | 三次连败而错误各不同（flaky 测试／超时／竞态）时这句话把"该再看一次"的那次重试劝掉 |
| `src/agent/loop.ts#runLoop` 规则一 | 「拿到**逐字相同**的结果」 | `stuckObservationOf` 截出来的**前 200 字** | 只差在第 201 字之后的两次结果被说成逐字相同 |
| `src/agent/tool-choice.ts#projectSession` → `#formatToolChoice` 与 `#UNMEASURABLE` | 「同 action + **逐字相同**结果」「重复探测只按逐字相同判」 | 键＝`stuckActionOf(name, args)`（参数串截 200）＋ `stuckObservationOf(output)`（结果串截 200），**两支都截断** | 看读数的人以为窗口是全文，于是把"重复率"当精确量读；实际窗口外的差异不计入 ⇒ 重复探测率系统性**低估** |

前两处受众是**模型**（直接改变它下一步动作），第三处受众是**看读数的人**（改变它对指标的信任）。同一条不变量，两个受众 ⇒ 本簇两处都修。

## 2. 修法：把事实从生产端带出来，而不是在文案里猜

- `StuckVerdict`（`stuck: true` 那一支）多一个 `sameObservation: boolean`；规则一按定义为 `true`，规则二现算 `window.every((t) => t.observation === first.observation)`。
- `loop.ts` 的 `repeatNote` 从两分支变三分支：错误支按 `sameObservation` 分「错误相同 ⇒ 才说得出重试无效（并写明比对窗口）」／「错误不同 ⇒ 最新那条本身就是新信息，先读它」；观察支把「逐字」换成「相同结果（比对取前 200 字）」。
- `tool-choice.ts` 三处印面/文档口径改为窗口（`repeats` 计数**行为不动**——改口径要么动量法要么动文案，这里量法是对的、文案是错的，所以只动文案＋补一条钉窗口的判卷）。
- `stuck.ts` 头部注释补一句**窗口归调用方定**：`loop.ts` 喂前 200 字，而 `no-progress.ts#judgeNoProgressEvents` 喂全串（那边注释明说截断前缀比会漏掉一条真实红，`outputs/no-progress*` 那族取证过）⇒ 复用本模块者得按自己那根串重新说一次，不许照抄这句措辞。

共用决策点：`sameObservation` 的**取值式子**住在检测器里，文案只是分派；锚点 A 钉的正是那行式子，不是钉文案。

## 3. 判卷

`tests/loop-repeat-nudge.test.ts` 11 条（本笔新增 4 ＋ 改 1 条既有阈值用例的两头钉）、`tests/tool-choice.test.ts` 16 条（新增 3 ＋ 改 1 条**标题**：既有那条的正文只证过"换参数不算"，标题却承诺了"逐字"——第 4 形态：用例存在＋标题承诺了 ≠ 正文在判）、`tests/loop-no-progress.test.ts` 5 条（给那句补证人）。

| 用例（标题即承诺） | 它咬的方向 |
| --- | --- |
| 连败三次而每次错误不同 ⇒ 不再断言重试无效，改说最新那条本身就是新信息 | 反（旧文案在此为假） |
| 连败三次且错误相同 ⇒ 才说得出「原样重试不会改变结果」，并写明比对窗口 | 正（该说的照说，且不说超过窗口） |
| 两次错误只差在第 201 字 ⇒ 仍算"错误相同"（截断比较的准确含义） | 边界（钉住"前 200 字"这个量纲） |
| detector 层：`sameObservation` 交的是比过的事，不是推测（阈值走配置） | 接线（取值式子真被读） |
| 成功但逐字相同 ⇒ 改判为"相同结果（比对取前 200 字）"，且不再出现「逐字」 | 反（`not.toContain`） |
| 窗口边界：两条结果只差在第 201 字 ⇒ 仍算一次重复探测 | 正（量法的窗口） |
| 反向：差异落在第 200 字以内 ⇒ 不算重复（否则上一条恒真） | 反（规则 60 的 opposite-side） |
| 印面与边界名单按窗口说话，不许再写「逐字」 | 接线（印面与量法同一口径） |

实跑：`tests/tool-choice.test.ts` 16 条 5ms；`loop-repeat-nudge`＋`loop-no-progress`＋`no-progress`＋`promise-recall-inventory` 67 条 2.08s；兄弟回归 `loop-error-event`＋`repair-loop-real-verify` 9 条全绿；typecheck `0 条报错`。

## 4. 造红（`red-machines-46.log`，EXIT=0）

`汇总：46 台｜杀手命中 46｜存活 0｜残骸 0`，12 个被测面复原后与备份逐字节一致（本簇新增 `src/agent/tool-choice.ts`）。

本笔 5 枚，各红在**不同**用例（`46 台 → 45 个不同 killer`；唯一那对重复是第 311 页承诺面的两枚，规则 375 已裁"集合型判据可共用 killer"，与本笔无关）：

| 锚点 id | src | 针脚改法 | 红在 |
| --- | --- | --- | --- |
| `repeat-error-branch-asserts-determinism-again` | `src/agent/stuck.ts` | 现算的 `sameObservation` ⇒ 硬置 `true` | 「每次错误不同…」＋「detector 层…」 |
| `repeat-note-hides-the-comparison-window` | `src/agent/loop.ts` | 删掉「比对取前 200 字」 | 「错误相同 ⇒ 写明比对窗口」＋「只差在第 201 字」 |
| `repeat-obs-note-reverts-to-verbatim-claim` | `src/agent/loop.ts` | 「相同结果」还原成「逐字相同」 | 「成功但逐字相同…」 |
| `tool-choice-repeat-window-not-truncated` | `src/agent/tool-choice.ts` | 键里 `stuckObservationOf(e.output)` ⇒ 全串 | 「窗口边界：只差在第 201 字…」（既有两条不受影响：默认串与"换参数"那条同值） |
| `tool-choice-printed-label-reverts-to-verbatim` | `src/agent/tool-choice.ts` | 印面还原成「逐字相同结果」 | 「印面与边界名单按窗口说话…」 |

第 4、5 枚故意分给**量法**与**印面**两台：同一句错的两半各红一条，摘掉任一半天平都不动（规则 226 的另一面——两道闸不是冗余，但这里两处判的是不同的东西，各留一枚）。

## 5. 同类兄弟查过，结论相反（不顺手改它）

`loop.ts#noProgressNote` 那句「同一条路再走一遍不会改变结论」：它的判据（`no-progress.ts#detectVerifyStagnation`）比的正是"结论归一化后相同 **且** 无写向调用"，所以这句话有事实撑着 ⇒ 只给它补证人，不改文案。
取料面：`grep -rn -E '不会改变|原样重试|再问一次|逐字相同' src` ⇒ **32 行**，逐条读过；其余命中都在注释里（描述"字节不变"这类可证的零回归哨兵），或已是带条件的措辞（`sandbox.ts` 那句是对设计动因的说明，不发给模型）。

## 6. 帽跟着动（`claims-recheck.log` 与 `claims-recheck-post-labels.log`）

两趟读数逐字相同 ⇒ `tool-choice` 那三处改文案**没往分母里添新账**：

`能力断言：全量 45 处｜受众 {"model":43,"operator":2,"ui":0}` ⇒ `模型可见 43 条：有证人 13｜欠证人 25｜挑不出针脚 5`（三态相加＝分母，守恒）。

与第 312 页那份 28 条逐条做 `diff`（不是印象）：
- 消失的恰好 3 条，全在本笔面上：`loop.ts#noProgressNote｜同一条路再走一遍不会改变结论`、`loop.ts#runLoop｜原样重试不会改变结果`、`loop.ts#runLoop｜换一个探针或说明为何仍需重复`；
- **新增 0 条**。

`CLAIM_UNWITNESSED_CAP` 28 → **25**（三档 29／28／25 的出处都写进常量注释，每档一份 dated 取料面）。
反向对照那条判卷（「往真仓那份源码里凭空加一句无人判的能力断言 ⇒ 帽当场被顶破」）实跑绿 ⇒ 上一条不是恒真。

## 7. 秒级尺与遗留

- 针脚尺落库前（`needles-precommit.log`）：`1340 条 —— 阻断 4／待复认 1／未覆盖 1／逐行式 5／未入库面 0／钉在飞文本 4／killer 指针失效 0`。
  阻断 4＝本笔在飞文本；`tool-choice-repeat-window-not-truncated` 不在其列——它钉的那行键**HEAD 里就有**（本笔只改它的文案与判卷），这条从开张起就不是在飞锚点。
- 手上继续挂：#25（剩 25 条逐条核真假）、#20（needles 门 40810ms 对 20000ms，仍未取分布）、#26/#27/#28。
