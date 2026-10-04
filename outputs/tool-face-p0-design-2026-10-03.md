# P0 打点设计：装配账落事件流（2026-10-03）

> 状态：**提案，未实现、未跑测试**。本文是评审对象，不是施工回执。
> 上游依据：[工具面与 laya 接入 · 专题研究结论](工具面与laya接入-专题研究结论-2026-10-03.md) §8 的 P0。
> 基线 HEAD `467caa0`。所有「现态」陈述均为主理人本日实读代码所得，已注明文件与行号。

---

## ⚠️ §0 评审后修订（2026-10-03，技术方案评审团 + 主理人复核）

**裁决：条件放行。本文有 11 处事实陈述与代码不符，不得照此施工。** 完整评审见 [tool-face-p0-review-2026-10-03.md](tool-face-p0-review-2026-10-03.md)。以下逐条更正本文对应段落——**修订块的效力高于正文，冲突处以修订块为准**。

| 受影响段落 | 原文（错） | 更正 |
|---|---|---|
| §2.3、§7 V2、§8 | 「加类型必须同时改**两处**」；「一致性由 `tests/event-registry.ts` 判」 | **至少 4 处**：联合 `src/events/index.ts:557` + `KNOWN_TYPES:590` + **`src/agent/sidechat.ts:111–165` 穷尽 switch** + **`src/agent/worker-projection.ts:87/105/112/118` 四桶之一**。**`unionTypes()` 全仓零消费者，`tests/event-type-coverage.test.ts` 不存在** ⇒ 原 V2 与 §8 回滚判据是**假判据**（永远绿）。唯一真自动网是 `tests/stream-redaction.test.ts:68–71` |
| §4.1 | 「主会话 / **worker** / 靶场 / 探针 / 暗卷都从本 provider 走」 | **worker 不过**（`createWorkerProvider`，`src/agent/orchestrator.ts:2466`，自建 `stream()`）。`planSurfaceBudget` 全仓唯一生产调用点是 `src/agent/glm-session.ts:829`。源码注释 `glm-session.ts:824–827` 关于 worker 的半句是腐注释。覆盖面须收窄为「走 session provider 的路径」 |
| §4.2 | 「`gym/probe.ts:177`、**sidechat** 未给 `opts.emit`」 | `probe.ts:169` **声明** emit、`:189` **条件转发**（只是调用方不给）。**sidechat 完全不过 `planSurfaceBudget`**（`sidechat.ts:328` 直连 `streamGlm`）⇒ fallback 对它**永不生效**，应登记为**已知覆盖缺口**而非受益方。另：`loop.ts:486` 是**工具 ctx** 的 emit，不是 provider 选项 |
| §4.1 | 「`account` 与 `surface.specs` 同是一份面」 | **两基混用**：`account` 用**降配前**的 `input.specs` 算（`model-surface.ts:151`），`surface.specs` 是**降配后**（`:210`）。降配轮的 `toolSpecChars/totalChars/piecesTop` 是**声明面** |
| §3 | 字段 `fixedChars` / `volatileChars` | **全仓无调用方传 `volatileChars`** ⇒ `volatileChars ≡ 0`、`fixedChars ≡ totalChars`（恒等「说谎字段」），删除或改名。`systemChars` **只是首条 system**，不含 memory/skills/地图/附件 |
| §3 | `request`（隐含复用请求计数） | 不能复用 `successfulRequests`（`glm-session.ts:809/956`，**成功后才 ++**）⇒ 失败请求不推进会出现连续 `request:1`。须在 `turnGenerator` 顶部加独立单调计数器 |
| §4.2 | 「命中时是 1 次 `Map.get` + 指针比较」 | 照抄现有 fallback 的 `finally close()` ⇒ 每次 append 实为 **open + stat + 读尾 1 字节**（`events/index.ts:628/646–676/783–789`）。改成**不 close**（依赖 `LOG_HANDLE_MAX` 有界缓存） |
| §4.2 | （缺）emit 失败语义 | **新增必写项**：`opts.emit` 无 try/catch，而本事件**每 run 首轮必过** ⇒ 抛错会成为新的单点故障。**必须二选一写明**：fail-open（catch + `console.warn`，推荐）或 fail-closed。**不许静默** |
| §4.3 | 「抖动由 PC2/PC3 负责」 | **断链**：PC1–PC4 只跑在 `scripts/prefix-churn-check.ts:43–105` 的**合成驱动器**上，全仓无判据读真实会话的逐轮面变化。且采样会**掩盖「面变小」**（run 中途摘 skill、未超帽 ⇒ 三条条件一条都不命中）。**修**：采样加「**面指纹变化**」（工具名序列长度+首尾名的轻量 hash，O(1)），并把委托措辞改成「合成门，不覆盖真实会话」 |
| §4.1、§7 | （缺）顺序不变量 | **新增必写项**：`compaction` 必须是会话日志**最后一条**（`tests/compaction.test.ts:481`、`compact-wiring.test.ts:77`、`hook-precompact-producer.test.ts:232`）⇒ 发射点必须在 compaction 块（`~884–920`）**之前** |
| §4.4 | 「单事件 ~500 B」 | **`shortened`/`dropped` 无界**（≤ 工具数 × ~25 B）⇒ 单事件最坏 ≈3–4 KB。须重算上界或只留前 N 名 + 计数字段 |
| §6 | 「`piecesTop` + `toolCount` + `toolSpecChars` 给出真实**最终面**」 | **结论成立、理由错**。回答上游 P0-b 的是 **`totalChars`/`toolSpecChars` 总数**，`piecesTop` 截断**无关**（红鲱鱼）。24k 帽下**送出面** ≈≤6.7k token **恒 <10K**，不区分两基会**误触发**上游 §7 的证伪行。**修**：字段分基落名 `declaredToolSpecChars`/`sentToolSpecChars`、`declaredToolCount`/`sentToolCount`；读侧 `import { CHARS_PER_TOKEN }` 并标注基与系数 |
| §3 | `piecesTop` 取前 12 件 | 其中含 `system:base` ⇒ 实际只点到 **11 把工具**。落名时排除 `tier === "system"` 或注释写明 |

