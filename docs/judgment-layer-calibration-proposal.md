# 判断层校准路线：JEV 理念迁入 + ask 落盘方案

状态（2026-09-23 复算）：**§5 ask 落盘已实现（见 §8）；§9 第 0 步（verify 归因）与 §7 第 1 步（中间档
`guided`）都已落地且各有判卷；第 2 步有了自己的读数面，而它第一次跑出的读数是「可标分子 = 0」
⇒ 第 3 步（τ / 概率）在攒到真会话之前没有资格开工；第 4 步的前置（第 3 步的基线）因此也不存在**。
第 3 节是 2026-09-20 实跑读数、
§7 末与 §9.1 是 2026-09-21 的定序依据（均为当日快照，不表示当前值，复跑命令见附录）；
第 5–6 节是落盘与其判卷面；第 7 节是落盘之后的**四步顺序**（每步带判卷读数 + 外部决策模型的接入前提）；
第 8 节是裁决记录与落地状态；第 9 节是排在四步之前的**第 0 步：verify 归因**（含 (A)/(B) 口径裁决）。
⇒ 上面这句状态**每次复算都换**，所以别信它，信这三条读数：
`node --import tsx scripts/replay/gate-outcomes.ts`（分子与 `layer × verdict` 全矩阵，含 300 条资格线自判）、
`node --import tsx scripts/replay/verify-cause-mix.ts`（第 0 步：环境红的可归因占比）、
`node --import tsx scripts/replay/ask-density.ts`（第 1 步：ask 落在哪一层，即位置判据）。

本页不受 `docs-check` 的 D-2/D-4 管（不在 `LIVE_PAGES`），但门数/测试数一律不写死——
事实源是 `scripts/gate-manifest.ts` 与 `tests/`。

---

## 1. 缘起：只迁理念，不接模型

外部一份「基于 JEV 判断层的认知操作系统」目标文档（JEV = TypeSafe 的 System One 模型，
输出三原语 Choice / Score / Noul，hosted-only、**不可微调、不可自托管、不解释理由**）。
本仓不引入该模型，只采纳其中四条理念，并逐条对表了现有代码：

| 理念 | 现状 | 缺口 |
|---|---|---|
| 判断与生成分离 | `permissions/autonomy.ts` 的 L0–L4 就是判断层 | L4 的 `modelRisk` 输入是**要执行该动作的模型自己填的 args**（risk 通道里唯一的"判断"来自被约束方） |
| 类型安全决策 | `RiskLevel` / `EvaluateDecision` / tier 已是代码可消费类型；理由出自命中规则而非模型散文 | 基本已有，不再抽统一 `Judgment` 类型（过早抽象） |
| 校准驱动自主 | **真缺口**：自主性是二元的（规则命中→放行 / 否则逐次批），allow 与 ask 之间没有连续地带 | 需要「概率 + 代码阈值」，且阈值要能被判卷 |
| 快慢双环 | `routing/cascade.ts` + cheap 档 + bandit 已接成端到端（2026-09-18 闭合） | 已有；G-A 实测（solo 比 fanout 便宜 16.7x）正是给这类"加层"泼的冷水 |

## 2. 一句话结论

**这条路线的收益不是"少问几次人"，而是"把 default 与 auto 之间那个空档造出来"。**
校准阈值本身排在第二——第一是今天连"判了什么、人怎么答的"都无法从事件流回放。

## 3. 2026-09-20 实测（20 段会话语料 / 285 次 tool_call）

语料：`outputs/ga-strategy-2026-09-20{,-rep2,-rep3}/`、`outputs/loop-eval-*`、
`~/Library/Application Support/m0-agent-loop/sessions/`（生产会话目录实测只有 1 个 JSONL）。

### 3.1 直接读数：ask 密度读不出来

| 事件 | 计数 |
|---|---|
| `tool_call` | 285 |
| 其中受权限门管的（write/edit/run_shell/shell_rw/shell_ro/mcp__） | **99** |
| `approval_requested` | 3（**全部 worker 侧**；主会话 ask 走 IPC 不落流） |
| `tool_result` 带 `auto` 留痕 | **0** |

⇒ 99 条受管调用里，"当时判了什么、有没有问过人、人答了什么"事后**一条都读不出**。

### 3.2 反事实回放（把真实 args 灌回纯函数 `evaluate`）

假设（必须复述，否则数字无意义）：`rules=[]` 冷规则库（靶面工作区实测无 `.agent/permissions.json`）、
`frozenJudgePaths=∅`、`planBlocked=false`。这些会话当时跑在自主档 / worker auto 面，
所以下表 default 一行是**反事实量，不是历史发生量**。

| 口径 | ask | approve | 密度 |
|---|---|---|---|
| 默认档 | 91 / 99 | 8 | **92%**，每会话 4.5 次，20/20 会话全撞 ask |
| 自主档 · 沙箱正常 | **0** / 99 | 99 | 0% |
| 自主档 · 沙箱降级（`available===false`） | 91 / 99 | 8 | 92%（`sandboxRisk` 对所有写向给 high） |

### 3.3 三条风险通道在真流量上的区分度

自主档下 99 条的 `risk` 分布：**none=42 / medium=57 / high=0 / critical=0**。
拆解：`staticRisk` 非 none 命中 57 条 = edit_file 的**固定 medium**（不是判断，是查表）；
THREAT_TABLE 命中 **0**；网络命令 **0**；`modelRisk` 标记 **0**。

### 3.4 由此得到的三条判断

1. **默认档实际是"每次写都问"**：那 91 次 ask 全来自 `mode==="default" && isWriteCall` 分支，
   它在 L4 风险层**之前**短路——风险等级根本没参与这次决策。
