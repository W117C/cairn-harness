# 人脑功能映射文档评估（2026-09-23）

材料：外部一份 13 条的《人脑功能 → Agent 可迁移机制》（三档分级：高价值可直接迁移 7 条 / 可间接借鉴 6 条 /
不建议照搬，附「映射到之前的架构」对照表 10 行 + 「落地优先级」7 条）。文档无仓库、无论文、无产品可核，
但**内嵌两个型号名与一整套选型**（Redis / Chroma / Pinecone / Neo4j / RPA / 消息签名）。

> **结论先行**：13 条里 **11 条已是现状**（下表逐行给指针，指针一律用符号名不用行号）、
> **1 条零件齐但缺承载面**（第 13 条预测编码：`AgentEvent` 联合 30 个成员里没有一种装「执行前预期」）、
> **1 条与自家实测方向相反**（第 6 条风险信号——不是没有，是 99 条真 args 上只出 1 次卡，
> 而「交人工」那一路的真值是默认档 91/99 出卡）。「落地优先级」7 条里 6 条是已发货状态。
> **本轮复跑改判了一个在册读数**：自主档 ask 从「0/99」变「**1/99**」；而「默认档出卡 100% 落在
> `L3-mode`、风险层零参与」这条**复算后仍成立**（91 次全在 `L3-mode`）。
>
> 同族档案：`outputs/aseos-vision-evaluation-2026-09-21.md`（31 节愿景书）、
> `outputs/laya-evaluation-2026-09-21.md`（外部决策模型）、`docs/judgment-layer-calibration-proposal.md` §7
> （DDAR 四十节 runtime 指令的裁决）。**本页只记新增判定，不重述那三份已裁的结论。**

## 一、先剥厂商：两处外部事实 + 一条战略前提

1. **型号名对不上任何真实 provider 面**。本仓注册表白名单是 `src/providers/registry.ts` 的
   `PROVIDER_IDS = ["glm","openai","anthropic","gemini"]`；文档里的 `GPT-6 Luna` / `DeepSeek V4.1 Flash`
   两个名字既不在白名单也无法核实存在。剥掉厂商名后，第 3/4 条剩下的意思就是「策略脑=贵档、执行脑=便宜档」
   ⇒ 即**分档路由**：`src/routing/policy.ts` 的 `routeFor` 已在出五种结局
   （`RouteDecision.reason = pinned | tier-default | bandit | cascade-upgrade | fallback`）
   + `src/routing/cascade.ts`（便宜档级联）+ `src/routing/pricing.ts`（`costUsd` 真钱折算）
   **已是它的实现**。
   ⚠️ **但文档那句「A 家规划 + B 家执行」今天在装机上只能半跑**（本轮实测，两半答案相反）：
   - **worker 侧代码已通、开关默认关**：`src/providers/registry.ts` 的 `toWorkerModel` 按 `spec.provider`
     四路分发（`streamGlm / streamOpenAI / streamAnthropic / streamGemini`，未知 provider fail-visible 抛错），
     唯一生产调用点在 `orchestrator.ts` 的**路由分支**内（`routing` 由 `settings.routingBandit` 打开，
     而该项 `DEFAULTS = false`）⇒ 档位表选到别家、worker 真能连，**但要先开路由开关**。
   - **主会话侧不通**：`src/main/settings.ts` 的 `PROVIDER_KINDS = ["demo","glm"]`，非法值静默回退默认
     ⇒ 交互主脑**只有 demo / GLM 两选**。
   - **BYOK 存储面也不通**：`src/main/provider-keys.ts` 另有一份**同名** `PROVIDER_IDS = ["glm"]`
     （注释「V1 单 provider」），`putProviderKey` 用它做 `isProviderId` 白名单 ⇒ 存 openai/anthropic/gemini
     的 key 会被拒「未知 provider（白名单：glm）」；三家只能靠各自 env 注 key。
   ⇒ 这是本仓第 N 次「两头断」形状：**注册表四家、执行端只有一路真入口**。文档的双模型前提要落地，
   缺的是**设置面的 provider 选项与 key 槽**，不是路由逻辑。
2. **落地栈是外部进程与服务**，与两条已拍板的前提直接撞：2026-09-18 的「模型侧不动、只改 harness」、
   2026-09-19 写进 /goal 正文的「架构最简单清晰」。同族先例是 Laya 那轮——torch + 421M 权重进 unsigned DMG
   已被裁否，三个数据库服务比它更重。