**采纳的减负建议（Alt-A，验收岗提出）**：先只落 9 个字段（`request` / `declaredToolSpecChars` / `sentToolSpecChars` / `declaredToolCount` / `sentToolCount` / `overChars` / `shortened` / `dropped` / `unresolvable`），**暂不落 `piecesTop`** ⇒ §1 四问与 P0-b 全可答，单事件降到 ~120–200 B，体积争论消失；`piecesTop` 留到 P1 真做「按效用丢」时再加。

**建议的 P0 第 0 步**：`KNOWN_TYPES` 由 `Set` 改 `Record<AgentEvent["type"], true>`，让「忘了加」变成**编译期**错误——否则回滚完整性没有机械判据。

**我判定「不是问题」的**（避免过度修）：fallback **不会**让既有 gym 判据假红（三份评审独立一致 + 主理人复核）；目标文件**均不在**冻结面（66 项全为 `fixtures/**`）；新类型**不会**撞 exhaustive `never`（所有消费方均为 permissive `default:`）；`projectContext` **不会**放进模型面（但保护点是 V3 断言，不是注释）。

**§2.2 的「68 会话未观测到 24k 降配」无留痕物证** ⇒ V6 必须补存证页（JSONL 片段 + 检索脚本 + 命中计数）。

---

## 1. 目标与非目标

**目标**：让「每轮模型面付了多少字符、有没有触发降配、降配省了谁」这件事从**每轮算完即丢**变成**事件流里可回放**。交付一个能在真实 desktop profile 上回答下列问题的读数：

- 真实会话的固定面是多少字符 / 多少 token？
- 有没有触发 `MODEL_SURFACE_TOTAL_CHAR_LIMIT`（24 000 字符）？
- 触发时**被压描述的是谁、被整条丢的是谁**？
- 有没有走到 `unresolvable`（降配梯走完仍超帽）？

