# 实测差距修复提案（2026-09-23）

来源：`outputs/brain-cognition-mapping-evaluation-2026-09-23.md`（下称「对表页」）——本页**只列它实测出的差距与修法**，
读数与复跑命令都在那页附录 A，不重复。**提案，不是施工记录：本轮未动一行代码，未 commit，未立共享看板任务。**

> **结论先行**：六项，按「成本 × 是否解锁别的项」排序。P0 两项里，**P0-1 修的是我自己上一轮留在 HEAD 的腐判据**
> （对表页 §七），且它顺带暴露一类通用缺陷：文档自称「可粘贴复跑」没有任何门在守。
> **本轮把 P0-2 从"零成本白拿"降级了**：量出来 `turn_truncated` 在可比语料 15,283 条事件里**出现 0 次**，
> 而生产者确实在（`src/providers/stop-reason.ts` 的 `turnTruncatedEvent`）⇒ 是**真流量上从没截断过**，
> 不是取料面缺失。同一次清点还量到 **30 类事件里有 13 类在可比语料中一次都没出现**（下表 G7）——
> 这条比任何单项都重要：**「用真语料校准」在那些面上没有观测者**。

## 一、差距清单（七项，含本轮新降级/新增的两条）

| # | 差距 | 落点（file · 符号） | 判卷读数（第一次红从哪来） | 成本 |
|---|---|---|---|---|
| P0-1 | judgment-layer 附录 A 的「可粘贴复跑」命令在 HEAD 已 TypeError，且**没有门在守这一类** | `docs/judgment-layer-calibration-proposal.md` 附录 A；新登记面 `scripts/replay-readings.ts`；判据落 `scripts/docs-check.ts` | 新判据当场造红：把任一 `replay:` id 从登记表删掉 ⇒ 「引用无源」红；把某条命令改坏（少一个反引号）⇒ 复跑红。**反向一侧**：登记表里存在但无人引用的 id ⇒ stale 红（同 `docs-check` 的 LEGACY_WAIVERS 水位只降不升口径） | 半天（其中改脚本 5 分钟，门是大头） |
| P0-2 | ~~distill 看不见截断，零成本白拿~~ → **降级**：真语料 0 次截断 | `src/agent/memory/distill.ts` `failureDigestFromEvents`（三分支：`tool_call` / `tool_result(!ok)` / `verify_result(!ok)`） | 用例只能用**合成**事件流：给一条 `turn_truncated` 进 `failureDigestFromEvents` 必须多出一段文案、且**无截断时逐字不变**（两侧各一条）。门：`memory-check` 的断言。⚠️ 不许拿它当"已观测收益" | 约 1 小时（纯函数 + 2 用例） |
| P1-3 | `verify_result` 无机器可读 `cause` ⇒ 环境红同时做三件错事（涨 attempt / 喂升档 / 进沉淀） | `src/events/index.ts` `VerifyCommandResult`（`verify.ts` 只 `import type`）+ `src/agent/verify.ts` `runVerifyOutcome` 的四个产出点 | 口径**不在本页重述**（对表页 §八 已指：judgment-layer §9.1 纯结构五值、零文案匹配）。本页只补一条判卷改进：`cause` 落盘后，`tests/` 须有一条「同一条环境红在**三处出口**都不涨 attempt/不喂升档/不进沉淀」的合取断言，三道各测各的看不见中间漏过去 | 一天级（§9 已排期，非新事） |
| P1-4 | 默认档 91 次出卡 **100% 落在 `L3-mode`**，风险层零决策权 | `src/permissions/autonomy.ts` `evaluate` 的 `mode === "default" && isWriteCall` 短路支 | **升级判卷读数**（这是本页对 §7 第 1 步的唯一新增）：原读数「default 行 ask 密度必须从 92% 动起来」是**数量**判据，会被别的原因推动；改成**位置**判据——对表页附录 A 命令 2 的 `ask按layer` 里 `L3-mode` 那一格必须掉、`L4-*` 必须非 0。用例仍进 `tests/gate-audit.test.ts`（`GATE_LAYERS` 穷尽断言会替我盯新分支） | 半天（§7 已排期） |
| P2-5 | LLM 安全审查的 `confidence` 是**被审模型自报**、缺省硬编码 `"medium"`，且无条件跑 | `src/agent/security/llm-review.ts`（`r.confidence ?? "medium"`）；闸门在 `orchestrator.ts` | 已裁「另案单修，不并进提案对表」。修法两条选一：改显式 `source: "self-reported"`（静态可判），或用 `routing/bandit.ts` 的 `Posterior` 出后验频率。判据：字段若是自报，`security-check` 须断言它**不得参与**任何排序/阈值分支 | 2 小时（改字段一侧）/ 更大（后验一侧） |
| P2-6 | 跨厂商双模型**只能半跑**：`toWorkerModel` 四路已接，但主会话 `PROVIDER_KINDS=["demo","glm"]`、key 存储面白名单 `["glm"]` | `src/main/settings.ts` `PROVIDER_KINDS`；`src/main/provider-keys.ts` `PROVIDER_IDS`（与 `src/providers/registry.ts` 同名不同值） | 门 0 可达性同族（能力已发货、入口没通）。判据写成**合取**：设置面出现的 provider 选项必须 ⊆ key 存储面白名单 ∪ `demo`，否则 `providers-check` 红。**不许**只加"可选但存不进 key"的 UI | 2 小时（登记边界 + 一条判据）；跨家真接是**另一回事**，见 §三 |
| G7 | **13/30 类事件在可比语料里一次都没出现**：`session_meta`、`compaction`、`security_report`、`impact_report`、`card_action`、`diff_comment`、`routing_decision`、`automation_triggered`、`automation_skipped`、`automation_completed`、`goal_set`、`goal_stopped`、`turn_truncated`（按 `AgentEvent` 联合成员逐个对 `type` 字面量核，见附录） | 不是 bug，是**测量面的分母**：语料 20 个文件里 `assistant_delta` 占 14,411/15,283（94%），受管判定面只有 99 条 | 任何「用真语料校准 X」的提案，先查 X 的事件类型在不在这一列里；不在 ⇒ 该面**没有观测者**，读数一律标 `unmeasurable` 而不是 0 | 0（是一条纪律，不施工） |

