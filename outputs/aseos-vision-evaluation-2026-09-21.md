# ASEOS 愿景书评估（2026-09-21）

材料：外部 31 节愿景书《下一代 Agent Engineering System》（自称 ASEOS / Software Product Agent，
附件 1280 行），主张「构建以 Goal 为核心、以代码库为世界模型、以能力动态调用、以验证闭环为核心机制、
以经验积累为学习机制的自主软件工程 Agent」，结尾建议「先把 7 个平面之间的最小核心接口和数据流定死」。

> **结论先行**：三十一节里**没有一节是本仓没有的新架构**。逐节分账：**22 节已是现状**（下表逐行给指针）、
> **4 节不采纳**（§10 §11 §26 §27，各带反转条件）、**2 处真缺口**（requirement 级追溯、主会话写盘级撤销）、
> 其余 4 节属命名与不可判定（§2 定位命名、§29 闭环图与自家同构、§30 KPI 无量法、§31 终极目标即本仓前提）。
> 另有三节与自家**已出数**的实测直接冲突。它唯一照出的可执行动作不是"再加一台机器"，而是
> **给靶面补 y 轴**——自家结果面读数今天 8/8 全绿，文档 §30 那十一条 KPI 里八条的分子分母早就在了，
> 缺的是能失败的目标。
>
> 同族档案：`outputs/laya-evaluation-2026-09-21.md`（外部决策模型）、`outputs/zcode-study-2026-09-21.md`
> （外部仓库借形状）、`docs/judgment-layer-calibration-proposal.md`「§7」（DDAR 四十节 runtime 指令的裁决，
> 本轮材料的上一变体）。**本页只记新增判定，不重述那三页已裁的结论。**

## 一、先否厂商，再对表自家

这份材料无产品、无仓库、无论文可核（不需要外部事实核查），但有两处**自身兑现缺口**，值得先记下以免被它的
体量压住：

- §三 声称「建议建立 12 条核心原则」，实际只写了第 1 条（Goal First）就跳去写「四、第二核心」——
  十一条原则从未出现。
- §30 十一条 KPI **零条带量法**（无基线、无样本量、无判卷命令、无分母定义）。⇒ 不评目标高低，只判**不可判定**。

## 二、已是现状（别重复造）

指针一律用符号名不用行号（行号会漂）。

