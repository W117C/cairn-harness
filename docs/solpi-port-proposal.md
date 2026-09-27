# SoL-Pi 四机制移植方案（harness 效率回流轮 · 提案 v1）

> **对表对象**：`NVlabs/SoL-Pi`（commit `2b79168`，scratch clone 于本会话）+ 本仓 `agent-plan.md` §5/§6.2/§7/§11。
> **纪律**：本文件是提案，不是任务书；未拍板前不动 `agent-plan.md`（只读）。每处引用用「符号名 + `文件:行号`」双锚，行号易腐（`docs/m5-proposal.md` §7 起的既有约定）。
> **口径**：三态 = 已证 / 未证 / 留位；**未证 ≠ 通过**。

---

## 0. 推荐路径（一句话）

**先接生产热路径（P-1：把已实现但只跑在暗卷里的「组装型 provider」接到 `runAgent`），再补其余五处地基（P0 附件回取接线、P1 shell 尾部留档、P2 缓存与 cache 计量、P3 靶场投影级计量、P4 进度边界信号源），然后按 ①留档回取 → ②可验证证据 → ③边界+经济压缩 → ④写后同轮 lint 的顺序移植四个机制；每个开关默认关，每步用靶场 A/B 的数字决定去留。两条贯穿全案的取舍：命令与切点一律由系统从既有配置 / 既有事件派生，不交给模型；机制只有落在产品热路径上才算交付——暗卷绿 ≠ 可用。**

---

## 1. 背景与目标

### 1.1 要解决的问题

SoL-Pi 的命题与我们 `agent-plan.md` §7/§6 是同一个：**在不早停、不跳验证、不藏证据的前提下减少 token traffic 与模型轮次**。它的四个机制各自命中我们一处真实缺口（缺口全部代码级核实，见 §2 与 §8 事实表）：

| SoL-Pi 机制 | 我们的缺口 | 缺口性质 |
|---|---|---|
| （四机制共同前置） | 具备回灌 / prune / 压缩 / 记忆 / 地图的组装型 provider 只被 `scripts/gate-check.ts:233` 与 `tests/compaction.test.ts:413` 消费；`runAgent` 用的是单轮、无工具面的演示 provider（`src/main/agent-runner.ts:797-826`） | **能力已实现、不在生产热路径**（先立未接，详见 §2-P-1） |
| ObservationPack | 被裁原文生产路径不落盘、shell 超限字节直接丢弃 → 证据不可回取 | **规格已要求，实现未接线**（§7.4 明写「可回取」） |
| Evidence-Preserving Reducer | 摘要/整形产物无「逐字可回溯」校验，膨胀拒绝只量长度不验真 | 质量闸缺一维（§7.3(d) 三闸之外的第四闸） |
| Online Context Compact | `selectCut` 只看 tail 的 token 预算，无「进度安全点」；触发无条件 A（经济） | 判据不完整：会在未完成步骤中间压掉续做所需上下文 |
| Action Fusion | `agent-plan.md` §5.4 明写「每轮写动作后跑 lint（快、失败即反射）」——**代码里根本没跑**，只有模型主动 `verify` 才跑 | 规格-实现偏离（省一次模型轮次的收益白丢） |

### 1.2 为什么现在能做

- 事件模型与投影链已就位：`projectContext(events, replacements?)`（`src/agent/context.ts:54-57`）已有「按 id 替换投影文本」的槽位，留档句柄不需要新装配路径。
- 原子单元纪律已就位：`atomicUnits` / `selectCut` 的二分回退（`src/agent/compaction.ts:243-292`）——「切点不落在单元内部」的机制已在，加「进度边界」只是给 tail 起点多一个吸附条件。
- 附件命名与防穿越已就位：`attachmentName` 清洗 + sha1 前 8 位防碰撞（`src/agent/prune.ts:132-139`）、`attachmentPathFor`（:221）。
- 回取语义已就位：`writePruneAttachments` + prune-check ④「读回且逐字一致」——**只差生产接线**。
- 可验证性判据已就位：靶场 fork@event 重放（`scripts/gym-run.ts:69-71`）+ 基线回退线（成功率降 >2% / token 升 >5%，`scripts/gym-run.ts:119-121`），A/B 有尺子。
- 门与沙箱已就位：`createVerifyHook(repoDir, {exec})`（`src/agent/verify.ts:151`）+ `verifyExec(sandbox)`（`src/main/agent-runner.ts:977`）——写后 lint 可直接复用同一条沙箱化执行器。
- opt-in 先例已就位：`routingBandit: false`（缺省 = 零行为）+ `validateSettings` 白名单校验（`src/main/settings.ts:47-48,124,155`）。

### 1.3 预期效果（结束时用数字说话）

**口径备案**：M6 之前的靶场「明卷 token = 冻结剧本字节的纯函数」（`src/agent/gym/runner.ts:35-49,94-95`），**量不到投影侧的节省**。因此 §2-P3（投影级计量）是本轮一切指标的前置，未落地前本表全部记 **未证**，不得对外表述为下降。

| 指标 | 度量口径 | 目标 |
|---|---|---|
| 每任务装配字符数（真正发给模型的上下文） | 新增 `assemblyChars` 采样进 `usage`/新事件（§3.0） | 长会话（≥40 轮）降 ≥15% |
| 模型轮次 / 任务 | `runLoop` step 计数 | ④ 落地后降 ≥1 轮/写任务（lint 反射不再单独占轮） |
| 压缩有效性（无效率 = 压完又超窗） | compaction 事件序列 | 不升高（③ 的经济闸必须证明「推迟压缩」不劣于「早点压」） |
| 证据可回取率 | 被裁/被截内容能从磁盘取回的比例 | 从 **0%（生产）** 到 100%（开启 ①/②后） |
| 改对率（score） | 靶场 `scoreCase` | **零退化**（硬约束：score 降即判该机制不采纳） |
| 缓存实付 | provider 真实 cache 计量（§2-P2） | ③ 的经济判据以此为唯一输入 |

### 1.4 非目标（明确留位，不偷做）