**非目标（本次明确不做）**：
- 不改 `planSurfaceBudget` 的**任何判据**（位置尾丢照旧、core 保护照旧）——判据改动是 P1。
- 不改工具表构造顺序、不改帽值、不改 `composeTurnMessages` 产出的模型可见内容。
- 不引入任何新依赖、不做渐进式披露（P2）。
- 不让模型看见这条事件（见 §5 的投影分析）。

**成功判据（可判红）**：在真实 desktop profile 上抓 3 个会话后，能回答上述四问；且**未超帽的轮次**的模型可见面与改动前**逐字节相同**。

---

## 2. 现态（实读，本日）

### 2.1 账已经算出来了，但没有出口

`src/agent/glm-session.ts:822–839`，`turnGenerator` 每请求都执行：

```
const face = opts.requestFace?.();
const declaredTools = face ? face.tools : opts.tools;
const surface = declaredTools && declaredTools.length > 0
  ? planSurfaceBudget({ specs: declaredTools, systemChars: opts.system?.length ?? 0, coreNames: CORE_SURFACE_TOOL_NAMES })
  : null;
const tools = surface ? surface.specs : declaredTools;
const liveNote = face?.note;
const surfaceNoteText = surface?.note ?? "";
```

`planSurfaceBudget` 返回 `SurfacePlan`（`src/agent/model-surface.ts:111–126`），其中已含全部所需读数：

| 字段 | 含义 |
|---|---|
| `account: ModelSurfaceAccount` | `systemChars` / `toolSpecChars` / `fixedChars` / `volatileChars` / `totalChars` / `limitChars` / `overChars` / `pieces[]`（逐件名字+字符+层级，按字符降序） |
| `shortened: string[]` | 被压描述的工具名（数组序） |
| `dropped: string[]` | 被整条丢弃的工具名（丢弃序 = 从尾向前） |
| `unresolvable: boolean` | 降配梯走完仍超预算 |
| `note: string` | 要贴给模型的那句话（省了谁必须说出去） |
| `prefixStableChars: number` | 与未降配版逐字符比对的「仍可缓存前缀字符数」 |

**实测出口只有一条**：`glm-session.ts:931` 把 `surfaceNoteText`（只有 `note`）交给 `composeTurnMessages`。`account` / `shortened` / `dropped` / `unresolvable` / `prefixStableChars` **全部就地丢弃**——`grep -n "surface" src/agent/glm-session.ts` 全部 13 条命中里，除 `surfaceNote` 外没有任何消费方。

### 2.2 触发条件本日实测为零

项目既有检索（成员 3 解压 68 个会话日志、5 个项目键，正则「字符已满（本轮超出 N 字符）」）**未发现 `limitChars=24000` 的运行时降配记录**，仅有的两条真实 note 都来自 `limitChars=3000` 的构造。⇒ **「24k 降配在生产里从未被观测到」目前既不能证实也不能证伪**（存档会话不代表真实面，且工具面是逐请求现算的、`outputs/` 不落盘完整清单）。这正是本设计要补的那一格。

### 2.3 事件流的承载面（实读）