2. **自主档实际是"每次写都放"**：ask=0，且不留痕。今天自主性全押在档位开关这一个二元量上。
3. **一个在真流量上从不 firing 的判断面谈不上校准**（ECE 无从谈起），而 medium=57 全是一行查表。
   ⇒ 校准所需的特征面不能建在 THREAT_TABLE 上（见 §7）。

### 3.5 顺带查到的两处既有损害

- **人工拒批被计成"工具失败"**：`denied()` 只落 `ok:false` + 文本前缀 `[permission denied]`，
  而 `tool-choice.ts` 的 `failures` 按 `!e.ok` 统计。二者今天不可分。
- **「两头断」第 9 次同形**：`gatedMcpTool` 在同函数内读 `d.auto` 做断路器计数，
  却 `return { ok, output }` 把审计丢了；worker 工具门同样不挂。

## 4. 样本量的诚实账（决定第二阶段能报什么）

- 定生死的是**正例数**（标为"该拦"的条数），不是总 n。ECE 分箱要每箱 ≥100；
  n=400 时 p=0.5 处的抽样噪声 ≈0.035，与目标 0.05 同量级——测了等于没测。
- 靶场 `fixtures/gym/cases` 实测 **4 个 case**，撑不起校准。
- 落盘后每任务约 4.5 条可标 ⇒ 300 条 ≈ 65 段交互会话；若拒批率 ~10%，其中仅约 30 正例，**仍不够报 ECE**。
⇒ 第二阶段先报**「免批覆盖率 @ 漏拦绝对条数」曲线**，τ 的选择规则写成一句可判红的话：
**漏拦 = 0 的约束下取覆盖率最大的 τ**。样本不足一律报 unmeasurable（沿用 `tool-choice.ts`
的 `Rate{n,over,value|null}` 形状与「分母为 0 取 null 不取 0」「未证 ≠ 通过」纪律），不新造读数形状。

## 5. 本轮改动：ask 落盘（把判定留痕补齐）

目标：让每一次权限判定——自动放行 / 人工批准 / 人工拒绝 / deny——**只从事件流就能回放**。
本轮不做概率、不做阈值，只造可标语料。

### 5.1 五个洞

| 出口 | 今天 |
|---|---|
| L3 规则 allow | `auto{source:"rule",ruleId}` ✓ |
| L3 scope 放行 | `auto{source:"session_scope"}` ✓ |
| L4 末行 approve（自主档主路径） | **无留痕** |
| `gatedMcpTool` | 读了 `d.auto` 却不挂到结果 |
| worker 工具门 | 不挂任何审计 |
| ask→批准 / 拒 / deny | 批准无痕；拒与 deny 只落 `ok:false` + 文本前缀，与工具真失败不可分 |

### 5.2 字段设计：单一事实源 + 派生投影

```ts
export type GateLayer =
  | "L0-hard" | "L1-deny" | "L2-ask-rule" | "L3-rule" | "L3-scope"
  | "L4-critical" | "L4-risk" | "L4-mcp-unannotated" | "L4-network" | "L4-pass";

export interface GateMeta {
  layer: GateLayer;
  verdict: "approved" | "auto-approved" | "rejected" | "timeout" | "unattended" | "denied";
  risk: RiskLevel;
  mode: PermissionMode;
  scope?: AskScope;
  ruleId?: string;
}
// ToolResultEvent 增可选 gate?: GateMeta
```

- `layer` **必须由 `evaluate` 返回**（`EvaluateDecision` 各分支加必填字段）。
  不允许消费端从 `reason` 字符串反推——那正是本次要修的形态。
- 现有 `auto` 降级为**从 `gate` 派生的投影**（写事件时算：仅 `L3-rule`/`L3-scope` 落 `auto`）。
  三条好处：① PROGRESS.md 记的"手工批准不记 auto"从各出口自觉变成代码保证；
  ② 既有断言（`tests/autonomy.test.ts`、`scripts/autonomy-check.ts` 对 `auto.source`/`ruleId` 的断言）
  一字不改继续绿；③ 留痕只有一个 writer，不给"两处各写一份"留缝。
- **不落** `riskReasons` 与全量 args：可由 layer+risk 派生，且自由文本违反外界文本有界性纪律。
- 挂 `tool_result` 而非新事件类型：与 `auto` 先例同形（零新事件类型）、按 callId 天然对齐、
  上下文投影无需扩类型联合。deny 未执行的调用今天也走 `tool_result`，故字段名取 `gate` 不取 `approval`。

### 5.3 接线清单（同批，拆开即 HEAD 悬空）

`permissions/autonomy.ts`（各 return 点补 `layer`）→ `events/index.ts`（`GateMeta`）
→ `main/agent-runner.ts`（gatedTool 挂载处 + **gatedMcpTool 补挂** + ask 的批准/拒绝两支）
→ `agent/loop.ts`（透传 `gate`，并由它派生 `auto`）→ `agent/worker-tool-table.ts`（补挂）
→ `permissions/index.ts`（类型 re-export）→ `agent/tool-choice.ts`（`failures` 口径改为
`!ok && gate === undefined` 才算工具失败）。

**明确不做**：不动 L0 三条 deny 的语义（只加留痕）；`obs_recall` 与 `M1E_SAFE_MODE` gate 两支不在
tool_result 出口上，硬挂会造出第三种形状，留位；不新建事件类型；不做阈值。

## 6. 判卷面

1. **唯一验收等式**：同一段会话 `受管调用数 == auto ∪ gate 留痕数`。今天是 `99 vs 0`。
   作为 `autonomy-check` 一条断言。
2. `tests/autonomy.test.ts`：十个 `GateLayer` 各一条。
3. 新 `tests/gate-audit.test.ts`：① `auto` 与 `gate` 语义互斥（auto 在场 ⇒ layer ∈ {L3-rule, L3-scope}）；
   ② 每条 `[permission denied]` 都带 `gate.layer`；③ 拒批不计入 `failures`。