3. **「消息签名防冒充」在本机单进程架构里没有对应威胁模型**。真信道风险在提示注入面，自家对应物是
   `memory/inject.ts` 的**仿冒控制标签转义 + 块首立场声明**、`plugins/trust.ts` 的受信 skill 信任门、
   `main` 的单实例锁与 `agent/lease-conflicts.ts`。文档这条是分布式系统直觉的平移。

## 二、十三逐条对表（11 条已是现状）

| 文档条目 | 自家对应物（符号名） | 判定 |
|---|---|---|
| 1 工作记忆 → 短期上下文/任务状态 | `context.ts` + `compaction.ts` + `prune.ts` + `ledger.ts`（大输出归档，`obs_recall` 分页取回）+ `AgentStatus` 联合 + `permissions/plan-state.ts` | 已有，且比「Redis 存状态」更强：状态是事件流的**派生投影**，重启经 `recovery.ts` 重建，零外部进程 |
| 2 长期记忆（情景/语义/程序） | `memory/store.ts`：`ARCHITECTURE.md`（语义）/`DECISIONS.md`（情景）/`MEMORY_TYPES` 四类型 frontmatter + `INDEX_MAX_LINES`；程序记忆 = `plugins/skills.ts` 渐进披露路由清单 | 形状已有，实现是文件不是向量库。**唯一真差**：无语义相似度召回（见 §四） |
| 3 执行功能（规划/决策/抑制/切换） | 规划 = `tools/propose_plan.ts` + `planGateBlocks`（权限层读同一份活事实，worker 那一路也生效）；抑制 = `autonomy.ts` 的 L0–L4 / `GATE_LAYERS` **11 档**；切换 = `stuck.ts` 三阈值 + `no-progress.ts` | 已有，比文档硬：L0 三条硬边界在风险层**之前**短路、L2 ask 规则任何档绕不过、critical 连 allow 规则都批不掉 |
| 4 运动控制 → 工具调用 | `src/tools/`（`TOOL_NAMES` **10 个**）+ `tool-surface.ts`/`model-surface.ts`（`PINNED_SURFACE_TOOLS` 守「执行面有、模型面必须可见」）+ 运行时注入 `obs_recall`/`impact_query`/`skill` | 已有；RPA / 机器人控制越出范围 |
| 5 注意与知觉过滤 | 压缩 + `prune.ts` + `text-budget.ts` 的 `weightText`（按 token 计，中文一字≈一 token，不拿 chars/4 冒充）+ `solpi-runtime.ts` 回执与附件分页 | 已有四件；「RAG 重排」无 |
| 6 情绪与风险信号 | `risk.ts` 三通道 + `security/scan.ts` 静态快筛 + `goal.ts` 轮次/美元帽 + abort 随轮传入 provider | **与实测冲突**，见 §三 |
| 7 语言系统 | 结构化输出 + `tools/clarify.ts`（「向用户澄清」这个动作已建，评测里 `clarified` 是可读数） | 已有 |
| 8 社会认知 → 多 Agent | `orchestrator.ts` + `worker-prompt/report/tool-table/model` 四件 + `wait_for_agents.ts` + `sidechat.ts` + `sequencer.ts` 依赖链 + `supervisor.ts` | 已有；「消息签名」见 §一.3 |
| 9 全局工作空间 → 中央黑板 | `events/index.ts` 的 `AgentEvent` 联合（成员 **30**，含 `impact_report`/`routing_decision`/`turn_truncated`）+ replay | 已有且更进一步：文档要「关键状态写入中央状态机」，本仓是**状态由事件派生**（`autoOf(gate)` 把 `auto` 降级为投影，单一 writer） |
| 10 内环境调节 → 资源/健康 | `metering.ts`（`RequestCategory` = main/summary/recall 分账）+ `compaction-cost.ts` + `economics.ts` + `recovery.ts` + `stuck.ts` 静默窗（心跳 = 子流天然时间戳，**不造独立心跳事件**）+ M4a 定时任务（`automation_triggered/skipped/completed` 三事件，无人值守 fail-closed） | 已有；⚠️ 但开关不在手上，见 §六 |
| 11 睡眠与离线巩固 | `memory/distill.ts` 的 `runSessionEndDistill` + 纯函数 `failureDigestFromEvents`（把 `verify_result(ok:false)` / `tool_result(ok:false)` 聚成显式证据并入沉淀指令，无失败时逐字零回归） | 已有，且挂**会话尾**——比文档的「每天跑一次复盘 Agent」更及时、省一次冷启动 |
| 12 神经可塑性 → 持续学习/自修复 | `src/routing/bandit.ts`（`selectArm`/`updatePriced`/原子持久化，done→α+1、failed→β，代价按 `src/routing/pricing.ts` 的 `costUsd`）+ `src/providers/retry.ts`（三家共用的重试 / 429 退避，**不是跨家切换**）+ 工具热插拔 | 已有；「效果差就自动改提示词」**刻意不做**（不可证伪 + 会让冻结夹具分叉），改的是档位表 |
| 13 预测编码 → 世界模型/异常检测 | 零件齐：`impact/`（跨文件调用边 + `impact_report` + 摘要回注）、`verify.ts`（退出码级 oracle）、`economics.ts` 的 `HorizonInput`（用已完成边界观测的每边界请求数预测剩余，稀疏样本 0.5 折扣 + stddev 惩罚）、`gym/` 反事实靶场 | **最薄的一格**：「执行前预测 → 执行后比对偏差」没有承载面，见 §四 |