| 事实 | 位置 | 对本设计的意义 |
|---|---|---|
| `AgentEvent` 是一个约 31 个成员的联合类型 | `src/events/index.ts:557` 起 | 新类型 = 加接口 + 加联合成员 |
| 写入口有 **KNOWN_TYPES 白名单**，未知类型**抛错** | `src/events/index.ts:746`：`if (!event \|\| ... \|\| !KNOWN_TYPES.has(event.type)) throw new Error("未知事件类型…")` | **fail-loud**：漏登记会当场炸，不会静默写进去 |
| `KNOWN_TYPES` 是手写第二份名单，与联合类型的一致性由 `tests/event-registry.ts` 判（该判据自陈靠 `indexOf("const KNOWN_TYPES = new Set([")` 解析源码，**判据本身脆弱**） | `src/events/index.ts:590`、`tests/event-registry.ts:14` | 加类型必须同时改两处 |
| 事件 id = JSONL 的 **1-based 行号**（`compaction.compressed_event_ids`、`prune`、`promote` 全按此取） | `src/events/index.ts:831` | **追加新类型只增行、不重编号**；但对 id 敏感的面会随行数前移（既有属性，非本设计引入） |
| 历史投影 `projectContext` 是 if-chain，**未匹配的类型静默落空**（末尾注释显式列出被忽略的类型：`clarify_requested / plan_proposed / plan_approved / usage / session_meta`） | `src/agent/context.ts:285–318` | 新事件**默认不进模型上下文**——但这是**依赖「没写分支」的隐式行为**，必须在那个注释里显式登记（见 §5） |
| 重放 `replayIncremental` 只做 `JSON.parse` + `typeof type === "string"`，**不做 schema 校验** | `src/events/index.ts:840–866` | 读侧不会因新类型失败 |
| `opts.emit` 只在**部分**路径存在 | `loop.ts:486`、`agent-runner.ts:1767/1886/1896` 给了；**`gym/runner.ts:80` 与 `gym/probe.ts:177` 与 sidechat 未给** | **关键约束**，见 §4.2 |
| 目标文件**均不在冻结面**（`scripts/frozen-sha256.json` 66 文件） | 本日核对：`glm-session.ts` / `model-surface.ts` / `events/index.ts` / `context.ts` / `prompt-cost.ts` 全部可改 | 无冻结冲突 |

---

## 3. 接口设计：新事件 `surface_account`

```ts
/** 每轮模型面装配账（观测only：只记已算出的数，不参与任何判定）。
 *  存在理由：这份账今天每请求都算、算完即丢，于是「真实面多大、有没有丢工具」在整个工程里
 *  没有任何一处可回放 —— 属「事件流外私有状态」缺陷族。 */
export interface SurfaceAccountEvent {
  type: "surface_account";
  /** 本 run 内的请求序号（1-based）。同类事件聚合成一条会话的序列。 */
  request: number;
  systemChars: number;
  toolSpecChars: number;
  fixedChars: number;
  volatileChars: number;
  totalChars: number;
  limitChars: number;
  overChars: number;
  /** 送出去的工具件数（降配后）。 */
  toolCount: number;
  /** 被压描述的工具名（数组序）。未发生则为空数组，不省略。 */
  shortened: string[];
  /** 被整条丢弃的工具名（丢弃序）。未发生则为空数组。 */
  dropped: string[];
  unresolvable: boolean;
  /** 梯级 A 的缓存代价：与未降配版逐字符比对的仍可缓存前缀字符数。 */
  prefixStableChars: number;
  /** 逐件账，按字符降序，**截断到前 N 件**（见 §4.3 的体积预算）。 */
  piecesTop: { name: string; chars: number; tier: "core" | "pinned" | "optional" | "system" }[];
  /** piecesTop 之外还有多少件未列（0 = 已列全）。 */
  piecesOmitted: number;
}
```

**设计取舍（供评审挑战）**：

1. **不落 `note` 文本**。`note` 已由 `surfaceNote` 进模型面，落流是重复；且它随措辞变会污染 diff。
2. **`piecesTop` 而非全量 `pieces`**。真实面 77 把工具若全落，单事件约 3–5 KB；截到前 12 件约 300–500 B。代价是「未进前 12 的件」只能知道**计数**不能知道**是谁**——本设计的四问不依赖后者，且 `dropped`/`shortened` 已给出名字。
3. **`shortened`/`dropped` 用空数组而非省略字段**。与 `usage` 事件「缺字段 = 没上报，不等于 0」的口径相反——这里「没降配」是**确定的事实**，省略会让读者分不清「没降配」与「旧版本没记这个字段」。
4. **不落 token**。token 是厂商给的数（见 `prompt-cost.ts` 头注：「要绝对值请读事件流里的 `usage`」）；本事件只有字符，token 由读侧按同一系数折算，避免两个口径。

---

## 4. 落点设计

### 4.1 位置