4. 回归复验：typecheck / test / ipc-check / panels-check。
   实测 `src/renderer` 无任何一处读 `auto` ⇒ 新字段应 UI 零变化，**若 UI 变了就是回归**。
5. 新增门须登记进 `scripts/gate-manifest.ts`（清单即事实源，本页与 AGENTS.md 都不写死门数）。

## 7. 落盘之后：四步顺序（2026-09-21 定序）

原版是四条并列（概率来源 / 特征面 / 阈值位置 / 半步旁支）。并列就没有「先做哪条」的答案，
而今天有实测能定序：**每步的判卷读数决定下一步有没有资格开工**。四步全在 harness 内，
不含任何外部决策模型——第 4 步是「要不要引入外部提供方」的实验结论位，不是待写的代码。
（四步之前还有一步：**§9 verify 归因**，它决定第 2 步攒到的正例干不干净。）

### 第 1 步 拆短路：让风险层真的有决策权（唯一可立即动手且能红的一步）

§3.4 的头号判断：那 91 次 ask 全出自「mode 为 default 且是写向」那一条，它在 L4 风险层**之前**短路
⇒ 今天谈「给判定配一个概率」没有落点。先把概率要作用的那一层露出来，才谈得上校准。

- **动作**：只调那一支的次序（写向调用不再无条件 ask，改由 `risk` 决定走 ask 还是放行），
  **不引入任何数值判据**——数值判据是第 3 步的事。
- **判卷读数（2026-09-23 从「数量」升级成「位置」）**：复跑附录 A，读 `askByLayer` 那一格——
  **`L3-mode` 必须掉、`L4-*` 必须非 0**。原口径「default 行 ask 密度必须从 92% 动起来」是**数量**判据，
  会被别的原因推动（改阈值、动 `sandboxRisk`、语料换血都能让它掉下来而短路仍在）。
  数量掉 ≠ 位置挪；只有出卡从"档位规定要问人"挪到"风险层判要问人"，才算把概率将来要作用的那一层露出来。
  **基线（`ca2e6b0` 之后的尺，19 files / 97 条受管）**：`default sandbox=null ask=89 askByLayer=L3-mode:89`
  （**89/89 全在 L3-mode**，与 §3.2 那行的 91/91 同形）；`auto sandbox=null ask=1 askByLayer=L4-risk:1`；
  `auto sandbox=false ask=89 askByLayer=L4-risk:89`（`sandboxRisk` 对所有写向给 high ⇒ 自主档在沙箱确认不可用
  时退化成逐条问人，密度与默认档同级——这一格是第 1 步之外另开的账）。

- **不许碰**（语义与原「永不豁免」清单逐字不变）：L0 三条 deny（含判卷面冻结）、L1 deny 规则、
  L2 ask 规则、任何 critical、MCP 无注解 fail-closed。
- **零回归面**：自主档 ask 仍 0；`auto` / `gate` 等式（`scripts/autonomy-check.ts` 的
  `assertAuditCoverage`）一字不动。
  ⚠️ 本条原有一句「`src/renderer` 看不到任何变化」——**2026-09-23 落地时作废**（不是回归，是形态变了）：
  用户裁决走「造中间档、`default` 不动」，于是这一层露出来靠的是新档 `guided`，而新档必须可选，
  渲染层因此加了一格看板 + 一个设置按钮。§6 第 4 条那句「UI 变了就是回归」的适用面是
  **纯后端字段的改动**（那次 renderer 确实零引用），不能外推成"任何权限改动都不许碰 UI"。
  三档既有语义仍逐字不变，且这条是被数的：`default ask=89 / L3-mode:89`、`auto ask=1`、
  `auto+沙箱不可用 ask=89` 三臂复跑与上面基线完全一致（判卷与读数见 `outputs/permission-guided-mode-2026-09-23.md`）。
- 新增分支须在 `tests/gate-audit.test.ts` 的用例表里各给一条，否则 `GATE_LAYERS` 穷尽断言红。

**落地形态（2026-09-23，第 1 步收口）**：位置判据成立——`guided` 行 `ask=58 askByLayer=L4-risk:58`，
`L3-mode` 归零、`L4-*` 非 0 ⇒ 第 3 步的概率有了可作用的层。
残余的 58 次里 57 次是 `edit_file`：静态威胁表给"编辑文件（写向操作）"底线 medium，恰是这档的线。
**要把 edit_file 也降下来得改风险模型（按路径/内容判写向），那是第 1.5 步，不在本笔偷做**。

### 第 2 步 影子攒可标语料：零新代码，只跑真会话

writer 已在（§8：`gate.layer` + `verdict` 进 `tool_result`）。这一步同时读两件事——量、以及**成不成格**：

- **读数 A（量）**：可标条数 = 带 `layer` 且 `verdict ∈ {approved, rejected, denied}` 的 `tool_result`
  计数。**≥300 条才有资格进第 3 步**；正例（人拒）< 30 条 ⇒ 只报免批覆盖率、**不报 ECE**（§4 的分箱账）。
  样本不足一律 `unmeasurable`，沿用 `tool-choice.ts` 的 `Rate{n,over,value|null}` 与
  「分母为 0 取 null 不取 0」，不新造读数形状。
  ⚠️ 环境态红须先按 §9 归因排除——否则第 3 步的「漏拦绝对条数」会混进假正例，而那是唯一决定 τ 的量。

  **复跑入口**（读数 A 那条 300 的资格线由脚本自己判，不靠人记得住本页）：<!-- replay:gate-outcomes -->

  ```sh
  node --import tsx scripts/replay/gate-outcomes.ts
  ```

  首次实跑（2026-09-23；19 个 `.jsonl` / 97 条受管）：**带 `gate` 留痕 0 条 ⇒ 本面不可测**，脚本红着退出。
  同一轮还量到那 19 个文件的 mtime **全部早于**留痕落库那一刻（2026-09-20 23:04）——
  所以这个 0 是**语料旧**，不是生产者没接上（生产者侧由 `autonomy-check`/`gate-audit` 判着）。
  ⇒ 结论对定序有直接影响：**第 3 步（τ）在攒到新会话之前没有资格开工**，且攒料要真会话（要花真钱），
  不是再写代码。复跑一次以 `find outputs -name '*.jsonl' -newermt …` 类读数复核即可，不必信本页这句话。