- **不做远程 reducer 外呼**。SoL-Pi 的 `evidence-preserving-reducer` 会走 `ctx.modelRegistry.complete` 把日志正文（`<untrusted_log>` 包裹）发给另一个模型（`evidence-preserving-reducer/provider.ts:102-118,137-149`、`receipt.ts:50-61`）。这违反 `agent-plan.md` §7.7「不做远程/服务端压缩」+ BYOK 本地优先；且它自己的 SECURITY.md 都要求「必须留本地的日志别开」。**②只移植它的「可验证收据」纪律，不移植外呼模型**（本地确定性实现，见 §3.2）。
- **不做模型自带命令的工具融合**。SoL-Pi `then_run` 的命令 100% 由模型给，全仓 `approv|permission|deny|allowlist|sandbox` 在 `src/` 内零命中，且 `SECURITY.md:3` 自述「不是沙箱也不是权限边界」。我们的门禁在权限层强制（§5.1），照抄 = 开一条绕过 `gatedTool` 的 shell 面。**④只跑项目配置里的命令**（见 §3.4 与 §4 权衡 1）。
- **不做 tokenizer 依赖**（§7.7 不变）：经济判据的 token 全部走 `estimateTokens` chars/factor + `calibrateFactor`（`src/agent/compaction.ts:43-67`）。
- **不动 `agent-plan.md`**；不改 `KNOWN_TYPES` 既有项语义；不改 `fixtures/**` 判卷（sha256 冻结，见 `scripts/frozen-sha256.json` 28 项）。
- **不照抄它的磁盘回收口径**：SoL-Pi 的 ObservationPack / reducer 归档「随会话结束也不删」（`README.md:122`），只有 OCC 状态随会话删（`SECURITY.md:18`）。我们两者都须可回收（R4），但保留期策略另案。
- 不做 Probe 二次自检（§7.7 已记 M3+ 候选）。

---

## 2. 前置：六处硬缺失（顺序即依赖序，先补地基再谈机制）

> 每条给「现状证据 → 缺什么 → 阻塞谁」。**P-1 排在最前（编号保留 P-1 只为不打乱 P0–P4 的既有交叉引用）；P0 属判据缺陷，须先按判卷纪律写 `BLOCKED.md` 要求换判据，不许改代码去绕。**

### P-1 — 四个机制的共同落点：组装型 provider 不在生产热路径（最上游）
> 此条已由 `outputs/agent-review-2026-09-15.md` §0 结论 1（T-1）立案、`outputs/analysis-arch-2026-09-15.md` §「接入点」给出接法，**但至今未落地**。本轮复核把三条链全部实读钉死（下列锚点逐条自查，非引用他人结论）。

- 现状（三条链）：
  1. **生产 run 的 provider 是演示通道**：`createProvider()`（`src/main/agent-runner.ts:797-826`）在 `M0A_PROVIDER=glm` 时返回一个 **memoized 的** `streamGlm([...prefix, {role:"user", content: userMessage}], {}, undefined, call)`（:822）——`tools` 实参是 `undefined` ⇒ **无工具面**；生成器只造一次 ⇒ `runLoop` 第 2 轮的 `streamFn(projectContext(seen))`（`src/agent/loop.ts:79`）拿到的是**已耗尽的同一迭代器** ⇒ **单轮**。其余分支（含缺省）一律 `createMockProvider(MOCK_FIXTURE)`（:811）。
  2. **组装型 provider 只有验收侧消费者**：`createGlmSessionProvider`（`src/agent/glm-session.ts:285-426`）是唯一做 `replayIncremental` + `computePrune` + `projectContext(events, replacements)`（:316-327）、记忆回注（:362-368）、压缩协调（:371-385）、符号地图（:387-401）、插件重挂（:403-416）、再 `composeTurnMessages → streamGlm(msgs, {}, opts.tools)`（:418-420）的那条路，**全仓消费者只有 `scripts/gate-check.ts:233`（暗卷）与 `tests/compaction.test.ts:413`**；`src/main/**` 只从该模块导入 `createGlmSummarizer`（`src/main/agent-runner.ts:15,192,447,1649`）。它自己的注释也承认契约：「以事件日志为唯一事实源……故忽略入参沿用构造时的 opts（gate-check 暗卷路径冻结依赖此契约）」（`glm-session.ts:350-352`）。
  3. **UI 连会话模式都没进**：现行渲染层唯一调用点是 `api.run({ message, mode })`（`src/renderer/app.js:1954`），**不传 sessionId** ⇒ `handleAgentRun` 走非会话支（`src/main/agent-runner.ts:1099-1100`）⇒ `logPath = <tmp>/m0b-agent-events.jsonl` 且 `runAgent` 开头 `rm` 掉它（:877）⇒ 跨轮无历史、会话 JSONL 恒空。只有定时任务支真传 sessionId（`makeScheduledExecutor`，:644-648）。附带：`M0A_PROVIDER` 全仓无人写入（BYOK 启动注入只写 `M0_API_KEY`，`src/main/provider-key-inject.ts:10-13`），故打包后的 UI 主对话走的是**冻结 mock 剧本**；`providerInfo()`（:1468-1473）与设置页展示同源，也只认这个 env。
- 缺口：**①②③ 三个机制的物理落点全在第 2 条链上**（P0 的 prune 附件接线同样在 `glm-session.ts` 内），而第 2 条链不在产品路径；P3 的靶场采样在 `src/agent/gym/runner.ts`，那里跑的又是第 1 条链的 `runLoop` + 剧本 provider。⇒ 只做 P0–P4 而不做 P-1，四个机制在**用户能触碰到的路径上收益恒为零**，且靶场数字与产品现实脱耦（§1.3 全表变成自欺）。
- 动作（三步，零新接口——能力已全部存在于 `glm-session.ts`）：
  1. `createProvider` 的 `M0A_PROVIDER==="glm"` 分支改返回 `createGlmSessionProvider(opts.logPath, { system: systemPrefix, tools: gateToolSpecs(opts.mode), compaction: { summarizer: … }, workspace: opts.workspace })`（`gateToolSpecs(mode?)` 见 `glm-session.ts:30`；summarizer 沿用 `M0_API_KEY` 在场才给的既有口径，同 `agent-runner.ts:192`）。**mock / 各演示分支逐字节不动**（e2e 与 `*-check` 剧本路径不破）。
  2. provider 与 model 从 env 升级为 settings 项（进 `validateSettings` 白名单 + 「白名单未吞」反向断言，先例 `scripts/routing-check.ts:184-195`），`providerInfo()` 改读同一来源；`M0A_PROVIDER=glm` 保留为覆盖通道（不破坏既有 check）。
  3. UI run 带上 sessionId（`app.js:1954` 一处 + `window.d.ts` 类型），让会话 JSONL 真实生长——组装路径以日志为事实源，**没有日志就没有历史，也没有附件目录可挂**。