`src/agent/glm-session.ts`，`turnGenerator` 内、`surface` 算出之后、`composeTurnMessages` 之前（现态约 839 行后）。理由：这是**唯一**同时握有 `systemChars` 与**最终**工具表的地方——注释原文：「每一条装配路径都过这里（主会话 / worker / 靶场 / 探针 / 暗卷都从本 provider 走），接在 `sessionToolSpecs` 上则会漏掉直接传 `tools:` 的调用方」。

### 4.2 发射通道：**必须带 fallback**，否则漏掉 gym/暗卷

现态存在两种发射方式，且**同一函数内两种都在用**：

- `if (opts.emit) await opts.emit(e)`（`glm-session.ts:909`，压缩事件）
- `else { const log = createEventLog(logPath); try { await log.append(e) } finally { await log.close?.() } }`（同处 fallback）

**关键事实**：`gym/runner.ts:80` 与 `gym/probe.ts:177` 构造 provider 时**不传 `emit`**。若本设计只用 `opts.emit`，则**靶场/暗卷/探针路径永远没有读数**——而工具面消融恰恰要在靶场里做（上游结论 P2 的验收就依赖 gym 同 case A/B 对照）。这是**会让 P0 结论在 P2 处失效的隐性缺口**。

**建议**：复用**同一个** helper（把 `glm-session.ts:909` 那两行抽成 `appendEvent(outcome)`），两条路径共用，不做第二份实现。
**代价**：无 `emit` 时每次多一次 `createEventLog` + `append`；`createEventLog` 有句柄缓存（`LOG_HANDLE_MAX=32`，`src/events/index.ts:737–745`），命中时是 1 次 `Map.get` + 指针比较。
**待评审**：这个 fallback 是否会让 gym/暗卷的事件账单在既有 gym 判据里造成假红（若有判据按事件数/事件类型分布断言）。

### 4.3 采样：不是每轮都落

**策略（建议）**：满足**任一**条件才落：

1. 本 run 的**第一个请求**（`request === 1`）——拿到基线面；
2. `overChars > 0`（触发降配梯）；
3. `shortened.length > 0 || dropped.length > 0 || unresolvable`。

**理由**：真实面在 run 中途通常逐轮不变（工具面逐请求现算是为了 skill 摘除，属低频事件）。全量落流会让日志线性膨胀却零增益；采样后典型会话只落 1–3 条。
**反证条件（会推翻采样）**：若 P0 读数的目的是「**逐轮**面是否稳定」而非「面多大」，则采样会掩盖抖动 —— 但那一问由既有 PC2/PC3 判据（`prefix-churn.ts`）负责，不需本事件重复承担。**这一条请评审正面挑战。**

### 4.4 体积预算

按 §4.3 采样，单会话新增 ≤ 3 条 × ~500 B ≈ 1.5 KB。对照：本仓 `outputs/` 与 `PROGRESS.md` 的体量争议（`repo-hygiene-check` 帽 0.6 已被撞破）说明本仓对「无上限增长」敏感——**事件流同样有这条纪律**，故必须写明预算并给 `piecesTop` 一个硬上限常量（建议 `SURFACE_EVENT_PIECES_TOP = 12`）。

---

## 5. 投影安全（必须显式登记，不能依赖隐式落空）

`projectContext`（`src/agent/context.ts:285–318`）的 if-chain **没有 default 分支**：未匹配类型静默不产出消息。这对本设计是**想要的结果**，但「依赖没写分支」是隐式的——一旦将来有人加 `default: throw` 或补全分支，本事件就会**进模型面**，直接改写可缓存前缀（`cacheableFace` = 首条 system + tools，`prefix-churn.ts:22`）。

**设计动作**：在 `context.ts:316–317` 那段被忽略类型的注释里，把 `surface_account` 显式列进去（与 `usage` / `session_meta` 同格），让「不进上下文」成为**写下来的事实**而不是巧合。

---

## 6. 读取面（这一条会**吞掉**上游结论里的 P0 第二格）

上游结论把 P0 写成两格：(a) 装配账落流、(b) 把 `scripts/prompt-cost.ts` 覆盖面扩到含插件真实面。