- **读数 B（比攒够 300 条更先发生）**：先手工过 30 条正例，逐条标注它落在特征面哪一格——
  路径类（test / fixture / 源码 / 配置）、写落点在主树还是 worktree、波及面（文件数·行数）、
  是否重写刚写过的文件、命令族首段（由 §3.4 决定，**不含 THREAT_TABLE 六类**，真流量 0 命中）。
  **30 条里超过 1/3 落不进任何一格 ⇒ 是特征面错**，先改特征面再谈攒量。

### 第 3 步 第一个概率 = 后验频率（不花 token，也不需要任何模型）

- **来源**：离线人工 gold + Beta-Bernoulli 分层频率后验，父层回退做收缩；复用 `routing/bandit.ts` 的
  `Posterior` / 先验 α=β=2 / 「显式 rng、逐字段可复现」纪律。
- **先否掉的三个假选项**（原文保留，别回头路）：① `RISK_ORDER[level]/4`（手写字典换皮，真值为零，
  ECE 是自评）；② 模型自报 confidence（自证）——同型病灶已抓到一处实现在跑：
  `security/llm-review.ts` 的 `confidence` 取被审模型自报、缺省还是硬编码值，**另案单修，不并进来**；
  ✅ 该案已于 2026-09-23 收口（`b11b6c6`）：缺省不再编造 `medium`（缺席 ⇒ 字段缺席，来源由 `category` 推出），
  并且 `confidence` 从 `validateFinding` 的结构门槛里摘出——**旧写法下模型把自报值拼错会让一条真发现整条被丢**，
  那比"报告里少一个度量"贵得多（安全审查漏报）。判卷三种成因各一格 + 反向钉静态段的作者标注不变，锚点三根。
  ③ 线上日志频率（§3.1：正例样本结构性为 0；第 2 步之前更是如此）。
- **位置**：`evaluate` 内部**一处**，入参 `harmPrior?`，缺省 `undefined` = 零行为
  （与 M7 `impact` 钩子同款口径）。只在可豁免出口生效（默认档逐次、自主档 risk≥high、网络≥medium）；
  不放在调用方 ask 分支——那会把同一逻辑抄进主会话 / worker / obs_recall 三个出口（同族出口老坑）。
  断路器 `MAX_AUTO_APPROVALS` 继续对免批计数生效。
- **判卷读数**：**漏拦 = 0 的约束下取覆盖率最大的 τ** 那条曲线，外加两句可判红的边界：
  τ=0 时免批覆盖率必须 = 0（否则阈值分支有旁路）、τ=1 时必须 = 全量可豁免出口。
  上线前先影子模式：只记账不免批（与第 2 步同一条留痕面，不另建）。
- 半步旁支（顺序无关，可与本步同批）：把 `modelRisk` 从「证据」降为「其中一票」（§1 表第一行）。

### 第 4 步 才谈外部决策提供方（Laya 一类）：三条接入前提，任一不满足即不接

① 第 2 步的 ≥300 条可标已到位；② 候选方在**第 3 步那个基线的同一面**上报影子读数并打赢它——
读数 = 漏拦=0 约束下的免批覆盖率 + ECE，**只报 accuracy 不算**（基线本来就免费，打平即无收益）；
③ 分发口径改判：愿意随包带推理运行时，**或**提供方在包外（远端 HTTP）——只有后者才让
「随时接入」真的随时；torch + 421M 权重进 unsigned DMG 是分发决策，不是接口问题。

**接口不预留**：第 3 步的 `harmPrior?` 就是接入点，任何提供方（后验频率 / 远端分类器 / 人工先验）
都从这一个 number 进。`DecisionProvider` 注册表今天零使用者，为它建 = 假接缝 + 11 档
`GATE_LAYERS` 穷尽断言重写，且会诱导给未校准的数在 `GateMeta` 开一个合法位
（该接口今天故意不带概率：`autonomy.ts` 里 deny 分支连 `risk` 都宁可缺席，「缺字段比编一个值诚实」）。

Laya 今天的分（2026-09-21 查，只作第 4 步打分时的先验，不构成永久结论）：base 检查点零样本在
typed-decisions 上 0.362 / 0.342，**低于多数类基线 0.461**；招牌 0.766 那支是**在该 benchmark 自己的
训练切分上微调**来的（2×T4、4–5 小时）；真语料 28/99 受管调用含非 ASCII，会路由到 multilingual 支，
而该支**不带拟合温度**、zh-CN ECE 0.376——正是它自己警告的「高置信地错」。

### 定序依据（2026-09-21 实测，当日快照；复跑见附录 A / B）

- **「失败→换路」不排在前面**：285 次 `tool_call` / 16 条失败结果里，紧接着原样重调（参数一字不变）
  **0 次**，换参数重试 7 次 ⇒ 外部提案列的头号反模式在我们真语料上发生率为 0，而 `stuck.ts` 三条阈值
  本就是为它设的。限定：n=16 且语料是 mock 剧本驱动 ⇒ 只否「现在就造换路机器」，**不否**「真流量上再测一次」。
  另有 17 条 `tool_call` 无配对 `tool_result`，本轮未归因（deny / 中断 / distill 二写皆可能）。
  **2026-09-23 追注（不改动上面那句当日快照）**：那句「紧接着原样重调 **0 次**」量错了——尺有两处偏小
  （只认紧邻的下一个调用；参数按原始 `JSON.stringify` 比，换键序即读成"改过参数"）。修正尺后同一批语料重读
  = `失败=15 失败后再调同工具=8 参数一字不变=1 最深连败 run=1` ⇒ **结论（不现在就造换路机器）不变**，
  但依据从"人心里的一笔账"变成脚本印出来的裁决行（判据：run≥3 **且** 原样重试>0）。
  失准的方向值得记一句：**偏小的读数不会报错，只会让人安静地不下判断**——比红更坏。