| 文档节 | 自家实现 | 文档没说到的一处 |
|---|---|---|
| §1 §3 Goal First | `goal-trace.ts` 的 `GoalSpec` + `goal.ts` 的 `goalStopDecision`（done 只由绿证据成立）+ `goalReminder`（每轮重送）+ `projectGoal`（从事件流重算） | 目标窗口**按最后一条 `goal_set` 之后重算**：上一段工作的绿证据不得替新目标销账 |
| §4 §5 世界模型 / 变更影响 | `map/rank.ts`（自实现个性化 PageRank + aider 边权）经 `glm-session.ts` 的 `createMapBuilder` 注进模型面；`impact/index.ts`（def/ref 跨文件边）→ `impact_report` 事件 + 摘要回注；`lsp.ts` / `impact_query` | 影响面摘要实测最坏 2112 token → 168 token（-92%）；文档只说"要做影响分析"，不说它值多少钱 |
| §6 用户意图理解 | `clarify.ts`（1–4 问/卡，提交值逐字回挂原 tool_use）+ `memory/store.ts` 的 `ROOT_FILES.preference` 与 `MEMORY_TYPES` 四类型 | 澄清答案不是"提取出来的意图"，是**人填的原文**——省掉了一整层会出错的意图推断模型 |
| §7 §9 动态规划 / Plan Mode | `plan-state.ts` 的 `planGateBlocks`（唯一判据）+ `propose_plan`（唯一有强制力的门）+ `sequencer.ts` / `supervisor.ts` / `stuck.ts` | 方案门状态挂 run 级 `AsyncLocalStorage`，并发 run 各持一份（A 的未批准 plan 不拦 B） |
| §8 Goal Mode | 已有开关：轮次帽（`GOAL_TURN_CAP_*`）+ 美元帽双闸，四条停止判据各自点名 | 「价格不可知」单独一支且**自己出现在文案里**——不把不可知记成免费 |
| §12 模型路由 | `routing/policy.ts` 档位表 + `routing/bandit.ts` Thompson Sampling，从**真终态**回灌（done→α+1 / failed→β），代价按 `pricing.costUsd` 真钱折算 | 文档给的是静态「任务→模型」表；那条表恰好是 bandit 要学掉的东西 |
| §13 Sub-Agent | `spawn_agent` read/write 两档 + `wait_for_agents`（W1a 收队工具）+ `worktree.ts` 合并控制塔（铁律：agent 无合并权） | 文档担心的「一群 agent 开会」本仓已用数据否过，见第四节 |
| §14 §15 心脏 loop / 验证引擎 | `verify.ts`（fail-closed：无配置不空转放行 + 多语言探测超时档 + 头尾输出环）+ `evidence.ts` 收据（quote sha256 逐字命中，0 容忍；源里有失败信号而收据无失败条目 ⇒ 整单作废） | **本仓比文档更严**：文档只要求"必须 verify"，我们还要求验过之后不得再写盘，否则绿证据判 `stale`（`worker-report.ts`） |
| §16 §17 §28 失败 / 记忆 / 学习闭环 | `distill.ts` 的 `failureDigestFromEvents`（把 `verify_result(ok:false)` 与 `tool_result(ok:false)` 聚成一行喂沉淀）+ `memory/store.ts` 两层×四类型 + bandit + gate 留痕 | 无失败时 digest 返回空串、指令**逐字不变**（零回归），文档没有"不许凭空造教训"这一格 |
| §18 §19 Token / 上下文工程 | `economics.ts` / `text-budget.ts` / `compaction.ts` / `prune.ts` / `observation-capture` + `obs_recall`（按需拉回） | 提醒块帽值本身就是成本上限，注释按「最坏 8 倍」估——文档把 token 经济写成"每次行动算 EV/cost"，那需要它没有的判据源 |
| §20 §21 长任务 / 状态机 | 阶段不立字段、一律从事件流投影（不变量：不写第二份会话态）；`AgentStatus` 六态；`recovery.ts` 明写 V1 无热恢复 | 文档要"数小时数天"，本仓今天真断的是**跨重启自动续跑**（重开靠人或定时任务触发，不自动复活） |
| §22 §24 §25 权限 / 自适应自治 | `autonomy.ts` 的 `evaluate` 四层固定序短路 + `GATE_LAYERS` 十一档 + 风险三通道（critical 任何档强制审批）+ 断路器 + `rules.ts` 规则库 + scope 记忆 | 文档那张表里 `git commit → allowed` 这一格本仓**不照抄**：commit 属写向、按档判定 |

## 三、真缺口（两处，只有第一处已立任务）

**缺口 1 · requirement / DoD 级追溯（§15 的 Evidence Graph、§1 Goal 树的 Constraints/Quality/DoD 分支）**

`GoalSpec` 今天只有三个字段：`objective` / `maxTurns` / `maxUsd`。整仓没有任何 requirement 实体、
字段或事件类型（附录 A 读数 B）。便宜在于**注入通道已经在付费**——`goalReminder` 每轮重送 objective，
加字段不是新机器而是同一条通道里的形状扩展。

**前置纪律（没有它就不许开工）**：每条 dod 必须绑一条**机器可判**的东西（一次 verify 命令的退出码，
或一条精确 grep 判据）。绑不上的条目不许进 `GoalSpec`——那等于把散文换个标签，正是文档 §14 自己反对的
「LLM 说完成 = 完成」。反转条件：若补了字段但可绑率 <100% 的那批条目仍被塞进收束判据 ⇒ 该撤回。

**缺口 2 · 主会话写盘级撤销（§23）**