- 验收（新增 `tests/session-wiring.test.ts`；不改冻结判卷）：**W1** `M0A_PROVIDER=glm` 且日志预置 N 条事件时连续两次 `stream()` 均产出非空（多轮）/ **W2** 第 2 次 `stream()` 的 messages 含第 1 轮的 `tool_result`（回灌）/ **W3** 工具面在场：`tools` 名集合 == `gateToolSpecs(mode)` 名集合（反向：证明不再是 `undefined`）/ **W4** mock 分支事件流与基线**逐字节不变** / **W5** 带 sessionId 时写入 `pathOf(sessionsDir, id)` 且跳过 `rm`（钉住 :877 条件）/ **W6** 无 key 时 fail-closed 回 mock，不静默半接线。
- 阻塞：**①②③ 的产品有效性**、§1.3 全部指标、P0 的附件目录（附件目录必须挂在真实会话目录里才有读者）。
- 取舍备案：本条不是 SoL-Pi 的技术内容，而是移植的前置条件。若拍板「本轮只落暗卷路径、产品接线另案」，则 §1.3 指标表与「证据可回取率 0%→100%」两行必须整体改记**留位**，不得记已证——按本仓「未证 ≠ 通过」纪律。

### P0 — 附件回取是「绿灯的空头支票」
- 现状：`computePrune({ events })` 两个生产调用点均**不传** `attachmentsDir` / `sessionId`（`src/agent/glm-session.ts:322`、`src/main/agent-runner.ts:1017`）；`writePruneAttachments` 全仓唯一调用点在验收脚本里（`scripts/prune-check.ts:63`）。
- 缺口：§7.4「被裁原文写会话附件目录可回取」在产品路径上不存在。prune-check ④ 是脚本自己喂参数断言「函数正确」，**没有断言「生产会调它」**——判据缺陷（绿灯 ≠ 可用）。
- 动作：① 写 `BLOCKED.md` 要求 prune-check ④ 换成「生产接线断言」（从 `glm-session` 组装路径真实走一遍，断言附件目录出现文件且能逐字读回）；② 接线：会话附件目录 + `sessionId` 传入 `computePrune`。
- 阻塞：①②（留档回取的一切）。

### P1 — shell 超限尾部字节永久丢失（且 stderr 被丢）
- 现状：`collect()` 在 `out.length >= 32KB` 后 `truncated = true; return`——**chunk 直接丢弃**（`src/tools/run_shell.ts:21-31`），stdout/stderr 混采同一缓冲（:74-75）。
- 缺口：§7.4「日志→尾部 + 错误行」的整形规则**拿不到尾部**（尾部正是失败原因所在），只能给 head 截断 + 一句 notice（:39）。SoL-Pi 的做法是全量归档再投影（`observation.ts` + `O_NOFOLLOW` 对象存储）。
- 动作：`run_shell` 改为「全量写会话临时文件 + 内存只留 head/tail 窗口 + 返回句柄」；上限常量提为可配（现 `SHELL_OUTPUT_LIMIT = 32*1024`、`SHELL_TIMEOUT_MS = 60_000`，:5-6）。
- 阻塞：①（真正的证据保留）、②（可验证收据要求归档原文逐字可查）。

### P2 — 经济判据无输入：prompt caching 从未开启，cache tokens 从未计量
- 现状：全仓 `cache_control|cacheControl|prompt_cache|ephemeral` **零命中**（`src/providers/*.ts` 无注入点）；四家 provider 都不解析 cache 字段——`anthropic.ts:32,41` 的 usage 类型里只有 `input_tokens/output_tokens`，无 `cache_read_input_tokens` / `cache_creation_input_tokens`；`UsageEvent` 只有 `inputTokens/outputTokens/agent_id?`（`src/events/index.ts:25`）。**口径备案**：Anthropic 线上 API 是否真回传这两个字段，本仓**未证**——`providers-check` / `tests/providers.test.ts` 全走官方文档手写的 fixture（`PROGRESS.md:420-429`），无联网实测；故 P2 的第 1 步必须先拿到真凭据的响应样本，否则「接缓存」的目标值本身就是抄文档。
- 缺口：SoL-Pi 经济闸的**全部输入**是缓存读写量与比值（§3.3 公式）。当前我们既无缓存、又无计量 → 移植经济闸等于给一个恒零的变量做判定。
- 动作（两步，顺序不可倒）：
  1. **先接缓存**：Anthropic 侧给 `system` + `tools` 前缀打 `cache_control`（§7.6 验收 ④「压缩后 prompt cache 友好（摘要注入位置稳定）」正是为此准备的前置，`agent-plan.md:740`）；OpenAI/Gemini 侧无显式控制则只做计量。
  2. **再接计量**：`UsageEvent` 增量可选字段 `cacheReadInputTokens?` / `cacheWriteInputTokens?`（三处同步：接口 / `AgentEvent` 联合 / 无新 type 故 `KNOWN_TYPES` 不动）。
- 风险：**开缓存本身会涨价**（Anthropic 写 1.25×/读 0.1×）。这恰是经济闸存在的理由——但必须在靶场里证明净收益为正，否则「为移植判据而引入的成本」是我们自己的判卷纪律要红牌的对象。
- 阻塞：③。

### P3 — 靶场量不到投影侧的节省
- 现状：明卷 token = 冻结剧本字节的纯函数（`src/agent/gym/runner.ts:35-49,95`）；且 `runLoop` 的上下文来自 `projectContext(seen)`（`src/agent/loop.ts:79`），压缩/prune 挂在会话型 provider 的 `assemble()` 上（`src/agent/glm-session.ts:316-330`）——**靶场跑的 `runLoop` 路径上不经过压缩**。
- 缺口：四个机制一个都评不了。
- 动作：给 runner 加「装配采样」——每轮记录 `assemblyChars(history)`（`src/agent/compaction.ts:76` 已有此纯函数）+ 轮数，产出 `assemblyCharsTotal` / `turns`；A/B 比较用这两个数，不碰剧本。
- 阻塞：§1.3 全部指标、③④ 的去留判定。

### P4 — 无「进度边界」信号源
- 现状：`PlanProposal = {goal, files[PlanFileChange], approach?, verify?}`（`src/events/index.ts:53-58`），**无 per-step 状态**；SoL-Pi 靠模型调 `update_plan` 维护 `steps[{id,goal,status}]`，completed 跃迁即边界（`plan.ts:6-14,55-75`）。
- 缺口：③ 的触发候选点不存在。
- 动作：**不加模型侧 `update_plan` 工具**（见 §4 权衡 2），改为系统从既有事件派生边界（`plan_approved` + 写动作覆盖 plan.files + `verify_result(ok)` + 新 `user_message` 段起）。零新事件类型（§5.6「M1 只落事件…不新增事件类型」的口径）。
- 阻塞：③。

---

## 3. 四个机制的移植设计

> 统一约定：四个开关各一，**缺省全 false = 零行为**（对齐 `routingBandit` 先例）；设置页白名单 + 项目级 `.agent/config.json` 覆盖（先例：`loadVerifyConfig` 的 `verify.{lint,test}`，`src/agent/verify.ts:77-100`）。新增键必须进 `validateSettings` 白名单——漏加会**静默吞**（`docs/m5-proposal.md` §5.3 既有陷阱，须配反向断言）。