**本设计主张 (a) 直接蕴含 (b)**：`piecesTop` + `toolCount` + `toolSpecChars` 给出的是**真实会话里含插件的最终面**，而 `prompt-cost.ts` 今天是**首方静态面**的尺（`sessionToolSpecs({mode})`，`scripts/prompt-cost.ts:47`）。

- 现有做法要扩到插件面，必须拿到运行时的 `sessionToolFace(rt, faceArgs)`（`src/main/agent-runner.ts:701`）——它要一个 `rt`，脚本里没有，等于要把 runner 依赖链拉进脚本（`prompt-cost.ts` 头注明确拒绝过这种做法：「没有理由把 2 738 行的 runner 及其整条依赖链拉进来」）。
- 有了 `surface_account` 事件，**(b) 退化成「读一条真实会话的 JSONL」**，不需要新脚本、不需要新依赖。

**建议**：新增一个**只读**脚本 `scripts/surface-account.ts`：输入会话 JSONL 路径，输出每个 run 的 `{request, totalChars, toolSpecChars, toolCount, overChars, shortened, dropped, unresolvable}` 序列与会话级汇总。退出码恒 0（与 `prompt-cost.ts` 同口径：**是尺子不是门**）。
**待评审**：这个「(a) 蕴含 (b)」的推论是否成立——即 `piecesTop` 截断后是否仍足以回答「含插件真实面是多少 token」。**主理人自评这是本文最可能被推翻的一条。**

---

## 7. 验收判据

| # | 判据 | 类型 | 现状 |
|---|---|---|---|
| V1 | 未超帽的轮次，模型可见面与改动前**逐字节相同**（复用既有零回归支测例，`model-surface` 的「未超预算时与入参逐字一致」已由测例锁） | 回归 | 未执行 |
| V2 | `surface_account` 写入口过 `KNOWN_TYPES`；`tests/event-registry.ts` 的联合↔名单一致性判据仍绿 | 判据 | 未执行 |
| V3 | 新类型**不进** `projectContext` 产出（构造一条含该事件的序列，断言投影逐字节不变） | 判据 | 未执行 |
| V4 | 旧 JSONL 重放**逐字不变**（新类型是增量扩集，`events/index.ts:459` 口径） | 回归 | 未执行 |
| V5 | gym/暗卷路径能产出该事件（验证 §4.2 的 fallback 真的生效） | 判据 | 未执行 |
| V6 | 真实 desktop profile 抓 3 个会话，能回答 §1 的四问 | 交付 | 未执行 |

---

## 8. 风险与回滚

| 风险 | 触发条件 | 影响 | 最小修复 | 回滚 |
|---|---|---|---|---|
| KNOWN_TYPES 漏登记 | 只改联合类型 | 写入口当场抛错（fail-loud，非静默） | 补名单；`tests/event-registry.ts` 应转红 | 删事件类型两处即可 |
| 事件 id 前移 | 新事件插入到既有 id 引用之前 | `compaction.compressed_event_ids` / `prune` / `promote` 指向错位 | 本设计只**追加**，不插中间；须有判据钉住 | 同左 |
| 投影意外进面 | 将来补 `default` 分支 | 可缓存前缀被改写，缓存命中率下降 | §5 的显式登记 + V3 判据 | 同左 |
| gym 判据假红 | 有判据按事件数/分布断言 | 靶场红 | §4.2 待评审项；必要时给 gym 路径显式关 | 采样策略开关 |
| 日志膨胀 | 采样失效（例如每轮都变） | 会话 JSONL 线性增长 | §4.3 条件 + §4.4 硬帽 | 把采样条件收紧 |
| 「(a) 蕴含 (b)」不成立 | `piecesTop` 截断丢掉了关键件 | P0-b 仍需另建脚本 | 把 `piecesTop` 放宽或按需全量落 | 独立实现 P0-b |

---

## 9. 本设计**不**包含

P1（降配判据从「位置」改「角色/优先级」）、P2（渐进式披露最小形态）、P3（laya 仅重排）**均不在本文范围**。本文只做观测面，不动任何判定逻辑——这是上游结论「先补尺，再动引擎」的直接落地。