## 二、建议的落档顺序（依赖，不是并列）

```
P0-1（复跑面可信赖） ─┬─> P1-3（cause 落盘）──> §7 第 2 步攒料 ──> 第 3 步 τ
                      └─> P1-4（拆短路；判卷靠 P0-1 修好的那条命令）
P2-6（登记 V1 边界 + 可达性判据）    独立，随时可做
P0-2（distill 看截断）              独立，但收益 0 观测 ⇒ 排在 P1 之后
P2-5（自报 confidence）             独立，已裁另案
G7（观测面纪律）                    写进本页即可，无施工
```

**为什么 P0-1 排最前**：P1-4 的判卷读数**就是**那条跑不起的命令。判卷跑不起的项排在前面试图施工，
等于在没有尺的情况下量东西；且 P0-1 的门一旦加上，它守的是**全仓所有**自称可复跑的段落（本仓这类段落很多），
不只为这一条。

## 三、明确不采纳（理由 / 证据 / 反转条件）

| 不采纳 | 理由 | 证据（本轮实测） | 反转条件 |
|---|---|---|---|
| 把「执行前预期」落成第 31 种事件（对表页 §八 第 1 条） | 先证它配得上：**配对**实验没做之前建承载面 = 给不可标数字开位 | 语料里 `assistant_message` 仅 3 条（`assistant_delta` 14,411 条）⇒ 这 20 段会话根本**没留下可配对的整轮正文**；配对口径要求"预期"与结果按同一 `callId` 相连，今天无从起量 | 换一份**收全 `assistant_message`** 的语料重数一次；≥100 条可配对才建 |
| 语义检索 / 向量库 / Redis（对表页 §五） | 外部进程 + 分发面；无证据召回是瓶颈 | `embedding\|cosineSimilarity\|rerank\|…` 在 `src/` 命中 0 文件 | 「该注入未注入 / 注入了不相关」的可标计数 ≥ 每特征格 100 |
| 再加一层风险打分 | 现有三通道真流量区分度 1/99，第四层不动两头 | 对表页 §三 表 | P1-4 落地后 `L4-*` 出卡非 0 且 high/critical 开始有分布 |
| 为「像双模型」把跨家 provider 接上 | 战略前提第 4 条：报数须并报准确率与 `$/成功任务`，跨家的收益今天**没有数** | `pricing.ts` 九档 `calibrated: true`，但 `routingBandit/routingCascade` 默认 false ⇒ 价格表只服务 worker 侧 | 同一靶面上跨家一次**省多少 + 准确率掉多少**两个数都出来，且 P2-6 的可达性判据先绿 |