### 3.0 （随 P3）装配计量事件 `context_assembly`
```
{ type: "context_assembly"; turn: number; assemblyChars: number; estTokens: number;
  factor: number; pruneSavedTokens?: number; replacedIds?: number[]; ledgerHandles?: number; agent_id?: string }
```
- 增量类型（`KNOWN_TYPES` 扩集，旧日志重放逐字不变——照抄 M4a 三事件的兼容做法）。
- 不进模型上下文（`projectContext` 的白名单式跳过表已列此类协议事件，`src/agent/context.ts:91-97`）。
- 是 ①②③ 的共用观测面与靶场 A/B 的度量源。

### 3.1 ① Ledger：大观测留档 + 句柄 + 精确分页回取（新模块 `src/agent/ledger.ts`）

**语义**：任何超过阈值的工具结果，**第一次产出时就全量归档**，事件流里保留「head 窗口 + 句柄」；句柄可按字节/行精确回取。与 prune 的关系：prune 是**投影期**替换（事后、可逆、事件流不动），Ledger 是**写入期**留档（事前、给 prune 提供去处）——两级合起来才是完整的证据链，不互相替代。

**接口**
```ts
export const LEDGER_THRESHOLD_BYTES = 10 * 1024;          // 对齐 SoL-Pi observation.ts:13
export const RECALL_MAX_BYTES = 16 * 1024;                 // SoL-Pi observation-pack/index.ts:41
export const RECALL_MAX_LINES = 400;
export const FULL_SENDS = 2;                               // 前 2 次 provider 请求仍发全文（:15）
export function observeId(toolName: string, callId: string, contentHash: string): string; // "obs_"+sha256(...).hex.slice(0,24)
export async function archive(input: {dir: string; sessionId: string; text: string; ...}): Promise<{id, bytes, lines, path}>;
export async function recall(input: {dir: string; id: string; offset?: number; by: "bytes"|"lines"; max?: number}): Promise<{text, nextOffset?, eof}>;
```
- 句柄可校验：`/^obs_[a-f0-9]{24}$/u`，不匹配即报错（fail-closed），不猜。
- 内容寻址：`objects/<sha256(text)>.txt`；**同尺寸不同内容 → 记 error 且三次全返回原文**（fail-open，SoL-Pi `observation.ts` 设计决策，防「内容冲突当缓存命中」）。
- 读对象一律 `O_NOFOLLOW`；对象路径被换成 symlink → 回取 `rejects ELOOP`（宁可报错不读被换掉的对象）。
- 归档目录：**必须在会话数据目录内，绝不进用户仓库**（对齐 §6.4 缓存「不进用户仓库」纪律），由 `attachmentsDir` 单一来源提供（复用 P0 接线结果）。
- 回取工具 `obs_recall`：**新工具必须运行时注入**，静态注册表保持 9 工具（`src/tools/index.ts:16-26` 是 `Exclude<ToolName,"verify">` 映射类型 + `scripts/tools-check.ts:55` 断言 `names.length === 9`）——照 `remember` / `spawn_agent` 的 `installAppTools` 先例（`src/main/agent-runner.ts:540-576`）。
- 与脱敏的次序：**先脱敏后归档**（顺序不可倒，见 §5-R3）；归档副本与被投影文本共用同一份脱敏产物，保证「逐字一致」断言可判。

**验收（新增 `scripts/ledger-check.ts`，段 L）**
| 断言 | 内容 |
|---|---|
| L1 | >10KB 结果触发归档；≤10KB 不触发（反向） |
| L2 | 跨页回取拼接后与原档**逐字节相等**（含多字节字符不被切半，`nextOffset` 字节精确） |
| L3 | 未知/畸形 obs id → 拒绝（不猜） |
| L4 | 对象被换成 symlink → `ELOOP` 且错误可见（fail-closed 非静默） |
| L5 | 同尺寸不同内容冲突 → 原文返回 + error 记录（fail-open） |
| L6 | 前 `FULL_SENDS` 次请求全文可见，第 3 次起为句柄（反向：关掉开关则恒全文） |
| L7 | 归档文件全部落在会话目录内、无一路径出现在用户仓库（`git status` 干净） |
| L8 | 开关缺省 false 时，事件流与投影**逐字节不变**（A/B 对照跑） |

### 3.2 ② VerifiableEvidence：可验证收据纪律（新模块 `src/agent/evidence.ts`）

**语义**：把长诊断压成「收据」时，**每条引文必须逐字出现在归档原文里**，否则整单作废、保留原文。移植的是纪律，不是模型外呼（§1.4）。

**本地确定性实现**（零 LLM、零网络）
```ts
export const EVIDENCE_RECEIPT_PREFIX = "dsh_evidence_receipt_v1"; // 整行匹配，非子串（SoL-Pi observation.ts:28,80-82 同构）
export type EvidenceKind = "fatal" | "failure" | "warning" | "target" | "summary";
export interface EvidenceReceipt {
  status: "success" | "failure"; uncertain: boolean;
  sourceSha256: string; sourceBytes: number; sourceLines: number;
  evidence: { kind: EvidenceKind; line?: number; quote: string; quoteSha256: string }[];
}
export function buildReceipt(text: string, opt: {maxItems?: number; maxQuoteChars?: number}): EvidenceReceipt | null;
export function validateReceipt(r: EvidenceReceipt, source: string): {ok: true} | {ok: false; reason: string};
```
- 常量照抄 SoL-Pi 真值：`MAX_EVIDENCE_ITEMS = 12`、`MAX_QUOTE_CHARS = 600`、`FAILURE_SIGNAL`（`evidence-preserving-reducer/config.ts:12,14,15,28`）；本仓侧复用已有 `ERROR_LINE`（`src/agent/shape.ts:36`）并补中英失败词。
- 校验四态原因照抄：`schema-mismatch` / `unverifiable-quote` / `missing-failure-evidence` / `non_positive_saving`。**0 容忍**：任一条 quote 不在原文 → 整单作废。
- 强制闸：源里有失败信号而收据无任何 fatal/failure 条目 → `missing-failure-evidence`（防「把真失败压成干净摘要」——这是本机制最有价值的一条纪律）。
- 与既有整形的接缝：`classifyResult` / `shapeResult`（`src/agent/shape.ts:23,82`；摘要输入截断常量 `SUMMARY_INPUT_TRUNCATE = 2_000` :5）是**有损投影**——本机制给它的输出附上可校验的来源指纹，整形从「信任规则」升级为「可回溯规则」。摘要侧同批：`serializeConversation`（`src/agent/compaction.ts:349`）经 `summaryTruncate`（`shape.ts:96`）截 2k 处改为「截断 + 句柄」，配合 ①。
- 与 §7.3(d) 三闸并列成第四闸：空 / 膨胀 / 最小进度 / **引用不可回溯** → 拒绝压缩。
- 互斥纪律照抄：含收据前缀行的 tool_result **永不进 prune 替换集**（防用 excerpt 替换已验证证据，`observation.ts:80-82`）→ 在 `isPruneExempt`（`src/agent/prune.ts:102-139`）加一条判定。