## 三、冲突条目（第 6 条）：风险信号不是缺，是**真流量上区分度 1/99**

**2026-09-23 复跑附录 A（原命令已腐，见 §七；本轮用改写版）**：

| 档位 / 沙箱态 | 受管调用 | ask | 出卡所在层 | risk 分布 |
|---|---|---|---|---|
| default / sandbox=null | 99 | **91（92%）** | **全部 `L3-mode`**（91/91） | none:41 medium:57 high:1 |
| auto / sandbox=null | 99 | **1（1%）** | `L4-risk` 1 | none:41 medium:57 high:1 |
| auto / sandbox=false | 99 | 91 | — | none:8 high:91 |

三条静态通道：`staticRisk` 非 none **58**、网络命令 **0**、`modelRisk` 标记 **0**。
自主档那唯一一次出卡是：`run_shell` 的 `printf 'verify-deps-before-run=false\n' > .npmrc && cat .npmrc`
→ `layer=L4-risk`、`reason=风险≥high 送审（自主档）`（命令里有重定向写盘）。

⇒ 判定两半：
- **仍成立**：默认档 91 次 ask **100% 来自 `L3-mode`**（「档位规定要问人」），风险层在默认档零参与 ⇒
  文档第 6 条设想的「风险分驱动人工升级」在今天的默认档上**没有被走到**。
- **已改判**：在册的「自主档 ask=0/99」过期，现态 **1/99** ⇒ 风险层的真流量区分度是 **1/99（≈1%）**，
  不是 0，但仍不足以支撑「先造风险打分层」这个动作。
- 「交人工」这一路的真值是**噪声侧**：本轮重量 = 91 次出卡摊在 20 段会话上（**4.55 次/会话**、
  **20/20 会话全撞**，命令 8），非交互即 fail-closed deny。
  所以该做的仍是 judgment-layer §7 第 1 步（拆短路、在 default 与 auto 之间造连续档），**不是再加一层打分**。
  反转条件同该页：复跑附录 A，default 行 ask 密度必须从 92% 动起来。
- **口径限定**（本轮读到代码为准）：99 条受管调用来自 `outputs/*` 与真机会话，而 v2 那 8 笔评测跑的是
  `mode: "auto"`（`scripts/loop-eval.ts` 的 `runLoop` 入参）⇒ **自主档那一格才是这些会话的历史发生量**
  （1/99 出卡），default 行的 92% 是**反事实量**、不是当时真发生的事。

## 四、真缺口（第 13 条）：卡的不是模型，是承载面

- 本轮按 `AgentEvent` 联合**成员枚举**（附录 A 命令 4）得 30 个成员，其中**没有任何一种装「模型在执行前对
  结果的显式预期」**⇒ 预测只活在模型自己的散文里，既不可计量也无法回灌，第 13 条的
  「执行前预测、执行后比对、偏差大则重规划」今天**只剩后半句**（verify 真跑 + `impact` 结构推断 + goal 收束）。
- 但这一格仍被**同一个位置**挡着：可比语料太少、靶面结果饱和。本轮复算（命令 5/6）：
  - 冻结靶面 4 个 case（`fixtures/gym/cases`），`scripts/loop-eval.ts` 的 `TASKS` 4 条里只有 `I2` 声明
    `seed: "bug"`，其余 3 条 `clean`；
  - v2 两臂 8 笔真钱运行 `verifyOkLast` **8/8 全 true** ⇒ 结果面**没有 y 轴**；
  - 起点 `seedVerifyOk` 有 3 笔为 false（base I1 / base I2 / short I2）⇒ **同一 I1 两臂起点不一致**
    （base 红、short 绿），且 `I1` 声明的是 `seed: "clean"` 却实测起手红 ⇒ 「干净靶子」不干净。
    该字段的取数时刻本轮核对过：`scripts/loop-eval.ts` 在 `runLoop` **之前**跑 `runVerifyOutcome(work, EVAL_EXEC)`，
    且脚本自己的注释就写着「`fixtures/todo-app/src/todo.ts` 是生成物、会被任何一次 e2e/agent/gate 就地重置
    ⇒ 不能拿它当全局 gate，但必须逐格记进读数」——**这条缺陷是脚本自己承认的，不是我推的**；
  - 8 笔里 `touchedJudge=true` 3 笔（base I1 / base I4 / short I4）⇒ agent 真会去改判卷面，
    `expects` 里的 `judgeUntouched` 有判据、但那是**过程纪律**不是结果。