`src/` 里 `undo` 有，但它是**消息级**（`app.js` 的 `undo` 分支：删节点 + 把上一条用户消息放回输入框），
不触盘；全仓 `git checkout` / `reset --hard` / `stash` **零命中** ⇒ 「撤销本会话改过的文件到会话起点」
这个出口今天不存在。worker 侧有等价物（worktree 不合并即丢弃），主会话是就地写。

**没立任务的原因**：主树是多会话共享面，一条「撤销我的改动」在共享树上就是「可能抹掉别人的在飞工作」，
这不是实现难度问题而是安全裁决。要开这一格，得先答"以什么为界"（会话写过的文件清单可从事件流投影，
但回退动作本身需要一个不被共享面污染的基线，最可能是 worktree 化主会话）。

## 四、明确不采纳（理由 / 证据 / 反转条件）

- **§10 §11 Capability Router 按 cost·reliability·utility 自动选能力**
  理由：决策没有判据源，不是没写代码。证据：`tool-choice.ts` 头注「只投影，不做决策、不进模型面」，
  其 `UNMEASURABLE` 四条点名「选对率：事件流里没有『本该调哪个』的信息」「skill/MCP 在场但未用：
  日志不记当时有哪些可用」。本轮 8 次真钱运行里 toolFailures 合计 2 次。
  反转条件：留痕里出现"当轮可用能力清单"字段（`session_meta` 现在没有）且可标样本 ≥300。

- **§13 八角色 + §29 图里的多路 capability router**
  理由：已出数，多路在本仓靶面上是纯亏。证据：同一 case 三 rep，solo→fanout 成本 **8.3x / 13.4x / 30.0x**
  （token 8.0–31x、延迟 3.3–13x），两臂 verify 都绿、分数都是 1，且 rep3 的 fanout 三支 worker 终态全
  `failed` 仍照样满分。数字出处与复跑命令：`docs/judgment-layer-calibration-proposal.md`
  §7 末「定序依据」+ 附录 B（**该页在飞改动集里，别顺手改它**）。
  反转条件：靶面有 y 轴之后（任务 1 完成），fanout 臂在**真会失败的 case** 上救回率 > 0。

- **§26 §27 Product Intelligence / Software Product Agent 扩界**
  理由：与「只改 harness、不改模型能力」的战略前提直接冲突，且它把价值从"证明做完了"挪回"理解得对不对"，
  后者是模型上限决定的。反转条件：出现真实用户数据表明失败主因在需求理解而非执行验证——今天没有这类数据。

- **结尾「把 7 个平面之间的最小核心接口和数据流定死」**
  理由：与自家两次裁决撞（DDAR 轮已裁「不抽统一 Judgment 类型＝过早抽象」）。
  证据：七个平面里六个已经落在现有模块边界上（goal / map+impact / plan+sequencer / plugins+tools /
  verify+evidence / memory），唯一公共接口就是 `AgentEvent` 联合——那是**已定死的**单一事实源，
  再抽一层只收投影税，且立刻产生第二份状态。
  反转条件：出现第 2 个 runtime 消费者（今天 1 个：Electron 壳；headless/CI 走的是同一条装配）。

## 五、文档内部矛盾（引数即可，别重推）

1. §11 §18 要「最少工具调用、单位 token 最大进展」，同篇 §13 §29 要多角色与多路仲裁 ⇒ 互否；
   本仓对这组的实测标价就是上面那三个倍数。
2. §22 把 `git commit` 划成 allowed、§23 要求 snapshot/rollback，但全篇没说 rollback 由谁触发——
   一个"无需确认的 commit"加一份"没有 undo 的运行时"是自相矛盾的安全模型。本仓主会话恰好落在这格
   （commit 按档判定，写盘级 undo 不存在），所以这条对表值得单独记住。
3. §15 要 requirement 级精确追溯，§31 又要「让一个普通能力的大模型完成高级工程师的任务」⇒
   低能力模型拆出的 DoD 本身就是错的，追溯图只会**精确地证明一件错事**。文档没有任何一节处理 DoD 的质量校验。
