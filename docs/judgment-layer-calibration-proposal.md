# 判断层校准路线：JEV 理念迁入 + ask 落盘方案

状态：**方案待裁决，未开工**。第 3 节是 2026-09-20 实跑读数（当日快照，不表示当前值，复跑命令见附录）；
第 5–7 节是本轮要做的改动与其判卷面；第 8 节是两条待用户裁决的点。

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

## 7. 落盘之后（第二阶段，另立案）

- **概率来源**：先否掉三个假选项——① `RISK_ORDER[level]/4`（手写字典换皮，真值为零，ECE 是自评）；
  ② 模型自报 confidence（自证）；③ 线上日志频率（§3.1：正例样本结构性为 0）。
  可行路径 = 离线人工 gold 集 + Beta-Bernoulli 分层频率后验，复用 `routing/bandit.ts` 的
  `Posterior` / 先验 α=β=2 / 「显式 rng、逐字段可复现」纪律，父层回退做收缩。
- **特征面**（由 §3.4 决定）：路径类（test / fixture / 源码 / 配置）、写落点在主树还是 worktree、
  波及面（文件数·行数）、是否重写刚写过的文件、命令族首段。**不含 THREAT_TABLE 六类**（真流量 0 命中）。
- **阈值位置**：`evaluate` 内部**一处**，入参 `harmPrior?`，缺省 `undefined` = 零行为
  （与 M7 `impact` 钩子同款口径）。只在可豁免出口生效（默认档逐次、自主档 risk≥high、网络≥medium）；
  **永不豁免**：L0 三条 deny（含判卷面冻结）、L1 deny 规则、L2 ask 规则、任何 critical、MCP 无注解 fail-closed。
  不放在调用方 ask 分支——那会把同一逻辑抄进主会话 / worker / obs_recall 三个出口（同族出口老坑）。
  断路器 `MAX_AUTO_APPROVALS` 继续对免批计数生效。上线前先影子模式：只记账不免批。
- 半步旁支：把 `modelRisk` 从"证据"降为"其中一票"（§1 表第一行）。

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

**仍未做**（排在落盘之后）：概率来源与标注集、阈值分支、影子模式，以及 §5.3 留位的
`obs_recall` 与 `M1E_SAFE_MODE` 两支出口。

---

## 附录：复跑方法

回放脚本以内联 heredoc 执行，**未入库**（若要成为常态读数，需登记进 `scripts/gate-manifest.ts`）。
下面这段可直接粘贴复跑，产出 §3.2 的两档 ask 与 §3.3 的 risk 分布：

```sh
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
  sandboxAvailable: sandbox, planBlocked: false, frozenJudgePaths: new Set<string>(),
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
```

语料清点与 `approval_requested` / `tool_result.auto` 计数（§3.1）用同样的 walk + 逐行 `JSON.parse`，
按 `e.type` 分桶即可。

自纠备案：本页首版把 `tool_call` 总数人工相加误报为 306，实跑为 **285**，正文已统一；
复跑命令输出的 `受管=99` 即该 285 的子集。