**验收（并入 ledger-check 段 E 或独立 `evidence-check`，二选一，提案取并入）**
E1 每 quote 均逐字命中归档原文 / E2 一条虚构 quote → 整单作废且**原输出不变** / E3 有失败信号无失败条目 → `missing-failure-evidence` / E4 收据行不被 prune 替换（反向：去掉豁免必红）/ E5 确定性：同输入两次 buildReceipt 逐字节相同（无模型、无随机）。

### 3.3 ③ BoundaryCompact：进度边界 + 经济闸（新纯函数模块 `src/agent/economics.ts` + `compaction.ts` 三处小改）

**(a) 边界识别**（`deriveBoundaries(events, planState): number[]`，新，落在 `compaction.ts`）
- 输入全部来自既有事件，零新事件类型、零模型成本：
  1. `plan_approved`（callId 关联的 plan 冻结）→ 段起点候选；
  2. plan.files 中每个 `path` 已被对应写动作（`edit_file`/`write_file` 的 `tool_result(ok)`）覆盖 → 「文件级完成度」；
  3. `verify_result(ok=true)` → 强边界（已完成 + 已验证 = 最安全的压缩点，直接对齐 §5.4「完成声明不得先于新鲜证据」）；
  4. 新 `user_message` 段起 → 弱边界。
- 边界语义 = **允许 tailStart 吸附到最近的「已完成段末」**，且**禁止** tailStart 落在「有 in-progress 步骤未闭合」的区间内。
- 与既有纪律叠加：原子单元回退（`compaction.ts:257-277`）优先（吸附后仍须回退到单元起点）；keep_first 与 `excluded` 集不动。

**(b) 经济闸**（照抄 SoL-Pi 公式，`economics.ts` 纯函数 + 常量表）
```
savingTokens       = archiveTokens - memoTokens
incrCacheCostRatio = max(0, cacheWriteReadRatio - 1)             // economics.ts:151
breakevenRequests  = writeTokens * incrCacheCostRatio / savingTokens   // :152-155
combinedBreakeven  = (carriedDebtTokens + writeTokens*incrCacheCostRatio) / savingTokens  // :156-159
horizon            = 1 + floor(lowerBound × remainingBoundaries × scale)  // :96-97
                     lowerBound = mean - k·stddev（样本 <3 时 ×0.5）        // :83-94
                     再夹 (windowTokens - contextTokens) / avgIncrement     // :98-106
compact            = savingTokens > 0 && (windowProtection || economic)     // :196
windowProtection   = contextTokens >= windowTokens - windowReserveTokens    // :170-172
economic（首次）    = breakeven <= horizon × firstCompactionRequestScale     // :160-183
economic（其后）    = breakeven × subsequentCompactionMargin <= horizon
                     && combinedBreakeven <= horizon                        // :184-194
```
默认常量（照抄 `economics.ts:14-20`）：`windowReserveTokens = 16_384`、`firstCompactionRequestScale = 2`、`subsequentCompactionMargin = 1.5`、`remainingRequestScale = 1`、`remainingRequestStddevK = 0`；`cacheWriteReadRatio = 12.5` 作配置项（Anthropic 写/读价比）。`reason` 枚举九态照抄（`economic` / `window_protection` / `deferred_*` / `horizon_unavailable` / `cache_ratio_unavailable` / `non_positive_saving`）。
- **窗压必须能越过经济否决**（`compact = saving>0 && (windowProtection || economic)` 的这个 OR）：否则真爆窗时因不划算而拒压 = 生产事故。SoL-Pi 正是此形，测试 `online-context-compact-economics.test.ts:61` 钉住。
- 接入点：`shouldCompact`（`compaction.ts:100-105`）之后加一道 `economicGate`，**其 reason 进 `compaction` 事件的可审计面**——`CompactionEvent.reason` 现是 `"threshold"|"hard_buffer"|"user_request"` 窄联合（`src/events/index.ts:82`，声明体 `:79-94`），扩集需同步 `compactionCardPayload`（`compaction.ts:614`）与 **两处**渲染面：现行运行时 UI 的 `case 'compaction'` 只有一句 toast（`src/renderer/app.js:1870-1872`，`default:` 分支会静默吞掉任何新事件类型），富压缩卡在 React 树里（`src/renderer/cards/compaction-card.tsx`——按 `overview.md` 裁决，该树**不在当前运行时路径**）。⇒ 只改 .tsx 用户看不见；扩枚举必须同时改 `app.js`。**被否决也要留账**：新增轻量事件 `compaction_deferred {reason, breakevenRequests, expectedRemainingRequests}`（增量类型），否则「为什么没压」不可审计，违反 §3.1「不做静默压缩」的审计底线。

**验收（扩 `scripts/compaction-check.ts` 段 G）**
G1 边界吸附：有 `verify_result(ok)` 时 tailStart 落在其后、in-progress 段不被切 / G2 反向：无边界信号时行为与今天逐字节相同（开关关 = 零变更）/ G3 经济否决：低 horizon 不压且落 `compaction_deferred` / G4 窗压越过否决：`contextTokens ≥ window - 16384` 必压 / G5 `saving ≤ 0` → `non_positive_saving` / G6 carried debt 只在首压之后计 / G7 同 seed 同事件流 → 决策逐位确定（纯函数，靶场可重放）。

### 3.4 ④ FusedVerify：写后同轮 lint（`agent-runner` 侧最小接线）

**语义差异（关键）**：命令来自**项目配置** `.agent/config.json` 的 `verify.lint`（缺省探测 `package.json` scripts，`src/agent/verify.ts:77-113`），**不来自模型参数**。因此它天然落在 §5.4 的既有授权面上，权限层无新增出口——这正是与 SoL-Pi `then_run` 的根本区别（§4 权衡 1）。**接缝已核（本轮实测）**：`PlanProposal.verify?: { lint?, test? }`（`src/events/index.ts:57`）是 `agent-plan.md:467`「verify 配置随 plan 声明」的遗留面——`runVerifyOutcome` 只读 `loadVerifyConfig(repoDir)`（`src/agent/verify.ts:119-121`），**全文无任何地方消费 `plan.verify`** ⇒ 今天模型的命令字符串到不了 `exec`。④ 必须保住这条不变量（V6 反向断言）；若要启用 `plan.verify`，等同于在本仓自造一个 `then_run`，须另案走权限层，不得顺手接。