- 顺带否掉一个"看着像缺口"的：`TASKS[].expects` 已经是「每条预期绑一个机器可判读数」
  （`clarify` / `planBeforeWrite` / `verifyOk` / `judgeUntouched` / `onlySrcChanged` / `wroteTest`）。
  ⇒ requirement 级追溯缺的**不是机制是位置**：它长在评测脚本里，没升成 `src/agent` 的一等实体
  （本轮 `requirement` 在 `src/` 全库零命中，见附录 A 命令 7）。这与 ASEOS 轮那条真缺口是同一格，不另立。

## 五、不采纳项（理由 / 证据 / 反转条件）

| 项 | 理由 | 证据（本轮可复算） | 什么读数会反转 |
|---|---|---|---|
| 向量库 / 知识图谱 / Redis | 外部进程 + 分发面，且无证据表明召回是瓶颈 | `store.ts` 是纯 fs 语义、`inject.ts` 有 `MEMORY_TOKEN_BUDGET_DEFAULT` 预算帽；`embedding\|cosineSimilarity\|rerank\|pinecone\|chroma\|neo4j\|redis` 在 `src/` **命中 0 个文件** | 出现「该注入未注入 / 注入了不相关」的可标计数，量级 ≥ 每特征格 100 条（否则 ECE 是噪声） |
| 再加一层风险打分 | 现有三通道区分度 1/99，第四层不会让 92% / 1% 两头动 | §三 表（附录 A 现态改写版） | 第 1 步拆短路后 default 行从 92% 动起来、且 `high/critical` 开始非零 firing |
| 新建 Planner/Executor/Reviewer 三角色 | 已是现状 | §二 表第 3/8 行指针 | 出现一次「角色缺位导致漏检」的真事故；今天为零 |
| 每日离线复盘批处理 | 会话尾沉淀更及时、省一次冷启动 | `distill.ts` 的 `runSessionEndDistill` + `failureDigestFromEvents` | 出现「会话尾沉淀被跳过且无法补跑」的真事故计数 |
| 在线改提示词（照搬可塑性） | 不可证伪，且会让冻结夹具字节分叉 | 判卷 sha256 冻结在 `scripts/frozen-sha256.json`；学习面已收在 `bandit` 的臂上 | 需要「同一提示在靶面上稳定劣化且档位表救不回」的对照数 |

## 六、顺带复算：第 10 条（内环境）的开关不在手上

- `DEFAULT_SETTINGS` 现在布尔项里 **true 只有 3 项**：`autoMemory` / `promptCache` / `autoVerify`；
  **false 12 项**：含 `actionFusion` / `impactAnalysis` / `evidenceReceipts` / `observationPack` /
  `requestMetering` / `economicCompaction` / `routingBandit` / `routingCascade` / `planRequiredByDefault`。
- 真机 `~/Library/Application Support/m0-agent-loop/settings.json` mtime = **9-22 22:33**，盘上
  `autoVerify=false` 是**显式写入**。⇒ 尽管 `settings.ts` 的逐字段兜底已写成
  `typeof r.autoVerify === "boolean" ? r.autoVerify : d.autoVerify`（只对「盘上无此键」的老机器生效），
  **本机仍读到 false** ⇒ `bc52ab3`（09-23 只翻 autoVerify）这台机器上不可观测。
  这与任务 #55「settings→RunOptions→那一拍无观察者」同型：**默认翻了一格，但翻的生效面仍无读数**。
- 文档第 10 条讲的正是这格。本仓不缺「内环境监控」这台机器，缺的是让它**真在线**的开关与读数。

## 七、抓到的一处文档自腐（可复跑性，未改该文档）

`docs/judgment-layer-calibration-proposal.md` 附录 A 那段自称「可直接粘贴复跑」的命令**在 HEAD 已跑不起**：

```
TypeError: s.planBlocked is not a function
    at evaluate (src/permissions/autonomy.ts:…)
```