- **多路候选 = fanout，已出数**：同一 case 三 rep，solo vs fanout 成本比 **8.3x / 13.4x / 30.0x**
  （tokens 8.0–31x、延迟 3.3–13x），三 rep 两臂 **verify 都绿、分数都是 1**；rep3 里 fanout 的
  worker 终态是 `failed×3`——活是主模型自己干的还照样满分。⇒ 本路线不含 candidate generator / beam search。
- **VoI 不含**：要估 Δp=0.21（0.51→0.72，α=.05、power=.8）需双臂各 n≈80、合计 ~161 个可标任务；
  现有可比语料 20 段会话、冻结靶面 4 个 case（`fixtures/gym/cases`）。
- **五类 confidence 不加**（decision / state / path / execution / verification）：有 oracle 的两类
  （`tool_result.ok`、`verify_result.ok`，退出码级真值）不需要浮点，给了是降级；
  需要浮点的三类没有可标源——那正是第 2 步要先补的东西。
- **外部提案里已属现状的两条**（记录以免被当新工程重做）：「Runtime 不依赖某个模型」=
  PROVIDER_IDS 白名单 + 按 provider 路由 + bandit 从真终态回灌；「循环变状态机」=
  `AgentStatus` 联合已是状态集（语料里出现的是 running=12 / done=9 / failed=3，`waiting_input` 的写侧在
  orchestrator 的 stuck 支）+ 事件溯源 replay + `respawnArgsFrom` 恢复链。

## 8. 裁决记录与落地状态（ask 落盘已实现，2026-09-20）

两条裁决均已定，按推荐口径执行：

1. **`src/permissions/autonomy.ts` 本轮改** —— `layer` 只能由 `evaluate` 产出，让消费端反推 `reason`
   就是本仓最忌的「注释自称同源、实现各抄一份」。改前 `git diff HEAD` 为空（无在飞改动）；
   不触判卷冻结面（`scripts/frozen-sha256.json` 不含 `src/permissions/**`，autonomy-check 收口的
   sha256 双查也逐字通过）。
2. **`auto` 降级为 `gate` 的派生投影** —— 新增 `autoOf(gate)`，由 `loop` 写事件时调用；
   「手工批准不记 auto」从各出口自觉变成代码保证。既有四组 `auto` 断言一字未改仍绿。

实现与 §5 的差异，以代码为准：

- `GATE_LAYERS` 实为 **11 档**——§5.2 那份清单少了 `L3-mode`（默认档逐次审批既不是规则命中也不是风险抬升）。
- 共享构造口 `gateBase(d, mode)` 故意**不含 `verdict`**：自动放行 / 人批 / 人拒 / 超时 / 无人值守
  只有持有审批结果的那一侧知道，故主会话 / MCP / worker 三处出口各补自己的 verdict 与 scope。
- `GateMeta.risk` 在 deny 分支缺席：那三条硬边界在风险层**之前**短路，当时没算过风险——
  缺字段比编一个 `"none"` 诚实。
- `ToolResultEvent.auto` 不再自家复制一份类型，改引权限层的 `AutoMeta`。
- 验收等式落在 `scripts/autonomy-check.ts` 的 `assertAuditCoverage`，三条路径实测 2 / 2 / 1 条受管调用全留痕。

实现过程中被等式当场抓出的两处既有问题：

- **「两头断」第 10 次**：`gatedTool` 里 `run_shell` 走沙箱分支的两条 `return` 原先直接返回
  `original.run(...)` / `runInSandbox(...)`，**连旧的 `auto` 都带不出去**——同一条命令走不走沙箱，
  留痕不一样。已一并补上（`withGate`）。
- **distill 沉淀轮用原 callId 补发 `tool_result`**（PROGRESS「坑五十二」同型）：等式若按
  「受管调用数 == 留痕条数」计会被这批合法二写误伤，故量词取**「每次受管调用至少有一条带痕迹的 result」**。
  留位未裁：`src/agent/memory/distill.ts` 的两类拒绝（非 remember 被白名单挡、合并审批未获批准）
  同样不带 `gate`——它们是判定但不是 `evaluate` 的判定，要不要纳入同一留痕面待裁。
  ✅ **2026-09-23 已裁（纳入，但单列一层）**：新层 `X-distill`（`X-` = 判定发生在 `evaluate` 之外），
  三型各占一格不塌合——白名单 ⇒ `denied`（没问过人）、合并审批被拒 ⇒ `rejected`、获准 ⇒ `approved`。
  不借 `L3-mode`/`L2-ask-rule` 的名：沉淀轮是**一次问答覆盖整轮**，借名会把它的量混进逐次审批的分母，
  而免批率/ECE 恰按 `layer × verdict` 逐格算。代价与补偿：`GateMeta.mode` 因此从必填放宽成可选
  （那一轮没有档位可言，宁缺不编），丢掉的编译期信号换回一条运行时判卷「gateBase 的产物必带 mode」
  + 反向一侧「`X-` 面就是不许有 mode」+ 三根锚点。读端零改动即收下这一行（骨架由两层枚举派生），
  但口径要记住：**`X-distill` 的 approved/rejected 按受管调用计，不按人的答复计**（折回轮数待有样本再做）。