4. §20 要长任务 + §30 要人工介入下降，但 §21 状态机里 `WAITING_USER` 是异常态而非产出态；
   本仓相反：`waiting_approval` / `waiting_input` 是 `AgentStatus` 的正式态，且无人值守走 fail-closed。

## 六、本轮两条便宜读数（方向与文档相反）

**读数 1 · 结果面已饱和，有区分度的不是验证机器**

文档整篇前提是"缺验证机制、缺指标"。自家真钱语料（v2 两臂 8 次运行）实测：**`verifyOkLast` 绿 8/8**。
⇒ 任务成功率、首次完成率、错误恢复率这三条 KPI 今天在靶面上**没有 y 轴**，造面板也读不出差异。
有区分度的是过程纪律：判卷达标 **4/8**，红因全在「写盘前没有 propose_plan」「写盘前一次都没读」
「改动越出 src/」「改了判卷面」。

更硬的一条：四个 case 里只有 I2 是 `seed: "bug"`（起点为红、必须修对才算数），I1/I3/I4 起点是干净靶子
⇒ 结果面**结构上就不可能失败**，模型只要不弄坏就绿。且同一 I1 在两臂起点不一致（base 红 / short 绿），
`scripts/loop-eval.ts` 自己注明靶子 `fixtures/todo-app/src/todo.ts` 是生成物、会被任何一次
e2e/agent/gate 就地重置 ⇒ 起点还是漂的。

**这条读数把文档的方向反转**：要拿的不是"再建 Verification Engine"，是**给靶面补会失败的 case 并钉住起点**。

**读数 2 · 结构面计数**（否掉"缺策略层/缺自治档"这类指控用）：权限判据 11 档、自治 3 档、生命周期 6 态
（附录 A 读数 C）。文档 §24 的四级里"自动 + 可审查"这一级本仓由 gate 留痕 + 审批徽标承担，不是缺档。

**钱的并列口径**（按战略要求，准确率与 $/成功任务必须并列，不报单边）：

| 臂 | 运行 | 过程达标 | 总钱 | 达标的钱 | ¥/达标 |
|---|---|---|---|---|---|
| base | 4 | 2 | ¥0.1214 | ¥0.0349 | ¥0.0175 |
| short | 4 | 2 | ¥0.0669 | ¥0.0304 | ¥0.0152 |

限定：每臂 n=4、单 rep、价目取端点 `/v1/models` 中转价 ⇒ **只出单次读数，不宣称趋势**。

## 七、下一步（本轮已立任务，未动代码）

1. **靶面补 y 轴**：给 `loop-eval` 的 `TASKS` 补 2–3 个「起点为红、必须做对才红转绿」的 case，
   并把起点钉住（副本起始态断言 + 不符即拦住不出数）。判卷 = 结果面出现非全绿分布（verify 绿率在 4/8~8/8 之间）
   且起点断言零漂。
2. **`GoalSpec` 加可选 `constraints[]` / `dod[]`**：缺省 undefined = 零行为；每条 dod 必须绑退出码或
   精确 grep 判据，绑不上即拒收（fail-visible，不静默收下）。

## 附录 A：复跑命令（本轮逐字实跑过，输出照抄）

**读数 A · 结果面 / 过程面 / 起点分布**

```
node -e '
const fs=require("fs");
let vOk=0,vTot=0,gOk=0,seedRed=0;
for(const p of ["outputs/loop-eval-v2-base/readings.json","outputs/loop-eval-v2-short/readings.json"]){
  for(const x of JSON.parse(fs.readFileSync(p,"utf8"))){
    vTot++; if(x.r.verifyOkLast===true)vOk++; if(x.g&&x.g.ok)gOk++; if(x.r.seedVerifyOk===false)seedRed++;
  }
}
console.log("verify 绿 "+vOk+"/"+vTot+" | 过程达标 "+gOk+"/"+vTot+" | 起点为红 "+seedRed+"/"+vTot);
'
```

输出：`verify 绿 8/8 | 过程达标 4/8 | 起点为红 3/8`

**读数 B · requirement 实体不存在（含负控）**