原因：`AutonomyCtx.planBlocked` 自 better-harness C6 修复起是 `() => boolean`（注释明写「上一版是
`planBlocked: boolean` 由调用方每次 evaluate 前刷新，而刷新只接在主会话三处」），而该脚本仍传布尔。
`git status --short src/permissions/autonomy.ts` 为空、`git show HEAD:…` 同为函数版 ⇒ **腐在 HEAD，不是在飞**。
后果：该页 §7 第 1 步的判卷读数今天**跑不出来**（它整个判据就是「复跑附录 A 看 default 行动不动」）。

修法（**留给该页的 owner**，本页只记录）：`mk()` 里改 `planBlocked: () => false`（生产侧口径等价物是
`planGateLive`），并给该段挂一条**可判读的失效条件**——AGENTS.md 已有这条规矩：口径的失效条件挂可判读
事实，不挂 SHA。**本轮未触碰该文档**（它在飞 ` M docs/judgment-layer-calibration-proposal.md`，属别人的原子面）。

## 八、唯一建议 + 最便宜读数

1. **建议只有一条**：把第 13 条落成"配对实验"而不是"世界模型"。判据——在真语料里数
   「模型 `tool_call` 前的显式预期」能否按同一 `callId` 配到 `verify_result` / `tool_result`，
   **≥100 条才谈得上加第 31 种事件**；配不上，第 13 条与其余 12 条同级（命名，不施工）。
2. **排在它前面的两件既有欠账**（本轮实测仍未做）：
   - judgment-layer §9 第 0 步 verify 归因：`cause` 在 `src/agent/verify.ts` 与 `src/events/index.ts`
     **零命中** ⇒ 攒到的正例仍会被环境红污染；
   - `failureDigestFromEvents` 的取料面只有 `tool_result(!ok)` 与 `verify_result(!ok)`，
     **不看 `turn_truncated`** ⇒ 那条「零成本、只改沉淀引导」的一步欠着。
3. **另两件同轮复算仍在的原缺陷**（都是旧页已备案、未动代码）：
   `security/llm-review.ts` 的 `confidence: r.confidence ?? "medium"`（被审模型自报、缺省硬编码）；
   思考档位动作面仍不存在——`app.js` 的 `THINK_LABELS` 五档零出口，`providers/` 里 `thinking` 唯一命中是
   anthropic 读侧「未知 delta 优雅跳过」的注释，`budget_tokens` / `reasoning_effort` **零发侧命中**。
4. **本轮新增的一处可执行缺口**（来自 §一.1 的实测）：「策略脑 / 执行脑分家」要真跑，欠的不是路由逻辑而是
   **入口面**——`settings.ts` 的 `PROVIDER_KINDS = ["demo","glm"]` 与 `provider-keys.ts` 的
   `PROVIDER_IDS = ["glm"]` 两处白名单。它同时是**成本项**：`src/routing/pricing.ts` 已按三家真钱定价
   （`openai-* / anthropic-* / gemini-*` 九档 `calibrated: true`），但主会话选不到别家 ⇒ 那张价格表今天
   只服务于 worker 侧。若要动，先量「跨家一次省多少、准确率掉多少」并按 `$/成功任务` 并报（战略前提第 4 条），
   **不要为了"像双模型"接上**。

## 附录 A：复跑命令（本轮逐字实跑，输出已在正文引用）

