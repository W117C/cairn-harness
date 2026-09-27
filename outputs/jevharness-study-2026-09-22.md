# JevHarness 形状研究：借它的「harness 作者 + 反思」骨架，套在 laya 候选②上（2026-09-22）

> **结论先行**：JevHarness（[TianyuCodings/JevHarness](https://github.com/TianyuCodings/JevHarness)）与
> 本仓 `docs/judgment-layer-calibration-proposal.md` 走的是**同一条判断层路线**——强模型写代码与判据，
> 快判断层做高频类型化决策，作者不在线。它新贡献的形状只有一块本仓没有的：
> **「离线评测 + 反思 → 修订 harness → 冻结选定版」的进化循环**。而 laya 评估 §5.1 的候选②
> （gym 自动判分器）恰好是"有判卷面、有频率、离线零风险"的最佳候选，只缺这个循环。
> **建议形状**：借 JevHarness 的三段式（adapter / pipeline / reflection），把 laya 当作候选②的
> 判断原语——即"laya 版 gym 判分 harness"，而非把 JevHarness 整体移植。
> 本页是形状研究，沿用「借形状不借读数」纪律：JevHarness 的 Pokémon 75% 提升与其延迟读数**不迁移**。

---

## 一、JevHarness 是什么（读数不迁移）

一个 Python 项目：让 authoring LLM 为具体任务**写一个 task-specific harness**——
harness 把观测变成特征、构造 Jev 类型化问题（choice / score / noul，与 laya 三原语同构）、
把结构化答案组合成动作。核心机制四条：

| 机制 | 内容 |
|---|---|
| adapter/pipeline 边界 | 任务 adapter 独占观测、合法动作、副作用与打分；harness 独占特征构造、判断与决策逻辑。harness 改不了自己的 reward，也读不到隐藏任务状态 |
| author once, then execute | 开发期作者 LLM 反复改 harness；**冻结后执行不再需要作者模型**，每次决策只走 harness 代码 + Jev 调用 |
| reflection/GEPA | 有可靠 reward 时：反思用**完整执行轨迹**（每个节点的输入输出、每个 Jev 问答、记忆、失败）+ GEPA 选父/评候选，记录被拒提案的真实谱系 |
| 完整轨迹留痕 | 无损去重；超字节上限的输入**归档并拒绝，绝不截断**（与本仓「不截断只归档」纪律同形） |

它的示例读数（Pokémon Eval 胜率 25%→75%、选定 harness 决策中位 568ms、单次 Jev 269ms）
来自其自家环境与模型，**按本仓纪律只借形状不借数字**。但有一个结构性事实值得记：
其 Jev 单次请求 269ms 与 laya 的 33ms/次不同量级——Jev 是远端 hosted 推理，laya 是本地权重。
本仓判断层文档 §7 第 4 步已对 laya 的域外表现给出负面先验（base 检查点 0.362 低于多数类基线 0.461），
这个先验**不因换 harness 框架而改变**。

## 二、与本仓判断层路线的对表

`docs/judgment-layer-calibration-proposal.md` 已迁入 JEV 四理念（判断与生成分离 / 类型安全决策 /
校准驱动自主 / 快慢双环）。JevHarness 逐条对表：

| JevHarness 机制 | 本仓现状 | 缺口判定 |
|---|---|---|
| 判断原语 choice/score/noul | laya 评估 §1 已对表过（同构） | 无缺口，且 laya 是本地推理，绕开 Jev hosted-only 的分发问题 |
| adapter/pipeline 边界（harness 改不了 reward） | gym（`src/agent/gym/`）的 case/score/runner 已是同形边界 | 无缺口 |
| author-once-then-execute | gym 的判分器目前是**写死在代码里的确定性逻辑**，没有"由 LLM 作者写、可冻结"的形态 | **这是 JevHarness 的第一块可借形状** |
| reflection + 完整轨迹 → 修订 harness | gym 评测轮只出分数，没有"轨迹喂回作者 → 修订判分 harness"的循环 | **这是第二块可借形状** |
| 校准驱动自主（概率+阈值） | 判断层文档 §7 四步顺序已覆盖，且**明确拒绝**了 `DecisionProvider` 接口与五类 confidence | **不借**。JevHarness 没有 τ 校准与漏拦约束，这条比它深 |
| 快慢双环 | `routing/cascade.ts` + bandit 已闭合 | 无缺口 |

**对表后的边界**：JevHarness 的进化循环与本仓 §7 的四步顺序**不冲突但要排位**——
它属于候选②（gym 判分器）的实现形状，而候选②在判断层文档里已被定性为
「第一块试金石」：离线零风险、效果可量化、同时回答"laya 中文判分靠不靠谱"。
即：**借 JevHarness 的形状来做候选②，而不是让它的循环去替代 §7 的校准路线**。

## 三、结合方案：laya 版 gym 判分 harness（三段式）

把 JevHarness 的三段骨架套在候选②上，每个部件指定本仓落点：

```
task adapter = gym 现有 case/score/runner（reward 与 case 归它，harness 不可改）
harness      = LLM 作者写出的判分 pipeline：从 case 事件流提特征 → 构造 laya 类型化问题 → 组合答案成 pass/fail + 失败归类
reflection   = 离线：harness 判分 vs 现有确定性判分的一致率 + 轨迹喂回作者修订 → 迭代 → 冻结选定版
```

1. **adapter 边界照抄 JevHarness**：gym runner 独占 case 执行与 score 终值；
   判分 harness 只读**允许的观测**（事件流投影），拿不到 score 字段本身——
   否则它会把答案抄进特征里，一致率虚高。这条要在 harness 的输入白名单里写死。
2. **判断原语用 laya 而非 Jev**：pass/fail 判定用 choice（两选项 + criteria），
   失败归类用 choice（gym 既有失败类别封闭集），可疑度用 score。
   criteria 由作者 LLM 写——这正是 JevHarness「不用手写 instructions/criteria」的核心卖点。
   执行面沿用 laya 评估 §三已验证的 sidecar 形态（stdio 行分隔 JSON、fail-visible 降级、
   判与败都落事件），**那份设计要点 §5 写明"复评时仍适用"**。
3. **reflection 循环离线跑**：一致率是现成判卷面——与 gym 确定性判分逐 case 对表。
   迭代产出记谱系（哪版 harness、哪次修订、被拒提案保留），GEPA 本体**不引入**
   （本仓判断层文档已否掉 candidate generator/beam search：fanout 成本比 8.3–30x 的读数仍有效；
   这里只有"一个作者逐版修订"，没有并行候选搜索，正好绕开该否决）。
4. **冻结与验收**：选定版 harness（特征代码 + 问题模板 + criteria）落档，
   验收读数 = 与确定性判分的一致率 + 分歧 case 的人工复核归类。数据过关 → 候选②成立，
   顺带回答 §5.3 的中文判分未知数；不过关 → 归档，laya 判分质量未知数转为
   **"实测为不可靠"而非"未验证"**——两个结论都有价值。
5. **它不触碰 §7 的四步**：判分 harness 在离线评测面，不进权限判定热路径，
   `harmPrior?` 接入点与 τ 校准照旧走后验频率路线。第 4 步（外部提供方）的三前提里，
   「候选方打赢免费基线」这一条现在多了一个**合法的比武场**：gym 判分一致率。

## 四、明确不借的部分（留档防回潮）

- **GEPA 进化搜索本体**：判断层文档 §7「定序依据」已否 candidate generator/beam search
  （fanout 成本读数）；JevHarness 的"单作者逐版修订"变体不在此列，可借。
- **DecisionProvider 式统一接口**：判断层文档 §8 裁决②已明确不做（假接缝 + 11 档穷尽断言重写）。
  JevHarness 的 `JevClient`/`Proposer` 接口同形，**不借接口，只借流程**。
- **Python 常驻运行时进生产**：候选②是离线评测面，sidecar 只在评测轮生灭（§三试点设计要点），
  不构成判断层文档 §7 第 4 步前提③的分发问题——该前提管的是生产热路径。
- **Pokémon 读数**：胜率提升、延迟、GEPA 轮数全部不迁移，理由见 §一。

## 五、与既有档案的一条区分

- 与 `outputs/laya-evaluation-2026-09-21.md` 的关系：那页说"laya 不接生产热路径"，
  本页不推翻它——候选②本来就排在 §5.1 候选表的"最佳试金石"位，是**离线**用法；
  JevHarness 给它补的是实现形状（作者写 harness + 反思循环），不是接线依据。
- 与 `outputs/zcode-study-2026-09-21.md` 同 genre（外部形状评估，借形状不借读数）。
- 上游仍是 `docs/judgment-layer-calibration-proposal.md`：本页若被采纳，动作发生在候选②，
  不改变 §7 四步的排位，也不给 `GateMeta` 加任何字段。