```
grep -rniE "requirement|acceptance" src/ ; echo "命中行数：$(grep -rniE 'requirement|acceptance' src/ | wc -l | tr -d ' ') / 负控 verify：$(grep -rniE 'verify' src/ | wc -l | tr -d ' ')"
```

输出：唯一命中是 `src/providers/registry.ts` 注释里的档案指针 `m5-acceptance`；
负控同 flags 下 `verify` 命中 322 行 ⇒ 零命中不是写法问题。（**shell grep 一律 `grep -E`、不用 `\b`**——
BSD grep 静默返空，见 AGENTS.md 判卷纪律。）

**读数 C · 策略/自治/状态机计数**

```
node -e '
const fs=require("fs");
const layers=(fs.readFileSync("src/permissions/autonomy.ts","utf8").match(/export const GATE_LAYERS = \[([\s\S]*?)\] as const/)||[,""])[1];
const pm=(fs.readFileSync("src/permissions/index.ts","utf8").match(/export type PermissionMode = ([^;]+);/)||[,""])[1];
const st=(fs.readFileSync("src/events/index.ts","utf8").match(/export type AgentStatus = ([^;]+);/)||[,""])[1];
console.log("GATE_LAYERS = "+layers.split(",").filter(s=>s.trim()).length+" 档");
console.log("PermissionMode = "+(pm.match(/"[^"]+"/g)||[]).length+" 档 " + pm);
console.log("AgentStatus = "+(st.match(/"[^"]+"/g)||[]).length+" 态 " + st);
'
```

输出：`GATE_LAYERS = 11 档` / `PermissionMode = 3 档 "read-only" | "default" | "auto"` /
`AgentStatus = 6 态 "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "cancelled"`

**读数 D · 写盘级撤销不存在（含消息级 undo 的区分）**

```
grep -rniE "undo|revert|rollback" src/ | sed -n '1,10p' ; echo "--- git 回退面 ---" ; grep -rnE "git (checkout|reset|stash)|\"checkout\"|'checkout'" src/ | wc -l
```

输出：`undo` 6 处全在渲染层（`message-actions.js` 图标、`index.html` 按钮、`app.js` 的 `undo` 分支 =
删消息节点 + 放回输入框）；git 回退面 **0 命中** ⇒ 写盘级撤销确实不存在。

## 附录 B：本轮被自己负控推翻的三条初稿（留档，防回潮）

1. 初稿写「`src/` 全仓 `undo|revert|rollback` 零命中」⇒ **错**。负控跑出 6 命中，读内容后发现是
   消息级撤回。真结论是"消息级有、写盘级无"，这个区分才是缺口 2 的正确写法。
   成因：第一次搜索带了 `|snapshot` 且结果被分页截断到 25 行，只看到 snapshot 那批就下了零命中判断。
2. 初稿写「`requirement` 全 src 零命中」⇒ **不精确**。实际 `requirement|acceptance` 有 1 命中，
   且是注释里的档案指针。结论不变（无实体），但报数必须带这一条命中。
3. 初稿文首写「二十七节是现状换了词」⇒ **虚高 5 节**。落盘后审查时按第一节列逐节分账重数：
   现状 **22 节**（1/3/4/5/6/7/8/9/12/13/14/15/16/17/18/19/20/21/22/24/25/28）、不采纳 **4 节**
   （10/11/26/27）、命名与不可判定 **4 节**（2/29/30/31）、真缺口落在 15 的一支与 23 —— 合计 31 才对得上。
   成因：把「表格 13 行」当「13 组 ≈ 27 节」心算，没有逐节枚举。⇒ **凡"N 节"这类计数必须由枚举产生，
   不能由行数换算**。文首已就地改成逐节分账（本页当日新建，非他方证据档案，故按实修正而非追注）。

**教训（本仓第 N 次同形）**：说"不存在"之前，必须(a)不带 `head_limit`、(b)配一条同 flags 的正向负控；
说"共 N 节/条"之前，必须逐条枚举而不是由行数或印象换算。