**落点**：不碰 `runLoop`（`loop.ts:202-232` 的 `events.append({type:"tool_result"})` 之前），而在 `gatedTool` 包装层（`src/main/agent-runner.ts:263-324`）：`write_file`/`edit_file` 的门与执行都在此处，`original.run()` 成功返回后、构造 `ToolResult` 前，跑 lint 并把输出并入 `output` 尾部。
- 复用 `verifyExec(sandbox)`（:977）→ 沙箱语义一致。
- 输出标记：`[fused_lint:succeeded]` / `[fused_lint:failed]` / `[fused_lint:skipped]`（照 SoL-Pi 三态标记 `then-run.ts:12-14`，语义换成本地 lint）。
- **不启用 `plan.verify`**（见上）：融合 lint 的命令源与 `verify` 门同源——只有 `loadVerifyConfig` 一条路，便于静态扫描断言。
- **内容守卫照抄**：写后双 `sha256` + `setImmediate` 让出一拍，不等则 `skipped`（`then-run.ts:54-68`）——与我们「等状态不等事件」的既有修法同源。
- 上限：`fusedLintAttempts` 独立计数，上限 3，**不计入** `verify` 的 `maxVerify`（两者语义不同：前者不通过不阻断、不触发 loop 停止；后者 `outcome.ok` 会让 loop 立即 `return`，`loop.ts:118`）。
- 失败**不得回滚已发生的写入**（SoL-Pi 的坑：edit 成功 + then_run 失败 → 整次调用 reject，上层若按 isError 回滚就错了）→ 融合块失败只置 `ok` 保持 true、在尾部标 failed，或整体 ok:false 但**明确注明文件已改**。提案取前者（写入已成功是事实，不粉饰也不撤销）。
- 不新增事件类型：结果进同一条 `tool_result`（§5.4「反射循环」的 reflected message 同通道）。
- 档位矩阵（§5.5）：只读档无写动作 → 天然不触发；默认档 lint 是只读动作不需审批；自主档耗尽不阻断。**worker 侧 `verify` 当前是禁用的**（`src/agent/orchestrator.ts:806` 注释「worker 侧 verify 是禁用的」）→ worker 是否开融合 lint 须单独拍板，提案默认 **不开**（留位，避免一次改动两处判定链）。
- 无人值守（`unattended`）：lint 无配置 → `skipped`（不猜命令），与 `verify: 未接线验证门（fail-closed）` 同口径。

**验收（扩 `scripts/gate-check.ts` 或 `autonomy-check` 段 V）**
V1 写成功 → 同轮 tool_result 含 `[fused_lint:*]`，且**模型轮次不增加**（step 计数不变）/ V2 写失败 → `skipped` 且命令执行次数为 0 / V3 写后文件被外部改动 → `skipped`（守卫）/ V4 lint 失败 → 写入不回滚（断言磁盘内容仍是新值）/ V5 无 verify 配置 → `skipped`，不发任何命令 / V6 命令文本永不来自模型参数（**静态扫描断言**：融合路径上的命令只能源自 `loadVerifyConfig`；配一条反向：把 config 换成模型可控来源必红）/ V7 沙箱：融合 lint 走 `verifyExec(sandbox)`（断言沙箱 profile 被应用，与直接 `defaultExec` 可区分）/ V8 开关缺省关 → 事件流逐字节不变。

---

## 4. 多路径权衡

| # | 选择 | ★ | 理由 |
|---|---|---|---|
| 1 | ④ 用**系统配置命令**（不引入模型自带 `then_run`） | ★★ | 照抄 SoL-Pi = 在 §5.1「门禁在权限层强制」的墙上开洞；收益（省 1 轮）相同，风险面差一个量级 |
| 2 | ③ 边界**从既有事件派生**，不加模型侧 `update_plan` 工具 | ★★ | 加了会撞四处冻结判据（`tools-check` 9 工具 / IPC 工具表 / e2e 剧本 / 压缩卡基线），且引入模型可信度依赖；派生方案零新事件、零轮次，唯一代价是「模型看不到边界面」——不需要它看见 |
| 3 | ① 留档在**写入期**（不只投影期） | ★ | 投影期替换（prune）无法找回已被 `collect()` 丢掉的字节；写入期才治本（P1） |
| 4 | ② 本地确定性收据，不外呼模型 | ★ | 外呼模型是它唯一真正贵的部分，纪律本身免费；且外呼与 §7.7 冲突 |
| 5 | 经济闸接在 `shouldCompact` **之后**而非替换它 | ★ | 双条件触发（比例 + 硬兜底）是 §7.3(a) 定稿，经济是第三道过滤，不改写前两道的语义 |
| 6 | 缓存（P2）与四机制**分开验收** | ★ | 缓存自身的净收益是独立变量；混在一起测出的数字无法归因，靶场 A/B 会假绿/假红 |

---

## 5. 风险点