## 四、原子簇切法（按仓内既有纪律）

- **P0-1 拆两笔**：① 文档侧（该页附录 A 的 `mk()` 修 + 加 `replay:` 标记）；② 门侧（`scripts/replay-readings.ts` 新模块
  + `scripts/docs-check.ts` 新判据 + `LEGACY_WAIVERS` 存量豁免）。**判据的两半**都要在同一原子单元里：
  只落①则没有门（下一轮照样腐），只落②则该页仍跑不起。
  ⚠️ 文档侧那笔**撞在飞面**——`docs/judgment-layer-calibration-proposal.md` 现为 ` M`（别人的原子单元），
  必须等合并窗口或由其 owner 落；门侧那笔不撞任何在飞文件，可独立走。
- **P0-2 / P1-3 / P1-4 各自单笔**，每笔都含「纯函数或事件字段 + 用例 + 对应 `*-check` 断言」三件（拆开即 HEAD 悬空）。
- 每笔提交前按口径逐笔开隔离 worktree 单验；**新判据上线后先跑在自己的在飞改动上看读数**，
  并当场造一次红（跑完即删）再交。
- 全量 `pnpm gates` 收尾，且 `DSH_STRICT_UNVERIFIED=1` 跑一次——本页 G7 那 13 类无观测者的面正是严格模式会点名的东西。

## 五、本轮未做（边界声明）

未改任何 `src/` 或 `scripts/` 文件；未动在飞的那份 judgment-layer 文档（只记录它腐了）；
未 commit；未往共享看板立任务（Side chat）；P1-3 / P1-4 的**口径**沿用该页 §7 / §9，本页只改它两处的**判卷读数写法**，
不重述、不另起一条路线。

## 附录：G7 那条数的复跑口径（唯一的取料写法要点）

**必须逐个把联合成员映射到它自己的 `type` 字面量**，不能用名字做 snake_case 变换——
`RunErrorEvent` 的 `type` 其实是 `"error"`，按名字变换会凭空造出一个 `run_error` 假类型，
于是「缺 13」被数成「缺 14」。实跑：

```sh
node -e '
const fs=require("fs");
const src=fs.readFileSync("src/events/index.ts","utf8");
const union=[...new Set((src.match(/export type AgentEvent\s*=\s*([\s\S]*?);/)[1]
  .match(/\b([A-Z][A-Za-z0-9]*Event)\b/g)||[]))];
const files=[];const walk=(d,k)=>{if(k>4)return;let es;try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of es){const p=d+"/"+e.name; if(e.isDirectory())walk(p,k+1); else if(e.name.endsWith(".jsonl"))files.push(p);}};
walk("outputs",0);walk(process.env.HOME+"/Library/Application Support/m0-agent-loop/sessions",0);
const seen=new Set();
for(const f of files) for(const l of fs.readFileSync(f,"utf8").split("\n")){if(!l.trim())continue;
  try{seen.add(JSON.parse(l).type)}catch{}}
const missing=[],present=[];
for(const n of union){const m=src.match(new RegExp("interface "+n+"\\s*\\{[\\s\\S]{0,400}?type:\\s*\"([a-z_]+)\""));
  const t=m?m[1]:"??"+n; (seen.has(t)?present:missing).push(n+"→"+t);}
console.log("联合成员="+union.length,"语料出现过的 type 数="+seen.size,"缺="+missing.length);
console.log(missing.join("  "));'
# 实跑：联合成员=30 语料出现过的 type 数=17 缺=13
#       （13 项即 G7 那一张表；`error→5 次`落在 present 侧，不算缺）
```

## 本页写作过程中被自己推翻的三条（留档）

1. **P0-2 初稿写「零成本白拿、排最前」** → 量到 `turn_truncated` 在真语料 0 次后**降级**：它仍是正确改动，
   但收益是保险不是实测；判卷只能用合成事件流，正文须明写这一点，否则用例绿了会被读成"这面有观测"。
2. **「缺 14 类事件」→「缺 13 类」**：`run_error` 是我按名字变换造出来的假类型（真实 `type` 是 `error`，有 5 次）。
   取料写法从"名字推导"改成"逐个读接口里的 `type` 字面量"之后才对齐。
3. **生产者符号 `turnTruncatedFromStopReason` 不存在** → 真名 `turnTruncatedEvent`（`src/providers/stop-reason.ts`）。
   写符号名之前先 grep 一遍，别按语义编一个像样的名字——这类"读起来像真的"的指针比没有指针更坏。