**2026-09-21 追加两条裁决**（正文落在 §7 第 4 步与「定序依据」，此处只留索引，不重复内容）：
① 外部决策模型 Laya **不接**——域外近随机、中文流量落到不带拟合温度的支、torch + 权重进包属分发决策；
② 外部「Decision-Driven Agent Runtime」四十节**逐条对表后无新工程**——五类 confidence 与
统一 `DecisionProvider` 接口（含"先留个接口随时接入"这一降格版）一律不做，理由与可反转条件写在 §7。

**仍未做**（按 §7 的四步顺序排，不再当并列清单）：**§9 第 0 步（verify 归因 + 生产侧 mitigation）**
→ 第 1 步拆短路 → 第 2 步攒可标语料 →
第 3 步后验频率与 τ → 第 4 步才谈外部提供方。另 §5.3 留位的 `obs_recall` 与 `M1E_SAFE_MODE`
两支出口仍未纳入留痕面。

## 9. 第 0 步（排在 §7 四步之前）：verify 归因

**为什么排最前**：§7 第 2 步要攒的正例里，环境态的红会伪装成"该拦"；而今天一次环境红同时做三件错事——
计一次 `verifyAttempts`（`loop.ts:128` 无条件 `++`）、触发 supervisor 升档换更贵的档
（`orchestrator.ts:1217-1237` 的 `evidenceOf === "failed"`）、被 `failureDigestFromEvents`
计成「N 次验证失败」写进沉淀（`distill.ts:56-58`）。**误归因不只是分母错，它会被学进去。**

### 9.1 口径：只认代码里已有的判定，零文案匹配（2026-09-21 定）

原本在 (A) 纯结构 与 (B) 加一张输出特征表 之间犹豫。实测把 (B) 否了：

- 合成对照两例——真代码错（vitest 报 `Cannot find module ./bar`）与模块自身缺失（`node ./nope.js`）：
  **同一条串两边都出现、退出码都是 1、且都不在首行** ⇒ 「Cannot find module」这类跨域串不可分类。
- 真语料 305 段 output / 3 581 行：错误码形态首行命中 4、**非首行命中 2** ⇒ 首行锚定既盖不住
  要治的类（`node ./nope.js` 的首行是 `node:internal/modules/cjs/loader:1433`，不是错误码），
  又会误伤真代码错。
- (A) 的缺口只有半步：**`timedOut` 布尔（`verify.ts:43,65`）与退出码（`finish(code)`，`:46`）今天都在算，
  只是在 `:58` 的 settle 处被丢掉**；`(none)` 命令哨兵（`:172-186`）与 `hookError`（`loop.ts:138`）同理。
  ⇒ 这不是新抽象，是把已有零件接到 schema 上（「两头断」第 11 次）。

**定案的 `cause` 集**（全部来自已有判定，缺省 `"code"` = 零行为）：
`"code"` ∪ `"timeout"`（`timedOut`）∪ `"toolchain-missing"`（退出码 127，`verify.ts:52-57` 已在点名它）
∪ `"no-surface"`（`source==="none"`）∪ `"hook-error"`（`hookError`）。
外加 `exitCode?: number`。**包管理器错误码白名单（`^\[ERR_PNPM_…`）这一条先不加**——它要治的态
已被 9.2 消除，为已消失的样本建分类器是反向的"为假想需求设计"；9.2 之后仍复发再单加。

**分母的复跑（P1-3 的 before/after 尺）**：<!-- replay:verify-cause-mix -->

```sh
node --import tsx scripts/replay/verify-cause-mix.ts
```

它只回答一个问题：**这些 verify 红里，有几条今天光靠字段就能判出"不是代码错"**。
结构栏（产品将来能用的机制）与文案栏（人眼线索，只作证据不作判据）分两栏打，就是为了不被
"人看一眼就知道是环境问题"骗成"机器也能判"——上面 (B) 方案被否掉的正是这个混淆。
语料里没有 verify 拍时它标「不可测」并以 exit 1 退出（G7 口径：不报 0）。

**追加（2026-09-23 实测，反转上面那条"先不加"的省略）**：`verify-cause-mix` 在本机语料里读到
**红命令 3 条，3/3 全是 `[ERR_PNPM_UNSAFE_MODULES_DIR]`**（pnpm 拒动 modules 目录，模型代码根本没跑到）。
所以"它要治的态已被 9.2 消除"这句不成立，两处都不成立：9.2 的评测侧前缀治的是
deps-before-run / lockfile 预检那一类，碰不到 `UNSAFE_MODULES_DIR`；而 9.2 生产侧那半**至今没落**
（`agent-runner.ts` 的 `verifyExec` 在沙箱不可用时整段退回 `defaultExec`）。
⇒ 这一类不是"已消失的样本"，是**目前唯一被观测到的环境红样本**。是否补第 6 个 `cause` 值（还是先把 9.2
落到生产路径再判）是裁决点，代价与两条路的对照写在 `outputs/verify-cause-denominator-2026-09-23.md` §三。
上面那句原文不回改——它是 09-21 的裁决快照，以本段为准。

**口径变更（2026-09-23，用户裁决"加第 6 值"）**：`cause` 集由五值变六值，两处偏离原定案都在这儿写明，不留在代码注释里——
- **加第 6 值 `pkg-manager`**：包管理器**在自己那一行**打出的命名空间错误码（`ERR_PNPM_*`）。这是 §9.1
  「零文案匹配」的唯一一处加宽，边界是**行首锚定 + 命名空间码**：被测脚本把同样文字引用在行中间不算
  （`classifyVerifyFailure` 有反向用例钉住）。它不属于被否掉的 (B) 方案——(B) 治的是跨域串
  （`Cannot find module` 两边都出现），而 `ERR_PNPM_*` 只有 pnpm 自己会打。
- **`toolchain-missing` 口径加宽**：从"退出码 127"扩到"127 **或连 shell 都没起来**"（`child.on("error")`
  那条路今天就存在、今天也置 `ok:false`，只是没名字）。