```sh
# 1. 反事实回放 = 该页附录 A 的**现态改写版**（唯一差异：mk() 里 planBlocked 传 () => false）
node --import tsx -e "$(cat <<'TS'
import fs from "node:fs";
const { evaluate, isNetworkCommandCall } = await import("./src/permissions/autonomy.ts");
const { staticRisk, modelRisk } = await import("./src/permissions/risk.ts");
const files: string[] = [];
const walk = (d: string, k: number): void => { if (k > 4) return; let es: fs.Dirent[];
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = d + "/" + e.name;
    if (e.isDirectory()) walk(p, k + 1); else if (e.name.endsWith(".jsonl")) files.push(p); } };
for (const r of ["outputs", process.env.HOME + "/Library/Application Support/m0-agent-loop/sessions"]) walk(r, 0);
const calls: { tool: string; args: Record<string, unknown> }[] = [];
for (const f of files) for (const l of fs.readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue;
  let e: any; try { e = JSON.parse(l); } catch { continue; }
  if (e.type === "tool_call") calls.push({ tool: String(e.name), args: (e.args ?? {}) as Record<string, unknown> }); }
const G = new Set(["write_file", "edit_file", "run_shell", "shell_rw", "shell_ro"]);
const mg = calls.filter(c => G.has(c.tool) || c.tool.startsWith("mcp__"));
const mk = (mode: string, sandbox: boolean | null) => ({ mode, rules: [], sessionScopes: new Set<string>(),
  sandboxAvailable: sandbox, planBlocked: () => false, frozenJudgePaths: new Set<string>(),
  consecutiveAutoApprovals: 0, breakerTripped: false, consecutiveCriticalDenials: 0 } as any);
for (const [mode, sandbox] of [["default", null], ["auto", null], ["auto", false]] as [string, boolean | null][]) {
  let ask = 0; const risk = new Map<string, number>();
  for (const c of mg) { const d: any = evaluate(c.tool as any, c.args, mk(mode, sandbox));
    if (d.verdict === "ask") ask++;
    const r = String(d.risk ?? "deny"); risk.set(r, (risk.get(r) ?? 0) + 1); }
  console.log(mode, "sandbox=" + sandbox, "受管=" + mg.length, "ask=" + ask,
    "risk=" + [...risk.entries()].map(([k, v]) => k + ":" + v).join(" ")); }
console.log("staticRisk 非 none:", mg.filter(c => staticRisk(c.tool as any, c.args).level !== "none").length,
  "网络命令:", mg.filter(c => isNetworkCommandCall(c.tool as any, c.args)).length,
  "modelRisk 标记:", mg.filter(c => modelRisk(c.args).level !== "none").length);
TS
)"
# 实跑输出：default sandbox=null 受管=99 ask=91 risk=none:41 medium:57 high:1
#           auto sandbox=null 受管=99 ask=1 risk=none:41 medium:57 high:1
#           auto sandbox=false 受管=99 ask=91 risk=none:8 high:91
#           staticRisk 非 none: 58 网络命令: 0 modelRisk 标记: 0

# 2. 把 ask 按 gate.layer 拆开（§三 那张表「出卡所在层」那一列的唯一来源）+ 点名 high 那一条
#    自成一跑：prep 三段与命令 1 相同（整段照抄即可，不靠上一条的状态）
node --import tsx -e "$(cat <<'TS'
import fs from "node:fs";
const { evaluate } = await import("./src/permissions/autonomy.ts");
const files: string[] = [];
const walk = (d: string, k: number): void => { if (k > 4) return; let es: fs.Dirent[];
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = d + "/" + e.name;
    if (e.isDirectory()) walk(p, k + 1); else if (e.name.endsWith(".jsonl")) files.push(p); } };
for (const r of ["outputs", process.env.HOME + "/Library/Application Support/m0-agent-loop/sessions"]) walk(r, 0);
const calls: { tool: string; args: Record<string, unknown> }[] = [];
for (const f of files) for (const l of fs.readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue;
  let e: any; try { e = JSON.parse(l); } catch { continue; }
  if (e.type === "tool_call") calls.push({ tool: String(e.name), args: (e.args ?? {}) as Record<string, unknown> }); }
const G = new Set(["write_file", "edit_file", "run_shell", "shell_rw", "shell_ro"]);
const mg = calls.filter(c => G.has(c.tool) || c.tool.startsWith("mcp__"));
const mk = (mode: string, sandbox: boolean | null) => ({ mode, rules: [], sessionScopes: new Set<string>(),
  sandboxAvailable: sandbox, planBlocked: () => false, frozenJudgePaths: new Set<string>(),
  consecutiveAutoApprovals: 0, breakerTripped: false, consecutiveCriticalDenials: 0 } as any);
for (const [mode, sandbox] of [["default", null], ["auto", null]] as [string, boolean | null][]) {
  const byLayer = new Map<string, number>(); const byRiskAsk = new Map<string, number>();
  for (const c of mg) { const d: any = evaluate(c.tool as any, c.args, mk(mode, sandbox));
    if (d.verdict !== "ask") continue;
    byLayer.set(String(d.layer), (byLayer.get(String(d.layer)) ?? 0) + 1);
    byRiskAsk.set(String(d.risk), (byRiskAsk.get(String(d.risk)) ?? 0) + 1); }
  console.log(mode, "sandbox=" + sandbox, "ask按layer=" + [...byLayer.entries()].map(([k, v]) => k + ":" + v).join(" "),
    "| ask按risk=" + [...byRiskAsk.entries()].map(([k, v]) => k + ":" + v).join(" ")); }
for (const c of mg) { const d: any = evaluate(c.tool as any, c.args, mk("auto", null));
  if (d.risk === "high" || d.risk === "critical")
    console.log(c.tool, JSON.stringify(c.args).slice(0, 160), "verdict=" + d.verdict, "layer=" + d.layer, "reason=" + d.reason); }
TS
)"
# 实跑输出：default sandbox=null ask按layer=L3-mode:91 | ask按risk=medium:57 none:33 high:1
#           auto sandbox=null ask按layer=L4-risk:1 | ask按risk=high:1
#           run_shell {"command":"printf 'verify-deps-before-run=false\\n' > .npmrc && cat .npmrc"} verdict=ask layer=L4-risk reason=风险≥high 送审（自主档）

# 3. 语料清点（该页附录 B，原样跑通）
node --import tsx -e "$(cat <<'TS'
import fs from 'node:fs';
const files = [];
const walk = (d, k) => { if (k > 4) return; let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = d + '/' + e.name;
    if (e.isDirectory()) walk(p, k + 1); else if (e.name.endsWith('.jsonl')) files.push(p); } };
for (const r of ['outputs', process.env.HOME + '/Library/Application Support/m0-agent-loop/sessions']) walk(r, 0);
let calls = 0, gated = 0, fails = 0, noRes = 0, retryName = 0, retryArgs = 0, nonAscii = 0;
const G = new Set(['write_file', 'edit_file', 'run_shell', 'shell_rw', 'shell_ro']);
for (const f of files) {
  const ev = [];
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.trim()) continue;
    try { ev.push(JSON.parse(l)); } catch { /* 脏行跳过 */ } }
  const ok = new Map();
  for (const e of ev) if (e.type === 'tool_result') ok.set(e.callId, e.ok === true);   // 关联键 id ↔ callId
  const tc = ev.filter(e => e.type === 'tool_call');
  for (let i = 0; i < tc.length; i++) {
    const c = tc[i]; calls++;
    if (G.has(c.name) || String(c.name).startsWith('mcp__')) { gated++;
      const s = Object.values(c.args).filter(v => typeof v === 'string').join(' ');
      if (/[^\x00-\x7F]/.test(s)) nonAscii++; }
    if (!ok.has(c.id)) { noRes++; continue; }
    if (ok.get(c.id)) continue;
    fails++;
    const n = tc[i + 1];
    if (n && n.name === c.name) { retryName++;
      if (JSON.stringify(n.args) === JSON.stringify(c.args)) retryArgs++; }
  }
}
console.log('会话文件=' + files.length, 'tool_call=' + calls, '受管=' + gated, '受管含非ASCII=' + nonAscii);
console.log('失败结果=' + fails, '无配对result=' + noRes, '失败后仍调同一工具=' + retryName, '其中参数一字不变=' + retryArgs);
TS
)"
# 实跑输出：会话文件=20 tool_call=285 受管=99 受管含非ASCII=28
#           失败结果=16 无配对result=17 失败后仍调同一工具=7 其中参数一字不变=0

# 4. AgentEvent 联合成员枚举（正文用 30；先前口算 21 是漏计写法，已作废）
node --import tsx -e '
import fs from "node:fs";
const b = (fs.readFileSync("src/events/index.ts","utf8").match(/export type AgentEvent\s*=\s*([\s\S]*?);/)||[])[1]||"";
const u=[...new Set([...b.matchAll(/\b([A-Z][A-Za-z0-9]*Event)\b/g)].map(x=>x[1]))];
console.log(u.length, u.join(" "));'

# 5. 靶面：case 目录 + TASKS 的 seed 声明
ls fixtures/gym/cases
grep -nE 'id: "I[0-9]' scripts/loop-eval.ts | grep -o 'I[0-9].*seed: "[a-z]*"'

# 6. 结果面是否饱和（v2 两臂逐笔）
node -e 'const fs=require("fs");for(const d of ["outputs/loop-eval-v2-base","outputs/loop-eval-v2-short"])
for(const e of JSON.parse(fs.readFileSync(d+"/readings.json","utf8"))){const r=e.r??e;
console.log(d.split("-").pop(),r.id,"seedVerifyOk="+r.seedVerifyOk,"verifyOkLast="+r.verifyOkLast,
"touchedJudge="+r.touchedJudge);}'

# 7. 零命中面（三条，用 Grep 工具而非 shell grep：\b 与 --include 在 BSD grep/zsh 上会静默给空）
#    src/ 下 requirement → No files found
#    src/ 下 embedding|cosineSimilarity|rerank|pinecone|chroma|neo4j|redis → 0 个文件
#    verify.ts / events 下 cause → 0 命中

# 8. 「92% 出卡」的会话侧分布（正文 §三 的 4.55 次/会话、20/20 全撞来自这一条，本轮重量）
node --import tsx -e "$(cat <<'TS'
import fs from "node:fs";
const { evaluate } = await import("./src/permissions/autonomy.ts");
const files: string[] = [];
const walk = (d: string, k: number): void => { if (k > 4) return; let es: fs.Dirent[];
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = d + "/" + e.name;
    if (e.isDirectory()) walk(p, k + 1); else if (e.name.endsWith(".jsonl")) files.push(p); } };
for (const r of ["outputs", process.env.HOME + "/Library/Application Support/m0-agent-loop/sessions"]) walk(r, 0);
const G = new Set(["write_file", "edit_file", "run_shell", "shell_rw", "shell_ro"]);
const mk = () => ({ mode: "default", rules: [], sessionScopes: new Set<string>(), sandboxAvailable: null,
  planBlocked: () => false, frozenJudgePaths: new Set<string>(), consecutiveAutoApprovals: 0,
  breakerTripped: false, consecutiveCriticalDenials: 0 } as any);
let withAsk = 0, total = 0, asks = 0;
for (const f of files) {
  let n = 0;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue;
    let e: any; try { e = JSON.parse(l); } catch { continue; }
    if (e.type !== "tool_call") continue;
    const t = String(e.name);
    if (!(G.has(t) || t.startsWith("mcp__"))) continue;
    const d: any = evaluate(t as any, (e.args ?? {}) as Record<string, unknown>, mk());
    if (d.verdict === "ask") n++; }
  total++; if (n > 0) withAsk++; asks += n; }
console.log("会话文件=" + total, "有出卡的会话=" + withAsk, "ask 总=" + asks,
  "每次撞=" + (asks / (withAsk || 1)).toFixed(2), "摊每会话=" + (asks / total).toFixed(2));
TS
)"
# 实跑输出：会话文件=20 有出卡的会话=20 ask 总=91 每次撞=4.55 摊每会话=4.55

# 9. §一.1「入口面两处白名单」的三条读点（本轮实跑输出照抄在正文）
grep -n "PROVIDER_KINDS = " src/main/settings.ts          # → ["demo", "glm"]
grep -n "export const PROVIDER_IDS" src/main/provider-keys.ts src/providers/registry.ts
#   → provider-keys.ts: ["glm"]（注释「V1 单 provider」）· registry.ts: ["glm","openai","anthropic","gemini"]
grep -n 'case "' src/providers/registry.ts                 # → toWorkerModel 四路 glm/openai/anthropic/gemini
grep -rn "toWorkerModel" src/ | grep -v "src/providers/registry.ts"   # → 唯一生产调用点在 orchestrator.ts 的路由分支
```