- **R1 判卷面（最高）**：`scripts/frozen-sha256.json` 28 项冻结在 `fixtures/mock/**`、`fixtures/todo-app/tests/**`、`fixtures/gym/**`。任何「让模型多调一次工具/多一次 tool_call」的设计都会撞 e2e 与靶场剧本 → 本轮所有机制必须**不改变模型可见的工具调用序列**（④ 融合在工具包装层、①②③ 全在投影/组装侧）。① 若新增 `obs_recall` 工具，必须运行时注入（保 9 工具断言）。
- **R2 事件兼容三处同步**：新增 `context_assembly` / `compaction_deferred` 必须同步 ①接口 ②`AgentEvent` 联合 ③`KNOWN_TYPES`（`src/events/index.ts:375-402`），否则写侧抛「未知事件类型」（:477-479）；同时补 `projectContext` 跳过分支（`context.ts:91-97`）与 `sidechat` 只读投影 switch（`src/agent/sidechat.ts:112-127`）——**typecheck 会强制后者**（M5 A1 先例）。
- **R3 密钥脱敏与归档的顺序**：若「先归档原文、后脱敏投影」，则磁盘留档副本携带明文（§11.1 脱敏纪律在磁盘上失效）。**必须：脱敏先于归档**（一次脱敏，两份产物同源）。这条同时决定 L7 断言的口径。
- **R4 磁盘只增**：SoL-Pi 的归档明确「会话结束不自动删」（`README.md:122`）。我们桌面产品不能照抄（BYOK 场景下留档含用户代码片段）→ 提案给「随会话删除 + 会话目录保留期」，但**保留期策略另案**，本轮只保证不新增泄漏面（R3 + L7）。
- **R5 settings 白名单静默吞**：四个新键漏加 `validateSettings` → 永远读不到（`docs/m5-proposal.md` §5.3）。必配反向断言（照 `routing-check` B3b「白名单未吞」/B3c「非法回退」体例）。
- **R6 assertion-health 静态扫描**：新增 check 脚本里的 `check(x || true, ...)` / 恒真断言会被 AST 级扫描命中（`scripts/assertion-health.ts:8,18,28-45,68-105`），豁免必须写 `// gates:disjunction-ok <理由>`。
- **R7 门禁漂移**：新 `*-check` 脚本若不进 `scripts/gate-manifest.ts` 的 `GATES`，会被 `orphan-acceptance-script` 判红（`/check/i` 词根匹配，含扩展名变形）。
- **R8 UI 基线与可见面**：① `app.js` 的事件 switch 有 `default: /* 静默 */`（`src/renderer/app.js:1874-1876`）——**新事件类型不加分支 = 上不了屏**，「审计可见」的声称必须先改这里；② 渲染层 29 个文件有 sha256 基线（`scripts/ui-baseline-sha256.json`，含 `cards/compaction-card.tsx`）+ `panels-check` 截图门 → 改前先确认基线口径；③ **【2026-09-17 更正：此处已过时】** 原文写「React 树 vs `app.js` 的迁移仍在进行中」——**迁移已完成**：vanilla 渲染层已入库（提交 `e259113`，作用域限定 `src/renderer/`），React 树已不在运行时路径。原文保留以存史。本轮只加 `app.js` 分支，不碰 React 树，除非同时更新其 sha256。（另：本行引用的 `src/renderer/app.js:1874-1876` 等行号**已漂移**——`app.js` 现约 2360 行，行号只作定位线索、引用前须重新核对。）
- **R9 环境**：沙箱内跑不了 `pnpm test`（用 `node node_modules/vitest/vitest.mjs run --pool=threads`）；验收一律 `TERM=dumb`；沙箱三门走分支 A/B 须显式打印（不真空通过）。

---

## 6. 分期与工作量

| 期 | 内容 | 依赖 | 规模 |
|---|---|---|---|
| **P-1（最上游）** | 热路径接线三步：`createProvider` glm 分支换 `createGlmSessionProvider` + provider/model 进 settings + UI run 带 sessionId（§2-P-1）；新增 `tests/session-wiring.test.ts`（W1–W6） | — | S-M（主进程 1 处分支 + settings + 渲染层 1 行）|
| **P（前置）** | P0 接线 + BLOCKED 立案；P1 shell 全量归档；P2-2 cache 计量；P3 靶场装配采样；3.0 两个观测事件 | **P-1**（附件目录与历史生长依赖真会话日志） | M（5 文件 + 2 check 扩段）|
| **R1** | ① Ledger + `obs_recall`（运行时注入）；② VerifiableEvidence | P0/P1 | M |
| **R2** | ③ 边界派生 + 经济闸（`economics.ts` 纯函数 + compaction 三处小改 + 压缩卡扩集） | P2 缓存与计量、P4 | L（含 P2-1 开缓存，须单独验收） |
| **R3** | ④ FusedVerify | — （与 R1/R2 独立，可并行） | S |
| **留位** | worker 融合 lint、保留期回收、`update_plan` 显式界面、Probe 自检 | — | 不做 |

**每期内建靶场 A/B**：同一 case 开关两跑，`score` 降 → 该机制退回；`assemblyCharsTotal` 不降 → 该机制不采纳（不合并）。基线写出走 `scripts/gym-run.ts:87-103` 既有路径。

---

## 7. 一句话结论

SoL-Pi 的四个机制里，**三个是给我们已有规格补接线**（回取 / 写后 lint / 证据可回溯），**一个是真正的增量**（经济闸，且必须先补缓存计量才有输入）。**但先说一句不中听的：本仓的上下文管理链路（回灌 / prune / 压缩 / 记忆 / 地图）已经写完，却没有接在产品热路径上（§2-P-1）——所以本轮真正的风险不是「能不能移植 SoL-Pi」，而是「移植完的东西用户依然碰不到」。**它的方法论（auto-research 搜出的约束式效率、opt-in、判卷脚本背书）与我们 M5 反事实靶场同构——**移植的正确姿势不是照抄参数，而是把这四个机制当成靶场里的四个待判变体，用我们自己的数据决定开哪个。**

---

## 8. 附：既有事实表（本提案全部结论的证据源）

**本仓**（`/Users/ze/Downloads/deepseek harness`）