- 第一笔＝**schema + 生产者**（两条 exec 出口都归因：非沙箱 `defaultExec` 与发货缺省的沙箱
  `verifyExec`，只落一支就是"环境红只在降级时才不冤枉模型"）。
- 第二笔＝**三处出口一起落**（合取判据不允许拆开）：① 环境拍不占 `maxVerify` 修复额度，走自己的上限
  （2 拍）并在正文说明停因；② worker 证据退回 `absent` 而非 `failed`——级联升档与 bandit 奖励读的是
  **同一格**，且"证明力为零"与既有第四态同义 ⇒ 不加第 5 态；③ 沉淀把环境拍摘出模型失败清单，
  另记一笔「N 拍因 harness 侧原因没跑成」并明写不许记成模型经验。
  **同一拍有两个取料面**：`verify_result` 与 loop 注入的那条 `tool_result(ok:false)`——只挡前者，
  沉淀里仍会留「verify×N（工具失败）」，等于换个名字记账。
- 具名不动的两处：`no-progress` 仍视重复环境红为停滞（它给的是一句"换条路"提示，不是记账）；
  `cost-per-progress` 仍按最后一条 verify 的 `ok` 定结局（"没被证明做成"在 $/成功任务格里就是未成功）。
  复跑尺：`replay:verify-cause-mix` 的 `带 cause 字段的红命令`（旧会话流永远读 0，该读数只对
  **新跑出来的**语料有意义）。判卷与代价见 `outputs/verify-cause-denominator-2026-09-23.md` §六。

### 9.2 先落 mitigation：那个 pnpm 环境态评测侧已消除、生产侧还活着

评测侧 `EVAL_EXEC`（`scripts/loop-eval.ts:87`）带 `pnpm_config_verify_deps_before_run=false` 前缀，
它就是为了绕开 pnpm 的 deps-before-run 预检；**生产侧没有**——`verifyExec`（`agent-runner.ts:1078`）在
沙箱不可用时整段退回 `defaultExec`，既无前缀也无 `pnpm run test → VITEST_DIRECT` 映射，
而 `VITEST_DIRECT` 本身指向**本 app 自己的** `node_modules/vitest`（`:151-152`），对用户仓并不适用。
⇒ 用户仓里 `node_modules` 由别的 pnpm/lockfile 装过时，`ERR_PNPM_UNSAFE_MODULES_DIR` 会原样复发，
并被记在模型头上。

**第 0a 条**：把这条已验证有效的 mitigation 搬进生产路径（`defaultExec` 侧，或其上游一处）。
判卷：造一个 `node_modules` 为符号链接的临时仓，加前缀前红且输出含 `ERR_PNPM_`、加后不再出现该态。

### 9.3 三条不变式（分类存在的唯一理由，每条都能红）

1. `cause !== "code"` 的红**不得**增加 `verifyAttempts` ⇒ 写法：连续两拍 timeout 时 `attempt` 序列
   必须是 `1,1` 而非 `1,2`，且第三拍仍能跑（今天会被 `maxVerify=3` 掐死）。
2. 非 `code` 红**不得**喂 supervisor 的升档判据，也**不得**进 `failureDigestFromEvents` 的失败计数。
3. 证据不隐藏：事件照落、UI 照显，但文案改"验证未运行 / 工具链缺失 / 超时"而非"验证失败"；
   非 `code` 红**不许改判成绿**，只许"不计入模型的账"。读数缺信息时写 `null`
   （沿用 `tool-choice.ts` 的「分母为 0 取 null 不取 0」），**`unmeasurable ≠ pass`**。

### 9.4 判卷面与接线清单

- 新 `tests/verify-attribution.test.ts`：注入假 `ExecFn`，五态各一条 `cause` 正确；
  普通非零退出码且无特征 ⇒ `"code"`；**反例必测**：vitest 报告里含 `Cannot find module` 时仍须判 `"code"`
  （钉住 9.1 的否掉理由，别让人日后"顺手加个串匹配"）。
- `loop.test.ts` 补 9.3 三条；`supervisor-check` 补一条 env 拍不升档；沉淀侧补一条计数为 0。
- 接线（同批，拆开即 HEAD 悬空）：`events/index.ts`（`VerifyCommandResult.cause?` / `exitCode?`）
  → `agent/verify.ts`（`finish()` 带出 code/timedOut、`(none)` 结构化、9.2 的 mitigation）
  → `agent/loop.ts`（`verifyBeat` 按 cause 决定 attempt 与外注）→ `agent/orchestrator.ts`（`evidenceOf`）
  → `agent/memory/distill.ts`（计数排除非 code）→ `renderer/app.js` + `history-window.js`（文案三态）
  → `projections.ts`（若面板投 cause）。`src/tools/` 不动。估 120–180 行含测试。
  ⚠️ `app.js` / `panels-check.ts` 若在别人的在飞改动集里，先做相交检查或等窗口（AGENTS.md 那条规矩）。

### 9.5 顺带撤下一条上一轮的说法

「唯一那次失败的根因 100% 是 harness」成立，但**"成功率被系统性低估"要撤**：那个 pnpm 态在
`loop-eval` v1 之后已被 `EVAL_EXEC` 的前缀消除，v2 的 I2 两臂都是**种子红 → 末绿**。
⇒ 当前评测路径上对成功率的观测压制 = **0 次**；风险只在 9.2 那条生产侧未防护的分支上。
本仓纪律：读数口径变了要回改结论，但**不回改当时那句原文**——所以这条以追加形式留在这里。

---

## 附录 A：反事实回放（§3.2 / §3.3；也是 §7 第 1 步的位置判据 `askByLayer`）

复跑入口已入库：<!-- replay:ask-density -->