## 附录 B：本轮被复算推翻的自己话（留档，防回潮）

1. 「自主档 ask = 0/99」→ 现态 **1/99**（`L4-risk`，那条写 `.npmrc` 的 `run_shell`）。
2. 「risk 分布 none=42 / medium=57、high=0」→ 现态 **none=41 / medium=57 / high=1**（语料同一份
   20 段会话未变 ⇒ 变的是判据侧，不是流量）。
3. 「21 种事件类型」→ 按 `AgentEvent` 联合成员枚举是 **30**。上一轮那条用的是「行首 + `type: "…"`」
   的漏计写法，且不同锚定式给出 21 / 24 / 30 三个数 ⇒ **只有成员枚举这一个能防守**，正文只用它。
4. 一次 shell 陷阱复发（本仓已备案过）：`grep -rn --include=*.ts` 在 zsh 下整条失败（`no matches found`）、
   `grep -rniE "\brequirement\b"` 的 `\b` 在 BSD grep 上静默给空。两条都改用 Grep 工具重取；
   「requirement 零命中」这次是**两种独立写法同结果**，才敢写进正文。
5. **「三家适配器零 importer」是漏计写法给出的假读数**：初稿用 `from "…providers/anthropic"` 取引用点，
   路径式 pattern **漏掉同目录写法 `from "./anthropic.js"`** ⇒ 一度得出「`anthropic/gemini/openai` 无人导入、
   多 provider 是死码」这个反向结论。改用**符号名**取（`streamAnthropic|streamGemini|streamOpenAI`）才看见
   `src/providers/registry.ts` 三家全接在 `toWorkerModel` 上。⇒ 问「谁引用了它」一律按符号名，不按路径形态。
6. `src/providers/retry.ts` 初稿写成「四家故障转移」——它是三家共用的**重试 / 429 退避**，
   不含跨家切换（已改在 §二 表内注明）。写「已有 X 能力」前先确认 X 的语义边界，别拿相邻能力顶名。