| 事实 | 锚点 |
|---|---|
| 生产 provider 工厂：glm 分支 = 单轮 + `tools=undefined` + memoized 生成器；缺省 = mock 剧本 | `src/main/agent-runner.ts:797-826`（:811 mock、:822 `streamGlm(…, undefined, call)`）|
| `runLoop` 每轮投影源 `seen` 只含本次 run 的事件（无跨 run 重放） | `src/agent/loop.ts:68,71-75,79` |
| 组装型 provider 的消费者仅验收侧；`src/main/**` 只取 `createGlmSummarizer` | `scripts/gate-check.ts:233`、`tests/compaction.test.ts:413`、`src/main/agent-runner.ts:15,192,447,1649` |
| `createGlmSessionProvider` 忽略入参 messages/tools、以日志为唯一事实源（自述契约） | `src/agent/glm-session.ts:285,316-327,350-355,418-420` |
| 非会话模式 run 开头 `rm` 日志；UI `api.run` 不传 sessionId | `src/main/agent-runner.ts:877,1099-1100`、`src/renderer/app.js:1954` |
| 定时任务支是唯一真传 sessionId 的调用方 | `src/main/agent-runner.ts:644-648` |
| BYOK 启动注入只写 `M0_API_KEY`；全仓无人写 `M0A_PROVIDER` ⇒ 打包后主对话走 mock | `src/main/provider-key-inject.ts:10-13`、grep（`src/`）|
| `providerInfo()` 仅按 `M0A_PROVIDER` 展示 provider/model（设置页同源） | `src/main/agent-runner.ts:1468-1473` |
| `gateToolSpecs(mode?)` = 组装 provider 的工具面来源 | `src/agent/glm-session.ts:30`、`scripts/gate-check.ts:233` |
| `ToolResult` = `{ok, output}`，无结构化 details 槽位；`ToolContext.emit` 可旁落事件 | `src/tools/base.ts:39-42,25-37` |
| shell 上限常量与「超限即丢块」 | `src/tools/run_shell.ts:5-6,21-31,39` |
| read 上限 50KB / 2000 行 / 行截 2000 字符 | `src/tools/read_file.ts:7-9,111-119` |
| `ToolName` 静态 10 名（含 verify）、注册表 9 工具 | `src/tools/base.ts:44-54`、`src/tools/index.ts:16-26`、`scripts/tools-check.ts:55` |
| turn 顺序：verify 门 → 白名单摘除 → PreToolUse → 权限门 → 执行 → PostToolUse → append | `src/agent/loop.ts:86-231`（关键：verify.ok → 立即 `return`，:118） |
| `gatedTool` 四层评估（deny→ask→档位→风险）+ scope 回写 + 无人值守 fail-closed | `src/main/agent-runner.ts:263-324` |
| 写工具运行时替换点（`installAppTools`）| `src/main/agent-runner.ts:540-576` |
| verify 配置源与探测 | `src/agent/verify.ts:77-113`；沙箱 exec 注入 `src/main/agent-runner.ts:977` |
| worker 侧 verify 禁用 | `src/agent/orchestrator.ts:806` |
| 压缩参数表（ratio 0.9 / tail 2k-15k / cap 4096 / tool 截 2000 / minProgress 0.1 / 连续失败 2）| `src/agent/compaction.ts:27-40` |
| 触发双条件 | `src/agent/compaction.ts:100-105` |
| `selectCut` 纯 tail 预算 + 原子单元二分吸附（无进度语义） | `src/agent/compaction.ts:243-292` |
| `assemble()` 是 prune/压缩的唯一调用面，但所在 provider 不在产品路径（见 §2-P-1）| `src/agent/glm-session.ts:316-327,356-425`；另一处 `src/main/agent-runner.ts:1017`（仅演示通道）|
| prune 参数（保护 40k / 最小 20k / 近 2 轮 / 免剪 skill,remember,memory + 卡片投影） | `src/agent/prune.ts:11-33,102-139` |
| 附件名清洗与回取路径 | `src/agent/prune.ts:132-139,201-223`（生产未传 `attachmentsDir`）|
| 类型化整形规则表（与 §6.2 同源） | `src/agent/shape.ts:5,23,36,82,96` |
| `projectContext` 替换槽位 + 协议事件跳过表 | `src/agent/context.ts:54-57,88-95,125-126` |
| 压缩事件体可见面：`case 'compaction'` 仅 toast，其余新类型走 `default:` 静默 | `src/renderer/app.js:1870-1876` |
| 渲染层 sha256 基线 29 项（含 `cards/compaction-card.tsx`；React 树不在运行时路径）| `scripts/ui-baseline-sha256.json`、`overview.md`「关键裁决」 |
| `CompactionEvent.reason` 三值窄联合 | `src/events/index.ts:82`（声明体 :79-94）|
| `replay` 读侧逐行容错 + 「id = 1-based 行号」跳行即错位契约 | `src/events/index.ts:540-546,546-606` |
| `UsageEvent` 仅 in/out（无 cache） | `src/events/index.ts:25` |
| Anthropic 适配器 usage 只有 in/out；cache 字段是否回传 = **未证**（fixture 驱动，无联网实测）| `src/providers/anthropic.ts:32,41,173,206-208,253`、`PROGRESS.md:420-429` |
| 全仓零 `cache_control` | grep 无命中（`src/`） |
| `KNOWN_TYPES` 26 项 + 写侧三类 payload 校验 + 读侧逐行容错 | `src/events/index.ts:375-402,477-491,546-606` |
| `PlanProposal` 无 per-step 状态；`verify?:{lint,test}` 字段存在但**无消费方**（模型命令到不了 exec）| `src/events/index.ts:53-58`、`src/agent/verify.ts:119-121` |
| opt-in 开关先例（缺省 false = 零行为）| `src/main/settings.ts:48,68,124,155`；反向断言 `scripts/routing-check.ts:184-195` |
| 靶场：fork@event + score + 基线回退线（成功率降 >2% / token 升 >5%）；明卷 token 是剧本纯函数 | `scripts/gym-run.ts:69-71,87-103,119-121`、`src/agent/gym/runner.ts:35-49,94-95` |
| 冻结判卷 28 项 | `scripts/frozen-sha256.json` |
| 门禁清单（道数以 `GATES` 现读为准，写死数字第二天就漂）＋ 漂移四违规 ＋ 恒真/析取体检 | `scripts/gate-manifest.ts`（`GATES`、`ACCEPTANCE_SHAPE`、`checkGateManifest`）、`scripts/assertion-health.ts` |
| 压缩卡 payload | `src/agent/compaction.ts:614`、`src/renderer/cards/compaction-card.tsx` |
| 规格授权面 | `agent-plan.md` §5.4:480-482（写后 lint）、§6.2:548-555（整形表）、§7.3-7.4:649-724（压缩/prune 定稿）、§7.7:744-753（不做清单） |

**SoL-Pi**（scratch clone，`src/sol-pi/**`）

| 事实 | 锚点 |
|---|---|
| 四机制全默认关、project 配置整体替换不 merge | `config.ts:27-45,47-59` |
| 观测阈值 10KB / 全文前 2 次发送 | `observation-pack/observation.ts:13,15,102` |
| 回取窗口 16KB · 400 行（减去 header 预留） | `observation-pack/index.ts:41-48` |
| obs id = `"obs_"+sha256(name\0callId\0hash).slice(0,24)`；`/^obs_[a-f0-9]{24}$/u` | `observation.ts:20,94-96,105-106` |
| `then_run` 由模型给、三态标记；无权限面（自述非权限边界） | `action-fusion/then-run.ts:12-14,106-121`、`SECURITY.md:3` |
| 双 sha256 内容守卫 + `setImmediate` | `then-run.ts:54-68` |
| 文件队列临界区覆盖「改 + 跑」（realpath 反推键） | `action-fusion/file-queue.ts:35-73` |
| 收据结构 / 四态校验（0 容忍逐字匹配） | `evidence-preserving-reducer/receipt.ts:20-31,82-145`（`unverifiable-quote` :121、`missing-failure-evidence` :141）、`config.ts:12,14,15,28` |
| 失败信号必带失败条目（防「真失败压成干净摘要」） | `receipt.ts:132-142` |
| 经济公式与默认常量 | `online-context-compact/economics.ts:14-20,149-196` |
| plan 三态步骤 + completed 跃迁即边界 | `online-context-compact/plan.ts:6-14,55-75`、`tools.ts:53-60` |
| 边界后 `turn_end` 决策 / `agent_settled` 执行 / barrier 续跑 | `occ/extension.ts:260,314`、`tests/online-context-compact.test.ts:92` |
| 含收据行永不 pack | `observation.ts:80-82` |
| ObservationPack / reducer 归档不随会话删除（OCC 状态随会话删） | `README.md:122`、`SECURITY.md:8-9,18` |
| Action Fusion 自述：可改文件 + 跑模型给的命令，且非权限边界 | `SECURITY.md:3,7` |