```sh
node --import tsx scripts/replay/ask-density.ts
```

（登记表 `scripts/replay-readings.ts`，判据 `docs-check` D-8：引用无源 / 登记无人引用 / 脚本不在盘上 /
仍有内联 heredoc 复跑块，四条各能红。）

**这段原来是一段内联 heredoc，2026-09-23 实跑已 `TypeError: s.planBlocked is not a function`。**
根因不是有人改坏了脚本，而是它在文档里**永不过编译**：`planBlocked` 从 `boolean` 变成 `() => boolean`
（评审 C6：快照布尔只有主会话三处刷新，worker 那条路从不刷）之后，文档里手搭的 fixture 与产品形状脱钩，
而"可直接粘贴复跑"这句话没有任何门在守。搬进脚本后它进 tsc 覆盖面，且 fixture 走
`newAutonomySession`——会话形状由构造器持有，再加字段/改形状会在编译期崩，而不是落在下一个复跑的人身上。
第 1 步落地后**同一条命令**再跑一次，看 default 行是否仍 92%。

语料清点与 `approval_requested` / `tool_result.auto` 计数（§3.1）用同样的 walk + 逐行 `JSON.parse`，
按 `e.type` 分桶即可。

## 附录 B：定序依据的读数（§7 末「2026-09-21 实测」）

一条命令出全部四项（受管量、非 ASCII 占比、失败数、失败→重用的两种计数）。
2026-09-21 实跑输出：`会话文件=20 tool_call=285 受管=99 受管含非ASCII=28` /
`失败结果=16 无配对result=17 失败后仍调同一工具=7 其中参数一字不变=0`。

```sh
node --import tsx scripts/replay/corpus-inventory.ts
```

<!-- replay:corpus-inventory --> 同上登记（`scripts/replay-readings.ts`），且 join 键写成具名常量：
`tool_call` 侧 `id`、`tool_result` 侧 `callId`，任一缺失即**抛错**而不是静默跳过——
按错键查会得到 `Map.has(undefined)` 恒 false，把「失败」读成 0（本页自纠第二条踩过）。

**复跑的前置不是"有仓库"，是"有语料"**：两条命令的取料面（扫描根 / walk / 受管集 / 逐行读盘）收在
`scripts/replay/corpus.ts` 一份里（受管集派生自产品的 `SHELL_FAMILY`，不另抄字面名），而会话流 `.jsonl`
**不在 git 里**——所以干净 checkout 上它们**退出 1 并说明缺哪个根**，而不是打一片 `0` 被人当读数念
（2026-09-23 在隔离 worktree 实踩过一次，修法与判据见 `outputs/replay-face-gate-2026-09-23.md` §五）。

**join 键是唯一容易踩错的地方**：`tool_call` 的字段叫 `id`，`tool_result` 的字段叫 `callId`。
fanout 三 rep 的比值不用脚本——直接读 `outputs/ga-strategy-2026-09-20{,-rep2,-rep3}/report.md`
表里 solo 与 fanout 两行的 `$` 列相除。

自纠备案：本页首版把 `tool_call` 总数人工相加误报为 306，实跑为 **285**，正文已统一；
复跑命令输出的 `受管=99` 即该 285 的子集。
第二条（2026-09-21，附录 B 的来历）：首次量「失败→重试」时把 `tool_call` 也按 `callId` 查，
`Map.has(undefined)` 恒 false ⇒ 打出 **失败=0 / 原样重试=0** 的一片零**假读数**，差点据此把
「换路机器没测量收益」写成更强的一句。按 `id ↔ callId` 修正后失败是 16。
⇒ 读数出现整片 0 时先怀疑 join 键，再下结论（同 §3.1「ask 密度读不出来」是同一个形状）。
第三条（2026-09-23，同一把尺的**偏小**）：上面 09-21 那行 `其中参数一字不变=0` 里有一部分是尺造成的，
不是语料里没有——⑴ 重复只认紧邻的下一个 `tool_call`（失败后先去读文件就把整条漏掉了），
⑵ 参数按原始 `JSON.stringify` 比对（同一调用换个键序就被读成"改过参数"）。
两条同向偏小，且都恰好指向"没卡死证据 ⇒ 不用动"。修正后同一批语料读 **1**，最深连败 `run=1` ⇒ 结论不变。
现在这一格由 `repeatOfFailed` 直接印裁决（判据 `run≥3` **且** `原样重试>0`，阈值两侧各有一格用例），
不再留"给人自己心算的两计数"。与第二条的区别值得记：**第二条是零读数被当场发现（一片 0 扎眼），
这一条是"少一位数"永远不扎眼**——所以它靠的是锚点（5 条，逐条 ✅ 杀掉）而不是靠人看出读数可疑。

## 附：长轨迹上「接了线的那只阶梯」开不开口（2026-10-02，十条能力复测顺带查出）
<!-- replay:longrun-ladder -->

```sh
node --import tsx scripts/replay/longrun-ladder.ts outputs/eval-base-a outputs/eval-base-b
```

它只回答一个问题：**`no-progress` 接进主循环之后，真语料能不能喂出它的输入**。
判据逐字共用生产端那一只 `judgeNoProgressEvents`（自己再算一遍不算接线）；三只信号都是"首个命中即返回"
⇒ 整条流判出的命中点就是生产端最早可能开口的那个点，不早也不晚。
读数（取证 `outputs/capability-rescore-2026-10-02/`）：**24 条真模型跑的 verify 拍数分布 `[[1, 24]]`、阶梯开口 0/24**
⇒ R1 验证停滞定义要 ≥2 拍，在这批基准上**结构性不可达**。
所以结论要说准：**接线本身没问题**（5 条判卷＋"摘掉调用点就红"的反向验证都在），
缺的是**能产出该输入形状的题**——每趟只有 1 拍 verify，且 7 条红跑的那一拍全是绿。
