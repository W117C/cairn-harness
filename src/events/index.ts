// 事件流：append-only JSONL，一事件一行。
import { mkdir, open, readFile, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
// 权限判定留痕的类型定义在权限层（判定归判定、序列化归序列化）；`import type` 编译期擦除，不引运行时依赖。
import type { AutoMeta, GateMeta } from "../permissions/autonomy";
// 「被收走的原因」的取值集合真身在 provider 协议层（三家词表在那儿解码），不在事件层自家再定义一份。
import type { TurnTruncation } from "../providers/stop-reason";
// 恢复卡载荷的真身 = 那份唯一映射的产出类型（同上：`import type` 编译期擦除，无反向运行时依赖）。
import type { RespawnArgs } from "../agent/recovery";

/** M2f：/promote 来源（sidechat 结论提升进主会话）。零新增事件类型——主流仍是 user_message，
 *  只多一个可选 origin 字段，重启后从 JSONL 重放无损（徽标由 origin 反向投影）。 */
export interface PromoteOrigin {
  kind: "sidechat";
  /** 来源 sidechat 会话 id（独立 JSONL 文件组的目录名）。 */
  session_id: string;
  /** 来源 sidechat 事件 id（1-based 行号，可跳回源消息）。 */
  source_event_ids: number[];
  note?: string;
}
/** §9.3 的用户侧 skill 触发：正文是某个 skill 渲染后的结果，`skill` 记下「是哪个、当时给了什么参数」，
 *  压缩后重挂按同一口径重放替换（与 origin 同思路：零新增事件类型，JSONL 重放无损）。 */
export interface SkillInvocationMeta { invoke: string; args: string }
/** goal 模式自动续跑的那一轮：走 `user_message` 的既有 origin 通道（M2f 先例：零新增事件类型，
 *  重放无损），这样「哪一轮是 agent 自己接着跑的」在流里就是可查的事实，UI 与事后审计都不用猜。 */
export interface GoalTurnOrigin {
  kind: "goal";
  /** 第几轮（1-based，指本轮）与上限：只作**展示**记账，续跑判定不信它（判定读 goal_set + 事件流）。 */
  turn: number;
  max_turns: number;
}
/** `user_message.origin` 的两种来源：sidechat 提升 / goal 自动续跑。消费端一律按 kind 分支，
 *  不许再无条件读 `.session_id`——那会把另一种来源在类型上假装成不存在。 */
export type UserMessageOrigin = PromoteOrigin | GoalTurnOrigin;
export interface UserMessageEvent { type: "user_message"; content: string; origin?: UserMessageOrigin; skill?: SkillInvocationMeta }
export interface AssistantMessageEvent { type: "assistant_message"; content: string }
/** 流式增量片段：callId 标识同一轮回复，text 为逐字追加的一小段。 */
export interface AssistantDeltaEvent { type: "assistant_delta"; callId: string; text: string }
/** 模型的**思考正文**（reasoning / thinking）增量。
 *
 *  与 assistant_delta 的区别：那段是"答给用户的话"，这段是"它自己怎么想的"。
 *  两者必须分开 —— 混进正文会让转录与重放变脏（思考块在多数家不可回传）。
 *  callId 与 assistant_delta 同源（同一次请求里的同一段输出），渲染层据此把思考挂在对应回答行前。
 *  2026-10-07 用户要求显示思考过程：以前适配器是**刻意忽略**推理增量的。 */
export interface ThinkingDeltaEvent { type: "thinking_delta"; callId: string; text: string }

/** M3a：worker 子流的工具调用（§4.4.9 落主流口径）——agent_id 在场 = 该事件属于该 worker 子流，
 *  主上下文投影（projectContext）跳过带 agent_id 的事件（父上下文唯一接收物 = agent_result，§4.4.4）。 */
export interface ToolCallEvent { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; agent_id?: string }
/** 执行前就被拦下的工具调用：哪道闸拦的（唯一事实源；下面六处出口共用，别各写一份字符串）。
 *  为什么不塞进 `gate: GateMeta`——这六道闸都不在档位机里，没有 layer/risk/mode 可言，
 *  编一个就会污染 `gate-outcomes` 的 layer×verdict 免批率（`GateMeta.mode` 那句「宁缺不编」是纪律不是注释）。
 *  为什么现在才落：这六处从前只有 `ok:false` ＋一句方括号开头的散文 ⇒ 「被哪道闸拦」与「旧日志」在事件流里
 *  同形（缺席三因），下游要归因只能回去匹配文案，而文案刚被证明是第二个注入面。
 *  与 `GATE_VERDICTS` 同形状（运行时数组）：复跑面按它铺矩阵，新增一挡而少配一处会被点名。 */
export const TOOL_BLOCK_REASONS = ["tool-table", "skill-denial", "verify-unwired", "hook", "permission", "unknown-tool"] as const;
export type ToolBlockReason = (typeof TOOL_BLOCK_REASONS)[number];
/** 编排侧「这一次扩张从未派发出 worker」的结构原因（唯一事实源，五处落点共用，别各写一份字符串）。
 *  为什么不并进 `blockedBy`：两列的读者问的是不同问题——那一列问「哪道闸拦下了一次工具调用」（主 loop 的
 *  六道执行前闸），这一列问「harness 自己按住了哪一次编排扩张」（成本闸／并发帽／取消／依赖链）。
 *  折成一列就再也不能单独读出「因钱不起 worker」与「因人手不起 worker」。
 *  为什么现在才落：这五处从前只有一句方括号开头的散文（`[budget]`／「并发已达上限」／「主会话已取消」），
 *  其中 `triggerDeferredSpawn` 还要**回去匹配**另一处写的文案才说得出原因——文案是第二个注入面，
 *  把自己的结论押在被度量者的嘴上（第 229 页：这一格改读结构列，散文由映射派生，两处不再各判一次）。 */
export const HARNESS_HOLD_REASONS = ["budget", "concurrency-limit", "cancelled", "dependency-failed", "chain-failed"] as const;
export type HarnessHoldReason = (typeof HARNESS_HOLD_REASONS)[number];
/** 结构原因 → 模型可见散文里那个 `reason=` 记号。刻意与枚举贴在同一处：新增一挡而漏配记号会直接编译不过
 *  （`Record<HarnessHoldReason, string>` 的穷尽性），不必等下游把 undefined 拼进正文。 */
export const HARNESS_HOLD_PROSE_TOKEN: Readonly<Record<HarnessHoldReason, string>> = {
  budget: "budget_exceeded",
  "concurrency-limit": "concurrency_limit",
  cancelled: "cancelled",
  "dependency-failed": "dependency_failed",
  "chain-failed": "chain_failed",
};
/** M1c 自动放行来源审计（§11.7.5）：仅自动放行的 tool_result 携带，零新事件类型。
 *  类型不自家再定义一份——它的真身在权限层，且由 `autoOf(gate)` 派生（两份同形定义迟早漂）。 */
export interface ToolResultEvent { type: "tool_result"; callId: string; ok: boolean; output: string; auto?: AutoMeta; /** 权限判定留痕：谁判的（layer）、怎么判的（verdict）、当时风险与档位 */ gate?: GateMeta; agent_id?: string; /** D7 覆盖前快照（§10.4）：被覆盖原件在 `.agent/snapshots/` 下的路径。
   *  缺席 = 这一笔没有原件可保（新建 / 空文件 / 快照失败）。增量字段，旧日志重放逐字不变。 */
  snapshotId?: string; /** 写工具的结构化变更类型；旧事件缺席时由投影显式标 unknown，不猜。 */
  change?: "created" | "modified"; /** 进程退出码（run_shell / worker shell / 沙箱出口才有）。
   *  **缺席 = 这一笔不是跑进程的工具**（或旧日志），绝不等于 0；`null` 才是"进程没起来/被强杀"。
   *  为什么现在才落：这两个字段一直活在 `ToolResult` 上，却在落盘面那一步被丢掉 ⇒
   *  任何下游读者（额度、按档升级、沉淀、评估失败轨迹）只能去匹配 `[exit code: 127]` 那句文案，
   *  而文案面刚被证明是不可靠判据（judgment-layer §9.1）。 */
  exitCode?: number | null; /** 是否因墙钟上限被强杀（与退出码分开的两态：超时后 code 常为 null）。 */
  timedOut?: boolean; /** 未执行的原因（见 `TOOL_BLOCK_REASONS`）。**缺席 = 这一笔走到了执行面**（或旧日志），
   *  与 `exitCode` 的「缺席 ≠ 0」同一口径：这一格宁可没有，不许编。 */
  blockedBy?: ToolBlockReason; /** 编排按住了这一次扩张（见 `HARNESS_HOLD_REASONS`）。**缺席 = 没人按住**
   *  （已派发出 worker，或结局来自 worker 自己）；与 `ok:false` 刻意不同款：worker 跑挂的回执也是 ok:false，
   *  那一格没有 hold——「失败」与「压根没起」在两列里必须长得不一样。 */
  hold?: HarnessHoldReason }
export interface UsageEvent { type: "usage"; inputTokens: number; outputTokens: number; /** 缓存分列（可选）：**缺字段 = 该 provider 没上报，不等于 0**。约定 `inputTokens` 是含缓存的总输入，
   *  下面两个是其中的分块——不得再与 inputTokens 相加（metering 的 MeterUsage 要互斥桶，适配器换算后再交）。
   *  写侧断点（Anthropic cache_control / 稳定前缀排布）尚未接线：先把「命中没有」测出来，再谈制造命中。 */
  cacheReadInputTokens?: number; cacheWriteInputTokens?: number; /** M3a §4.4.10：usage 按 agent 归因（主 loop usage 无此字段）。 */ agent_id?: string; /** 产生这笔用量的模型名（provider 名或档位 id 两态都收，价表键由 `priceForModel` 反查）。
   *  **缺字段 = 这一笔定不了价**（旧日志、剧本/demo 通道、worker 没在流里留过档）⇒ 消费方按「价格不可知」记，
   *  绝不折成 $0（评估面的 `$ / 成功任务` 一直报不可测，缺的就是这一列，见 2026-09-27 第 148 页）。
   *  写侧只有一个盖章点：会话落盘的漏斗 `runAgent` 的 pipeline（主会话与 worker 子流都过它）。 */
  model?: string }
/** 会话元信息：分支会话首行携带 branch_of 指向原会话；
 *  M2f：sidechat 会话首行携带 kind="sidechat" + parent_session_id 指向主会话；
 *  M4a：定时任务触发的新会话首行携带 origin="scheduled" + automation_id/automation_name（§12.2.2）。 */
export interface SessionMetaEvent {
  type: "session_meta";
  branch_of?: string;
  kind?: "sidechat";
  parent_session_id?: string;
  origin?: "scheduled";
  automation_id?: string;
  automation_name?: string;
}

// ---- M1b 三门事件（澄清门 / 方案门 / 验证门）----
/** 澄清问题：question 必填；options 给定时渲染选项（2–4 个），缺省为自由补充输入。 */
export interface ClarifyQuestion {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}
/** 表单提交值：key = 问题原文，value = 选中项（单选 string / 多选 string[]）或自由补充文本。 */
export type ClarifyAnswerMap = Record<string, string | string[]>;
/** 澄清门：模型发起澄清，等人填表（callId = 原工具调用 id，tool_result 挂回同一 id）。 */
export interface ClarifyRequestedEvent { type: "clarify_requested"; callId: string; questions: ClarifyQuestion[] }

export interface PlanFileChange { path: string; action: "create" | "edit" | "delete"; summary: string }
export interface PlanProposal {
  goal: string;
  files: PlanFileChange[];
  approach?: string;
  verify?: { lint?: string[]; test?: string[] };
}
/** 方案门：模型提交计划，等人批准；批准前写工具在权限层被拒。 */
export interface PlanProposedEvent { type: "plan_proposed"; callId: string; plan: PlanProposal }
/** 方案决议（批准 / 拒绝），落日志供 plan 卡显示状态。 */
export interface PlanApprovedEvent { type: "plan_approved"; callId: string; approved: boolean }

/**
 * verify 红的**归因**（judgment-layer §9.1 定案五值 + 2026-09-23 实测补的 `pkg-manager`）。
 * 缺省（字段缺席）= `"code"` ⇒ 老会话流与本仓所有未改动的调用点行为逐字不变。
 *
 * 每格都挂在一个**已有判定**上，不引入文案匹配器：
 * `timeout`=`timedOut` 布尔、`toolchain-missing`=退出码 127 或 shell 自身起不来、
 * `no-surface`=`(none)` 哨兵命令、`hook-error`=钩子抛错那条 catch、`pkg-manager`=包管理器
 * 在自己那行打出的命名空间错误码（唯一被观测到的环境红类，见 outputs/verify-cause-denominator-2026-09-23.md）、
 * `not-run`=**进程没有退出码**（`timedOut:false` 而 `exitCode:null`：会话取消、或被信号杀掉）——第 219 页 #42 的普查把它从缺省 `code` 里分了出来、
 * `skipped`=`VerifyOutcome.skipped` 非空（信任闸拒了这批仓库自带的命令，`results` 因此是空的）——与 `not-run` 同一族的孪生：
 * 那一拍**一条命令都没执行**，却被记成「跑了且红」，于是白烧一次修复额度、驱动一次返修、把 goal 证据钉死在 `failed`。
 * 它必须与 `no-surface` 分开：那格说的是「压根没有可验面」（人去配一条），这一格说的是「有面但没授权」（人去授权，
 * 或模型自己走 run_shell 那条有审批与威胁表的路）。合成一格就丢掉了下一步该做什么。
 */
export type VerifyCause =
  | "code"
  | "timeout"
  | "toolchain-missing"
  | "no-surface"
  | "hook-error"
  | "pkg-manager"
  | "not-run"
  | "skipped";

/** 环境成因集：这几类红**不是模型的代码错了**，不得记在模型账上（不烧修复额度 / 不喂升档与 bandit / 不进沉淀）。
 *  `not-run` 名字叫 ENV 却在这里：三处消费者要的那句语义是「别照它改代码」，不是"是环境问题"——
 *  取消与被信号杀同样**没有一次真实的执行结果**可归因给模型（第 219 页第 3 条现读）。
 *  `skipped` 同理进表：被拒的那一拍没有执行过任何东西，它对代码对错的证明力与一条没跑完的命令完全相等＝零。 */
const ENV_VERIFY_CAUSE_SET: ReadonlySet<VerifyCause> = new Set<VerifyCause>([
  "timeout", "toolchain-missing", "no-surface", "hook-error", "pkg-manager", "not-run", "skipped",
]);

/** 唯一谓词（三个出口共用一只，别各写一份 `=== "timeout" || …` 的表）：缺席 = 未归因 = 按 code 算。 */
export function isEnvVerifyCause(cause: VerifyCause | undefined): boolean {
  return cause !== undefined && ENV_VERIFY_CAUSE_SET.has(cause);
}

export interface VerifyCommandResult {
  command: string;
  ok: boolean;
  output: string;
  /** 缺省 = `"code"`（零行为）。仅在 `ok:false` 时有意义。 */
  cause?: VerifyCause;
  /** 进程退出码；被超时强杀或根本没起来时为 null。落盘是为了让"127"这类判定不再只活在文案里。 */
  exitCode?: number | null;
}
/** 验证门：一次 lint/test 执行结果。attempt 从 1 起；失败时错误输出经 tool_result 注入同轮继续修。 */
export interface VerifyResultEvent {
  type: "verify_result";
  callId: string;
  /** 缺省（false/缺席）= 模型自调 verify；true = harness 在收束前补的自动验证拍
   *  （能力 5「写过盘必须有证据」）。审计与时间线靠它区分归属，不冒充模型行为。 */
  auto?: boolean;
  ok: boolean;
  attempt: number;
  maxAttempts: number;
  results: VerifyCommandResult[];
  /** 这一拍的归因（取首个失败命令的 cause；钩子抛错时 = `hook-error`）。
   *  三处出口（attempt 计数 / 级联升档与 bandit / 沉淀）据此决定"这次红算谁的"。 */
  cause?: VerifyCause;
  /** M3a §4.4.10 同口径：worker 子流的验证证据带此字段（withAgentId 归因）。
   *  缺省 = 主会话侧。此前 verify_result 拿不到归因，于是「worker 验过了」在主流里
   *  看起来就是「父会话验过了」——三处下游（上下文红回流 / 父验证计量 / 假完成率分母）都被它骗过。 */
  agent_id?: string;
}

// ---- M1d 压缩事件（§7.2 事件契约：摘除 id 集 + offset 注入，投影语义零删改）----
/** 压缩发生记录：trigger=auto（比例阈值）/ manual（/compact）/ overflow（硬兜底紧急截断）。
 *  usage 缺省 = 摘要器无 API 用量（mock/紧急截断不伪造）；model 缺省 = 会话同模型。 */
export interface CompactionUsage { inputTokens: number; outputTokens: number }
export interface CompactionEvent {
  type: "compaction";
  trigger: "auto" | "manual" | "overflow";
  reason: "threshold" | "hard_buffer" | "user_request";
  /** 被摘除事件的 id（1-based 行号）；永不含 compaction 事件本体（摘要不二次被压）。 */
  compressed_event_ids: number[];
  summary: string;
  /** 注入位置：投影在该 id 的事件之前插一条 user 角色摘要消息（fresh start）。 */
  summary_offset: number;
  tokens_before: number;
  tokens_after: number;
  usage?: CompactionUsage;
  model?: string;
  /** M3c：worker 归因（§7.5 worker 压缩事件落子流；主会话压缩无此字段）。 */
  agent_id?: string;
}

// ---- M2f 产出代码安全 report（§11.6 定稿，本轮只做 off/report）----
// 静态快筛（零 token、本地）：从事件流写动作重建变更集 → 密钥扫描（熵 + 已知模式）+ 危险 API 六类规则。
// findings 走严格 schema；被审内容是数据不是指令；报告进事件流前过输出扫描（密钥脱敏）。
export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type SecurityConfidence = "low" | "medium" | "high";
/** 危险 API 六类 + 密钥类（密钥非「危险 API」，单列以便验收计数）+ M3b LLM 审查类。 */
export type SecurityCategory =
  | "secret"
  | "eval"
  | "deserialization"
  | "weak_random"
  | "command_injection"
  | "sql_injection"
  | "path_traversal"
  | "llm_review";

export interface SecurityFinding {
  /** 规则 id（稳定可审计；M3b LLM findings 用 llm.<序号>）。 */
  ruleId: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  /** 命中文件（workspace 相对）。 */
  path: string;
  /** 行号（1-based，落在变更集内；M3b write worker 路径 = 相对最终文件的绝对行号，§11.6/M2f 裁决 6）。 */
  line: number;
  title: string;
  description: string;
  /** 把握度。**静态快筛必带**（那是规则作者写的标注）；LLM 段只带模型真自报的合法值 ⇒
   *  **缺席 = 没自报**，不等于"medium"（旧代码会把缺席编成 medium，见 `llm-review.ts`）。 */
  confidence?: SecurityConfidence;
  /** M3b：修复建议（LLM 两段流水产出；静态快筛缺省）。 */
  suggestion?: string;
}

/** 变更集条目（从事件流写动作重建：write_file 的 content / edit_file 的 new_string）。
 *  lines = 新增内容的行；findings 行号一律相对本条目（1-based）。 */
export interface SecurityChangeRef {
  path: string;
  op: "write" | "edit";
  lines: number;
}

export interface SecurityReportEvent {
  type: "security_report";
  /** M2f 主会话验证门后 report；M3b write worker diff 快照（mode=gate 供合并卡红标判定，report 只标不拦）。 */
  mode: "report" | "gate";
  findings: SecurityFinding[];
  changeSet: SecurityChangeRef[];
  summary: { total: number; bySeverity: Record<SecuritySeverity, number>; byCategory: Record<string, number> };
  /** 扫描时间（ISO 串；缺省 = 未标注）。 */
  scannedAt?: string;
  /** M3b：write worker 归因（面板合并卡按 agent 取最新一份报告）。 */
  agent_id?: string;
  /** M3b：LLM 第二段是否执行（false/缺省 = 静态快筛 only 或 off）。 */
  llm_reviewed?: boolean;
}

// ---- M7 影响面（impact）：写文件后的跨文件波及报告（见 src/agent/impact）----
export interface ImpactReportEvent {
  type: "impact_report";
  file: string;
  symbols: string[];
  /** 跨文件调用点（谁调用了我，向上波及）；空数组 = 波及半径 0。 */
  up: { symbol: string; file: string; line: number }[];
  truncated: boolean;
}

// ---- M3a 多 agent 编排（§3.4 / §4.4）：agent 子流事件 + 审批事件协议 ----
// 子流纪律（§4.4.9 / 任务书裁决 1）：worker 事件落主会话 JSONL——agent_* 事件 + 该 worker 的
// tool_call/tool_result/usage 均带 agent_id；agent_spawned 携 parent_event_id（spawn tool_call 的
// 1-based 事件 id）建立血缘树。心跳 = 子流 tool_call/tool_result 天然时间戳，不造独立心跳事件。

/** spawn_agent 的 mode（§4.1）：M3a 只接入 read；write/pipeline spawn 即拒绝（M3b）；M5c supervise（受限自适应循环）。 */
export type AgentMode = "read" | "write" | "pipeline" | "supervise";
/** worker 状态机五态 + cancelled（§4.4.8）。 */
export type AgentStatus = "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "cancelled";
/** 权限档（与 src/permissions 的 PermissionMode 同字面量；events 层零依赖不自引）。
 *  导出**运行时元组**是为了让"两份抄本必须同集"这件事可判卷
 *  （见 `tests/permission-mode-single-source.test.ts`；抄本不可见 = 加一档时只有一份会改）。 */
export const AGENT_PERMISSION_MODES = ["read-only", "default", "guided", "auto"] as const;
export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number];

export interface AgentSpawnedEvent {
  type: "agent_spawned";
  agent_id: string;
  /** 血缘：主流里 spawn_agent tool_call 的事件 id（1-based 行号）。 */
  parent_event_id: number;
  mode: AgentMode;
  task: string;
  /**
   * 已解析的角色名（sequencer 逐环注入，或模型在 `spawn_agent` 上点名）。
   * **缺席 = 没带角色面**，不是"默认角色"——恢复重建时不许替它编一个（`handle.agentType` 同源）。
   * 落这条之前，角色只活在内存里的 `handle.agentType`：崩溃恢复从事件流重建 ⇒ 角色丢，
   * 面板/审计也读不到"这个 worker 当时是按哪张角色面跑的"。
   */
  role?: string;
  /** 写租约声明（M3a 仅解析存档，租约求交与警告 M3b 落地）。 */
  resources?: string[];
  /** 依赖链（M3a 仅解析存档，事件驱动链接 M3c）。 */
  depends_on?: string[];
  /** M3b write mode：worktree 主 checkout 根相对路径（.agents/wt-<agent_id>）。 */
  worktree?: string;
  /** M3b write mode：spawn 时主 checkout HEAD（diff 与合并的对比基线）。 */
  base_commit?: string;
  model?: string;
  /** 那一次派活**真拨的模型名**（价表的反查键），仅在真拨号时落；剧本 / demo 通道缺省。
   *  为什么不复用上一条：`model` 记的是「派工时申报 / 路由选中的档位 id」，而这一跳实际拨了哪一档
   *  由 `modelFor` 与路由共同决定，两者可以不同（无路由时 `model` 干脆缺席）。把归因挂在申报档位上
   *  ＝回到 2026-09-27 刚修掉的那个形状：按申报档折钱、按真拨档花钱。
   *  取值与 worker 的价格标签同一个式子（`orchestrator` 的 `routedSpec?.model ?? glmDefaultModelName()`）。 */
  usage_model?: string;
  max_turns: number;
  /** worker 有效权限档（§11.7.6 单调继承：worker ≤ 父，越界裁到父档）。 */
  permission_mode: AgentPermissionMode;
  /** 越界请求的原档（未越界 = 缺省）。 */
  permission_mode_requested?: AgentPermissionMode;
  /** 越界裁剪警告（审批卡必显）。 */
  tier_warning?: string;
  /** 派生时间戳（Date.now 毫秒；面板「时长」的起算点，纯事件投影）。 */
  ts?: number;
}

export interface AgentStatusEvent {
  type: "agent_status";
  agent_id: string;
  status: AgentStatus;
  /** failed 的分型原因（max_turns / interrupted / 异常摘要）；cancelled 可带发起方注记。 */
  reason?: string;
  /** 终态时间戳（时长投影用；非终态缺省）。 */
  ts?: number;
}

export interface AgentMessageEvent {
  type: "agent_message";
  agent_id: string;
  kind: "progress" | "report";
  text: string;
}

/** W4b 四态：worker 回程那句「跑过了」到底有没有凭据（判据见 AgentResultEvent.artifacts.verified）。 */
export type WorkerEvidence = "verified" | "failed" | "stale" | "absent";

/** 终态回传（§4.4.4）：父上下文唯一接收物。错误永不冒充结果——failed 走 status/reason 分型。 */
export interface AgentResultEvent {
  type: "agent_result";
  agent_id: string;
  status: "done" | "failed";
  reason?: string;
  /** ≤2000 token，超限类型化裁剪（summary_truncated = true + 尾部截断提示）。 */
  summary: string;
  summary_truncated?: boolean;
  artifacts: {
    report?: string;
    files_changed?: string[];
    /** M3b write mode：diff 出处引用（worktree 路径@base_commit）；diff 本体只进 git 面板（§4.4.4）。 */
    diff_ref?: string;
    /** M3c 崩溃恢复（§4.4.9）：reason=interrupted 时携带原 spawn 参数（恢复卡「重派」的数据源）。
     *  类型即那份唯一映射的产出：这里曾另写一份内联字面量，于是面板载荷与它各长各的（`role` 落地时
     *  内联那份不会红，只会静默少一位）。 */
    respawn?: RespawnArgs;
    /** W4b：worker「代码能跑」这句话有没有机器凭据（只在本次真改过文件时出现）。
     *  纯投影自 worker 自己的子流（`workerVerificationEvidence`），不是第二份状态：
     *  verified = 最后一次成功写盘之后有绿的 verify 拍；failed = 最后拍是红的；
     *  stale = 验过但之后又写了盘（证据已过期，不得当证据用）；absent = 全程没有任何验证拍。
     *  在此之前 artifacts 只有 report（= 模型的散文自述），父会话与合并控制塔都无法区分「验过」与「说验过」。 */
    verified?: WorkerEvidence;
    /** W3②「价格标签」：本 worker 的表价花费（USD，按 routing/pricing 档位表折算）。
     *  **缺席 = 价格不可知**（冻结剧本回放 / 模型名反查不到档位），不当 0——把不可知记成免费
     *  就是"这轮没花钱"的假证据。worker usage 不分列缓存块 ⇒ 这是**上界**。
     *  与 `verified` 合起来才是「这份交付花了多少钱、有没有跑过测试」的机器可读账。 */
    spent_usd?: number;
    /** 该档位的输入/输出单价是否当日在厂商官方页读到过（false = 占位数，只可横向比较）。 */
    price_calibrated?: boolean;
  };
  usage: { inputTokens: number; outputTokens: number };
  tool_stats: Record<string, number>;
}

// ---- 审批事件协议（§4.4.3 与 turn 解耦）：请求（落流）与等待（订阅 approval_resolved by id）两段 ----
export interface ApprovalRequestedEvent {
  type: "approval_requested";
  id: string;
  /** 发起 worker 的归因（主会话审批不落此事件，走 IPC AskGate 通道）。 */
  agent_id?: string;
  tool: string;
  /** 参数摘要（digest，不落全量 args——审批卡必显的最小面）。 */
  args_digest: string;
  risk: string;
  risk_reasons?: string[];
  /** 越界裁剪警告透传（审批卡必显）。 */
  tier_warning?: string;
}

export interface ApprovalResolvedEvent {
  type: "approval_resolved";
  id: string;
  agent_id?: string;
  decision: "approved" | "rejected";
  scope: "once" | "session_kind" | "always";
  /** 决议注记（含 always 拒发等拒绝理由）。 */
  reason?: string;
}

/** 卡片回写协议（§10.3）：卡片动作的唯一事件形态。target_agent_id = 多 agent 归因。 */
export interface CardActionEvent {
  type: "card_action";
  card_id: string;
  source_event_id: number;
  card_type: string;
  action: string;
  payload?: Record<string, unknown>;
  scope?: "once" | "session_kind" | "always";
  target_agent_id?: string;
}

/** M3b 评审闭环（§3.4 / §4.5）：diff 卡行级评论 → 定向 user_message 注入该 worker 子流 → 修正 → diff 卡 v2。
 *  评论回传不挂 turn、走事件流协议（与 card_action 同族）。 */
export interface DiffCommentEvent {
  type: "diff_comment";
  agent_id: string;
  /** 评论落点文件（workspace 相对）。 */
  path: string;
  /** 行号（1-based，diff 卡行级定位）。 */
  line: number;
  body: string;
  ts?: number;
}

// ---- M5a 路由决策（§m5-proposal 步骤 1）：结果信号回流的策略层落点 ----
// 可审计面：不止记结果，还记「当时有哪些候选」。事件里绝不出现 key / 凭据，只记 model id。
export interface RoutingDecisionEvent {
  type: "routing_decision";
  /** worker 归因（主会话路由缺省 = 主 loop）。 */
  agent_id?: string;
  /** 环角色（implement/review/test/自定义 plugin 角色名）。 */
  stage?: string;
  /** 候选档位（决策的可审计面：不是只记结果，要记"当时有哪些选择"）。 */
  candidates: { id: string; tier: string }[];
  picked: string;
  /** pinned（显式指定）/ tier-default（档位表）/ bandit（学习）/ cascade-upgrade（级联升级）/ fallback（降级）。 */
  reason: "pinned" | "tier-default" | "bandit" | "cascade-upgrade" | "fallback";
  /** 级联升级的来源档位（reason=cascade-upgrade 时必填）。 */
  from?: string;
  ts?: number;
}

// ---- M4a 定时任务三事件（§12.2.7）：journal 即调度事件流，面板订阅投影 ----
// 全部为增量类型（KNOWN_TYPES 扩集），旧日志重放逐字不变。
export interface AutomationTriggeredEvent {
  type: "automation_triggered";
  automation_id: string;
  task_name: string;
  occurrence_key: string;
  due_at: string;
  session_id?: string;
  /** 启动补跑（catchUp=latest）标记。 */
  catchup?: boolean;
  ts?: number;
}

export interface AutomationSkippedEvent {
  type: "automation_skipped";
  automation_id: string;
  task_name: string;
  occurrence_key: string;
  due_at: string;
  /** too-old=过期 / catch-up-skip=休眠 / overlap=重叠 / concurrency-cap=并发满（SKIP_REASON_LABELS）。 */
  reason: string;
  ts?: number;
}

/** 终态回写（§12.2.4 完成回写）：落定时会话日志（终态记录）+ 主时间线（完成卡，复用 report 卡类型）。 */
export interface AutomationCompletedEvent {
  type: "automation_completed";
  automation_id: string;
  task_name: string;
  occurrence_key: string;
  session_id: string;
  status: "succeeded" | "failed";
  reason?: string;
  /** summarizeRun 纯投影摘要（零新 LLM 调用）。 */
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
  tool_stats: Record<string, number>;
  ts?: number;
}

// ---- P0 错误即事件：模型/网络失败此前只活在进程里，事件流与 UI 一律看不见 ----
/** 一次 run 的失败事实。loop 在模型流边界落此事件后把原错误继续上抛，
 *  调用方语义逐字不变（仍是 reject）；增量类型，旧日志重放不受影响。 */
export interface RunErrorEvent {
  type: "error";
  /** 失败原因原文（provider / 网络 / 额度 / 解析）。渲染侧负责转义。 */
  message: string;
  /** 失败所在轮次（0-based）。 */
  step?: number;
  session_id?: string;
  ts?: number;
}

/** goal 模式（用户设定会话级目标 + 预算）的唯一落流事实：一条 `goal_set` = 一次设定/改设。
 *  轮次、已花、停止原因一律从这条之后的事件重算，不写第二份会话态。增量类型，旧日志重放逐字不变。 */
export interface GoalSetEvent {
  type: "goal_set";
  objective: string;
  max_turns: number;
  /** 美元上限；0 = 美元闸关（只按轮次闸停）。 */
  max_usd: number;
  /** 这条是**模型自己**改设的措辞。缺席 = 人设（含全部旧日志，重放逐字不变）⇒ 整键缺席，不写空串顶位。
   *  投影层据此拒绝把窗口锚点挪到它上面：改措辞不等于加额度，也不等于把上一段的绿证据作废。 */
  set_by?: "model";
  session_id?: string;
  ts?: number;
}

/** goal 模式停下来的事实（为什么不续了）：没有这条，UI 与用户只能看到"跑了 N 轮就没了"。 */
export interface GoalStoppedEvent {
  type: "goal_stopped";
  /** 停止理由原文（来自 goalStopDecision，含证据态/预算读数）。 */
  reason: string;
  /** 停在哪一轮。 */
  turn: number;
  /** 当时的验证证据态（审计口径与 worker 四态同源）。 */
  evidence: WorkerEvidence;
  session_id?: string;
  ts?: number;
}

/** 用户把目标**挂起**的事实（≠ 停止）：自动续跑当场停手，但目标仍武装、窗口/轮次/证据全留，
 *  恢复后从原样接着跑。与 `goal_stopped` 分开是因为「停过的目标不许被下一条消息复活」是终态语义，
 *  而挂起要能复活——混用一条事件会让「暂停」要么退化成「清除」，要么把停止的终态闸打漏。 */
export interface GoalPausedEvent {
  type: "goal_paused";
  /** 挂起理由原文（当前唯一来源：用户在目标面板点「暂停」）。 */
  reason: string;
  /** 挂起时已发生的轮数（与 `goal_stopped.turn` 同口径，只作展示记账）。 */
  turn: number;
  session_id?: string;
  ts?: number;
}

/** 用户把挂起的目标**恢复**的事实：只清挂起位，**不新建目标、不重置窗口**——
 *  轮次/证据/花费仍量同一条 `goal_set` 之后那一段（恢复不是改设，不该把已完成的工作作废）。 */
export interface GoalResumedEvent {
  type: "goal_resumed";
  /** 恢复时已发生的轮数（展示记账）。 */
  turn: number;
  session_id?: string;
  ts?: number;
}

/** 一轮模型输出**没说完就被收走**的证据（§3.3）：只在非正常收尾时落——答完的轮零新事件，
 *  既有转录与冻结判卷逐字不变。缺了这条，被 max_tokens 砍断的一轮与答完的一轮在流里长得
 *  一模一样，而 loop 判结束只看「有没有 tool_call」，于是截断被记账成成功（返工的源头）。
 *  只落机器可读 token，界面文案由渲染层投影（与 #48 同口径）。 */
export interface TurnTruncatedEvent {
  type: "turn_truncated";
  /** 哪一轮（与 assistant_delta 的 callId 同源，可指回被砍断的那段正文）。 */
  callId: string;
  outcome: TurnTruncation;
  /** provider 原生停止原因原文（end_turn/max_tokens/length/MAX_TOKENS/refusal/…）。 */
  stop_reason: string;
  /** 当时已用掉多少输出 token：判断「8192 的输出预留够不够」的唯一读数来源。缺 = provider 没上报。 */
  output_tokens?: number;
  /** M3a §4.4.10：worker 子流的轮归因（主 loop 无此字段）。 */
  agent_id?: string;
}

/** P0（2026-10-03）：每轮模型面装配账，**观测 only**——只记 `planSurfaceBudget` 已经算出来的
 *  那份账，不参与任何判定、不进模型上下文（见 `context.ts` 的忽略名单与 `sidechat.ts` 的
 *  `return null` 分组）。
 *
 *  存在理由：这份账此前每请求都算、算完即丢——于是「真实面多大、有没有触发降配梯、省了谁」
 *  在整个工程里没有任何一处可回放，属本仓点名的「事件流外私有状态 = 设计错误」缺陷族。
 *
 *  **两个基必须分开读**（技术评审 F6）：`declared*` 是 `planSurfaceBudget` 的**入参**那一份
 *  （`account` 在降配**之前**算，见 `model-surface.ts` 的 `planSurfaceBudget`），`sent*` 才是真正
 *  发出去的。未降配时两者相等，降配时 `declared > sent`。混读会把送出面读成声明面——而 24k 帽下
 *  送出面恒 ≤ 约 6.7k token，这会直接读反「有没有越过 10k token 触发线」这个结论。
 *
 *  工具名（`shortened` / `dropped`）按标识符对待、**不脱敏**（登记在 `PROSE_FREE_TYPES`）：与
 *  `tool_call.name` 同一口径（`SCANNED_TEXT_PATHS.tool_call` 只声明 `["args"]`）。名字来自
 *  插件/MCP 服务器，但它们进不了任何凭据——把它扫掉只会让读数分不清「省了谁」。 */
export interface SurfaceAccountEvent {
  type: "surface_account";
  /** 本 provider 实例内的**请求序号**（1-based）。**不等于**成功请求数：本条在模型请求**发出前**
   *  记录，被最终装配硬闸拦下（`[context_budget_exceeded]`）时仍留一条 ⇒ 叫 attempt 不叫 request。 */
  attemptSeq: number;
  /** 声明面：`planSurfaceBudget` 入参那一份。 */
  declaredToolCount: number;
  declaredToolSpecChars: number;
  /** 送出面：降配梯走完真正发出去的那一份。 */
  sentToolCount: number;
  sentToolSpecChars: number;
  /** 基础系统提示（`opts.system`）的字符数。**不含** memory / skills / 符号地图 / 附件——
   *  那些由 `composeTurnMessages` 作为另外的 system 块推入；`volatileChars` 及其分项单独记。 */
  baseSystemChars: number;
  /** 易变侧四块字符数合计（记忆 + skills 块 + 符号地图 + 附件引用）。
   *
   *  **为什么单列**：降配梯（`planSurfaceBudget`）的口径只有「system + 工具」——生产调用点
   *  `glm-session.ts` 不传 `volatileChars`，`accountModelSurface` 落到 0。
   *  于是这四个数是**唯一**能看到「降配梯看不见的那一半」的入口：不记就等于那部分开销无观测面。
   *
   *  ⚠️ **口径钉死：这是「降配计划那一刻」的快照，不是实际发出值。** 降配按构造排在压缩之前
   *  （三条判据断言 `compaction` 必须是会话日志最后一条：compaction.test.ts / compact-wiring.test.ts /
   *  hook-precompact-producer.test.ts）⇒ 观测事件不能排在压缩之后。压缩那一轮这些块会被重建：
   *  · 记忆：每轮重读，与压缩无关 ⇒ 准。
   *  · 符号地图：按 `history.length ≤ 2` 重判 ⇒ 可能变。
   *  · skills 块：**可能变大**——重挂只认已被 `compaction` 事件摘掉的激活记录
   *    （`plugins/index.ts:466-470`），压缩后新增的摘除集合会让更多 skill 具备重挂资格。
   *  所以它既不是上界也不是实发值；压缩那一轮的实发口径以 compaction 预算自己的
   *  `AssemblyOverhead` 为准。**照实记，绝不因为「可能不准」就省掉不记。** */
  volatileChars: number;
  /** 记忆注入块字符数（`MemoryInjection.charsCurrent`，token 预算 `MEMORY_TOKEN_BUDGET_DEFAULT`）。 */
  memoryChars: number;
  /** skills 块字符数（路由清单 + hook 上下文 + 摘除说明 + 压缩后重挂，`pluginContext()` 产出）。 */
  skillsBlockChars: number;
  /** 符号地图字符数（`mapInjectText()` 产出；首轮才注入，未注入记 0）。 */
  mapChars: number;
  /** 附件引用块字符数（`formatAttachmentContext()`，每附件一行路径、不含内容）。 */
  attachmentContextChars: number;
  limitChars: number;
  /** 超出帽子的字符数（降配**前**口径）。>0 即降配梯被触发。 */
  overChars: number;
  /** 被压描述的工具名（数组序）。**未发生为空数组，不省略**——空数组 = 确定没降配，
   *  与「旧版本没记这个字段」必须分得开。 */
  shortened: string[];
  /** 被整条丢弃的工具名（丢弃序 = 从尾向前）。 */
  dropped: string[];
  /** 降配梯走完仍超帽（core 不被自动砍，报红交人裁决）。 */
  unresolvable: boolean;
  /** 与未降配版逐字符比对的「仍可缓存前缀字符数」——梯级 A 的缓存代价。 */
  prefixStableChars: number;
  /** 本请求的工具面是否与上一次**记录**相比变了（含面**变小**：run 中途 skill 摘除 / 权限档收紧
   *  会走 `requestFace` 逐请求现算）。采样条件之一，落进事件里是为了让「为什么这一轮被记录」
   *  可回放、可审计。 */
  faceChanged: boolean;
}

export type AgentEvent = (
  | UserMessageEvent
  | AssistantMessageEvent
  | AssistantDeltaEvent
  | ThinkingDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | UsageEvent
  | SessionMetaEvent
  | ClarifyRequestedEvent
  | PlanProposedEvent
  | PlanApprovedEvent
  | VerifyResultEvent
  | CompactionEvent
  | SecurityReportEvent
  | ImpactReportEvent
  | AgentSpawnedEvent
  | AgentStatusEvent
  | AgentMessageEvent
  | AgentResultEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | CardActionEvent
  | DiffCommentEvent
  | RoutingDecisionEvent
  | AutomationTriggeredEvent
  | AutomationSkippedEvent
  | AutomationCompletedEvent
  | GoalSetEvent
  | GoalStoppedEvent
  | GoalPausedEvent
  | GoalResumedEvent
  | TurnTruncatedEvent
  | SurfaceAccountEvent
  | RunErrorEvent
) & { /** M2 §3.5：事件真值时间戳（毫秒）。core 自 8361657 起在落盘处统一盖戳——写调用方同一对象，live 与盘同式（tests/events.test.ts 三用例钉死），新事件恒在场；旧 JSONL 缺席，读侧按可选兼容（投影留空不造假）。 */ ts?: number };

/** 已登记的事件类型（`append` 拒未知类型的那一份事实源）。
 *
 *  **为什么是 `Record<AgentEvent["type"], true>` 而不是 `Set`**：漏登记会变成**编译期**错误
 *  （缺键 ⇒ TS2741），而不是等到某个真实会话第一次 `append` 时才在运行期抛。旧形状下
 *  「联合加了成员、名单忘了加」在整条自动化路径上**没有任何一处会红**——两张手写名单之间
 *  没有机器判据（`tests/event-registry.ts` 的 `unionTypes()` 全仓零消费者，那张闸 2026-10 复核
 *  时已不存在）。改名/换写法时必须同步 `tests/event-registry.ts` 的 `knownTypes()` 取料口。
 *
 *  运行时查找用 `Object.hasOwn` 而不是 `in`：`in` 会顺原型链把 `toString` 这类名字认成已登记。 */
const KNOWN_TYPES: Record<AgentEvent["type"], true> = {
  user_message: true,
  assistant_message: true,
  assistant_delta: true,
  thinking_delta: true,
  tool_call: true,
  tool_result: true,
  usage: true,
  session_meta: true,
  clarify_requested: true,
  plan_proposed: true,
  plan_approved: true,
  verify_result: true,
  compaction: true,
  security_report: true,
  impact_report: true,
  agent_spawned: true,
  agent_status: true,
  agent_message: true,
  agent_result: true,
  approval_requested: true,
  approval_resolved: true,
  card_action: true,
  diff_comment: true,
  routing_decision: true,
  automation_triggered: true,
  automation_skipped: true,
  automation_completed: true,
  goal_set: true,
  goal_stopped: true,
  goal_paused: true,
  goal_resumed: true,
  turn_truncated: true,
  surface_account: true,
  error: true,
};

// ---- A1（P0-A）：事件落盘常驻文件句柄 ----
// 旧实现 appendFile 每事件 open+write+close（实测 1,930 µs/事件）；createEventLog().append 被
// loop 对每个事件（含每个流式 token 块）调用。改为常驻 FileHandle 直写（实测 9.83 µs，196×）：
// 有界句柄缓存 + 按 path 串行解析。逐事件立即 write——**不引入用户态缓冲**，「先落 JSONL 再回调」
// 与崩溃窗口语义不变（不做微批）。
const LOG_HANDLE_MAX = 32;
interface CachedHandle {
  fh: FileHandle;
  ino: number;
}
const logHandles = new Map<string, CachedHandle>();
/** 按 path 串行化句柄解析（照抄 replayChain 写法）：并发 append 在 await 间隙不得各开一次句柄。 */
const logHandleChain = new Map<string, Promise<FileHandle>>();

/** 半写尾行的扫描上限：尾段超过它仍无换行就**不猜边界**（见 `repairPartialTail` 的分支二）。 */
const TAIL_SCAN_CAP = 1 << 20;

/** 半写尾行修复（只在新开句柄时做，= 跨进程续写的唯一入口）：
 *  进程被硬杀在单次 `write` 中途时，文件尾可能留下**半条 JSON**。读者侧一直按「尾部半写可丢」
 *  容错（`replay`/`replayIncremental`），但写入侧此前没人补这一步——下一次 append 会把它和
 *  下一条事件拼成**一条**坏行，于是**新事件静默不可见**（2026-10-01 M8 侧发现并登记的边界，
 *  本笔收口）。这里把没成行的尾段裁掉并响亮告警：丢的是从未成行的字节，而读者本来就看不见它们。
 *  **只在尾部修**：文件中间的坏行不动——那是另一类事故，重放会当场抛；不许被这条修安静地抹掉。 */
async function repairPartialTail(path: string, fh: FileHandle): Promise<void> {
  const size = (await fh.stat()).size;
  if (size === 0) return;
  const last = Buffer.allocUnsafe(1);
  await fh.read(last, 0, 1, size - 1);
  if (last[0] === 0x0a) return; // 以换行收尾：没有半写尾行
  let pos = size;
  let scanned = 0;
  const chunk = 64 * 1024;
  let cut: number | null = null;
  while (pos > 0 && scanned < TAIL_SCAN_CAP) {
    const start = Math.max(0, pos - chunk);
    const len = pos - start;
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start);
    const idx = buf.lastIndexOf(0x0a);
    if (idx >= 0) {
      cut = start + idx + 1; // 指向最后一个换行符之后
      break;
    }
    pos = start;
    scanned += len;
  }
  if (cut !== null) {
    await fh.truncate(cut);
    console.warn(
      `[events] 检测到半写尾行（上次写入未完成，多半是被硬杀在写中途）：已丢弃未成行的 ${String(size - cut)} 字节并续写：${path}`,
    );
    return;
  }
  // >1MB 却一个换行都没有：不猜边界。补一个换行把劣质尾段隔离——下一条事件落在干净的新行上，
  // 而重放会对那条坏行**大声抛**（可见胜于静默：这条路径不允许修成"悄悄少几条"）。
  await fh.write("\n");
  console.warn(
    `[events] 尾部超过 ${String(TAIL_SCAN_CAP / 1024 / 1024)}MB 无换行，放弃自动裁剪：已补换行隔离，重放会点名该坏行：${path}`,
  );
}

/** 解析（必要时新建）path 的常驻句柄。inode 校验是必须的：agent-runner 会先 rm(logPath) 再
 *  createEventLog——不校验会把事件写进已 unlink 的旧 inode（静默丢数据）。 */
async function resolveHandleInner(path: string): Promise<FileHandle> {
  const st = await stat(path).catch(() => null);
  const cached = logHandles.get(path);
  if (cached && st !== null && st.ino === cached.ino) return cached.fh; // 同 inode → 复用
  if (cached) {
    // 旧 inode 已被 unlink/替换：关掉旧句柄（忽略错误）并从缓存删除
    logHandles.delete(path);
    await cached.fh.close().catch(() => undefined);
  }
  // `a+` 而不是 `a`：半写尾行修复要在**同一句柄**上回读文件尾（`a` 是只写 fd，read 报 EBADF）。
  // 追加语义逐字不变（O_APPEND：写永远落在末尾），只多一个可读位。
  const fh = await open(path, "a+");
  await repairPartialTail(path, fh);
  const ino = (await fh.stat()).ino;
  if (logHandles.size >= LOG_HANDLE_MAX) {
    // 有界：淘汰最早插入的一条并关闭其句柄（照抄 replayCache 的淘汰写法；Map 插入序即 LRU-ish，
    // 不做访问序更新，保持简单）。
    const oldest = logHandles.keys().next().value;
    if (oldest !== undefined) {
      const old = logHandles.get(oldest);
      logHandles.delete(oldest);
      if (old) await old.fh.close().catch(() => undefined);
    }
  }
  logHandles.set(path, { fh, ino });
  return fh;
}

/** 串行化入口（照抄 replayIncremental）：同一 path 的解析按到达顺序执行，跑完即回收链（有界）。
 *  导出给同族的 append-only 写路径复用（scheduler journal），不另造一套缓存/链。 */
export async function resolveHandle(path: string): Promise<FileHandle> {
  const prev = logHandleChain.get(path);
  const job = (prev === undefined ? Promise.resolve() : prev.catch(() => undefined)).then(() =>
    resolveHandleInner(path),
  );
  logHandleChain.set(path, job);
  try {
    return await job;
  } finally {
    if (logHandleChain.get(path) === job) logHandleChain.delete(path); // 无并发即回收（有界）
  }
}

export interface EventLog {
  /** 追加一个事件到日志末尾；只追加，永不改写已有内容。 */
  append(event: AgentEvent): Promise<void>;
  /** A1：关闭本实例常驻句柄（可选）。退出路径由 closeAllEventLogs 统一收；单实例可显式回收。 */
  close?(): Promise<void>;
}

/** 创建绑定到日志路径的事件流。 */
export function createEventLog(path: string): EventLog {
  // A1 + X1：按实例缓存句柄引用 `cur`，但**每次 append 都核对它是否仍是缓存里的当前句柄**
  // （1 次 Map.get + 1 次指针比较，纳秒级，不引入 await）。有界缓存（LOG_HANDLE_MAX=32）淘汰、
  // 或 rm 重建 / invalidateEventLogHandle 显式失效后，cur 与缓存失配 → 自动重新 resolve，
  // 避免 write 到已关闭句柄（ERR_FILE_HANDLE_CLOSED）。真实触发路径：长会话里 32+ 个 sidechat/
  // 会话 path 会把主 run 的句柄挤出缓存并 close。
  let cur: FileHandle | null = null;
  return {
    async append(event) {
      if (!event || typeof event.type !== "string" || !Object.hasOwn(KNOWN_TYPES, event.type)) {
        throw new Error(`未知事件类型: ${JSON.stringify((event as { type?: unknown })?.type)}`);
      }
      // A8（审查）：轻量 payload 校验——{"type":"tool_result"} 缺 output 会一路流进
      // serializeConversation 并在压缩时抛错；写入口 fail-loud 比读路径深处的类型错误可诊断得多。
      if (event.type === "tool_result" && typeof (event as { output?: unknown }).output !== "string") {
        throw new Error("tool_result 事件缺 output 字符串（写入被拒）");
      }
      if (
        (event.type === "user_message" || event.type === "assistant_message") &&
        typeof (event as { content?: unknown }).content !== "string"
      ) {
        throw new Error(event.type + " 事件缺 content 字符串（写入被拒）");
      }
      // 校验全部通过后才解析句柄并 write（校验必须在 write 之前）。
      const cached = logHandles.get(path);
      if (cur === null || cached === undefined || cached.fh !== cur) cur = await resolveHandle(path);
      // 时钟戳盖在**落盘这一处**，不让每个生产者自己记得：`ts?: number` 曾声明在十个事件类型上，
      // 而真语料里 282 条 tool_call 一条都没带 ⇒ 工具耗时、轮耗时、「模型时间 vs 工具时间」占比
      // 在盘上全都不可测（可选字段当默认行为，等于没有行为）。producer 自带的值原样保留
      // （automation 那批本来就自己盖，覆盖会把它们的语义洗掉）。
      // **盖在事件本身上，不另造一份只存在于盘上的副本**：`ipc:check` 的「丢弃内存态 → 重放等价」
      // 与 `schedule-check` 的「append→replay 逐字无损」两条老不变量都要求 live 与盘同一个式子；
      // 副本让那两条恒红（2026-09-24 实测：ipc:check / schedule-check J1 J2 三门同时红，
      // 而单测面用 stripTs 各自绕过了它——同一件事在五个测试文件里各抄一份归一化，就是这种漏口的形状）。
      const holder = event as { ts?: number };
      if (holder.ts === undefined) holder.ts = Date.now();
      await cur.write(JSON.stringify(event) + "\n");
    },
    async close() {
      // 关闭本实例对应 path 的缓存句柄（仅当缓存中仍是本实例解析的那个）。不在 append 后自动关闭。
      if (cur === null) return;
      const cached = logHandles.get(path);
      if (cached && cached.fh === cur) {
        logHandles.delete(path);
        await cur.close().catch(() => undefined);
      }
      cur = null;
    },
  };
}

/** X2：查询某 path 当前是否已有常驻句柄（供调用方决定是否需要先建父目录——本机实测
 *  `mkdir(recursive)` ≈ 2.1ms/次，是 10k 级 append 的主成本，已解析过就必须跳过）。 */
export function hasEventLogHandle(path: string): boolean {
  return logHandles.has(path);
}

/** X2：显式失效某个 path 的常驻句柄（从缓存删除并 close，错误一律吞掉）。**幂等**（不存在时无操作）。
 *  用途：同路径文件被**覆盖写**（如 journal 的 read→rename 收敛）后，缓存句柄仍指向旧 inode，
 *  后续写入会静默丢失——必须显式失效，让下次写入重新 resolve 到新 inode。
 *  实例侧的 cur 引用会在下次 append 的核对中自然失配（cur !== 缓存当前句柄）→ 自动重新解析。
 *  ⚠️ 这是**显式契约，不是补丁**：当前 `resolveHandleInner` 的 inode 校验已能兜住 rename 覆盖
 *  （旧句柄 ino ≠ 新文件 ino → 自动关旧开新），保留本函数是为了**不依赖该隐式行为**，并在将来
 *  journal 路径也引入实例级句柄记忆化（如 X1 的 cur 快路径，会绕过 inode 校验）时仍然安全——
 *  **不要因为它看起来冗余就删掉**。 */
export async function invalidateEventLogHandle(path: string): Promise<void> {
  const cached = logHandles.get(path);
  if (cached === undefined) return;
  logHandles.delete(path);
  await cached.fh.close().catch(() => undefined);
}

/** A1：退出路径统一关闭全部常驻句柄（错误一律吞掉——退出路径不能抛）。 */
export async function closeAllEventLogs(): Promise<void> {
  const handles = [...logHandles.values()];
  logHandles.clear();
  for (const h of handles) await h.fh.close().catch(() => undefined);
}

/** 两条入口共用的「非尾部坏行」判据与文案：replay 与 replayIncremental 必须给同一个裁决——
 *  否则同一份损坏文件在全量入口炸、在增量入口静默产出错位投影（id=行号契约只在一条入口成立）。 */
function midBadLineError(path: string, midBad: number[]): Error {
  return new Error(
    `会话日志有 ${String(midBad.length)} 条非尾部坏行（首在第 ${String(midBad[0])} 行）：跳过会使事件 id 与 1-based 行号错位，` +
      `血缘/分支/压缩 id 全部失准，请修复该文件或从备份恢复: ${path}`,
  );
}

/** 重放：按写入顺序读回全部事件。untilEventId 给定时只重放到该事件点（含）。
 * 事件 id = 1-based 行号（append-only 保证永不漂移），即「事件点」。
 * A1（审查）：逐行容错——崩溃/并发写把尾行写成半行不再炸掉整会话（旧实现一行坏 = 所有
 * replay 调用点连锁失败 = 会话永久不可打开）。
 * 容错边界（审查 S1-4 修正）：只容忍**损坏后缀**（最后一个有效事件之后的坏行）。中段坏行
 * 不得跳过——「id = 1-based 行号」是跨文件契约（origin.source_event_ids、untilEventId、
 * compaction 的 compressed_event_ids、prune、promote 的 events[id-1] 全按此取事件），
 * 跳一行会让其后所有 id 静默错位一格：promote 取到错误的源消息、fork/回滚落错事件点。
 * 那种文件真已损坏，显式失败比静默错数据安全（与 agent-loop「不猜」的口径一致）。 */
export async function replay(path: string, untilEventId?: string): Promise<AgentEvent[]> {
  const raw = await readFile(path, "utf8");
  const events: AgentEvent[] = [];
  const badLines: number[] = []; // 坏行的 1-based 行号
  let lastGoodLine = 0;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // 容忍文件末尾空行
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      badLines.push(i + 1); // 半写行/坏行：先记下，按位置决定容忍还是判坏
      continue;
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
      badLines.push(i + 1); // 合法 JSON 但非事件对象（null / 123 / 数组）：同样按位置判定
      continue;
    }
    lastGoodLine = i + 1;
    events.push(parsed as AgentEvent);
  }
  const midBad = badLines.filter((l) => l < lastGoodLine);
  if (midBad.length > 0) throw midBadLineError(path, midBad);
  if (badLines.length > 0) console.warn(`[events] replay 跳过尾部 ${String(badLines.length)} 条坏行（降级容错）: ${path}`);
  if (untilEventId === undefined) return events;
  const n = Number(untilEventId);
  if (!Number.isInteger(n) || n < 1 || n > events.length) {
    throw new Error(`无效 untilEventId: ${JSON.stringify(untilEventId)}（会话共 ${events.length} 条事件）`);
  }
  return events.slice(0, n);
}

// ---- A5（审查根因 5）：增量重放——glm-session/sidechat 每轮全量读盘 → 只解析追加段 ----
// 会话 JSONL append-only：按 (ino, 完整行字节偏移) 缓存已解析事件数组，每轮只读尾部新行。
// 坏行裁决与 replay 同一条（共用 midBadLineError）：**尾坏可容、非尾坏必炸**，且「当时在尾部」
// 不是永久豁免——崩溃留下的半行会被下一次 append 粘成一条完整的坏行，此后再追加就成了中段坏行；
// 那时 replay 会抛，增量若继续静默跳过，缓存下标就与 1-based 行号错位（正是 S1-4 要防的）。
// 投影本身仍是每轮全量（O(n)），增量折叠需处理 compaction 失效语义——收口留位第三批。
const replayCache = new Map<string, ReplayCacheEntry>();
/** line = 已消费的完整行数（下一批第 i 行的绝对行号 = line + i + 1）；
 *  tailBad = 已跳过、当批仍在尾部的坏行行号（其后一旦出现新事件即转为非尾部 → 抛）。 */
interface ReplayCacheEntry { ino: number; offset: number; events: AgentEvent[]; line: number; tailBad: number[] }
const REPLAY_CACHE_MAX = 32;

function parseReplayLine(t: string): AgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") return null;
  return parsed as AgentEvent;
}

/** B8 同型（审查 S1-2）：共享缓存的「读尾部 + push + offset 推进」在 await 间隙会被并发
 *  消费方各推一次（主会话 assemble 与 sidechat 读主会话投影可同时在飞）=> 该轮投影重复事件、
 *  offset 越界。按 path 维护在途 Promise 链串行化，且每次交出副本，缓存本体不外泄。 */
const replayChain = new Map<string, Promise<AgentEvent[]>>();

export async function replayIncremental(path: string): Promise<AgentEvent[]> {
  const prev = replayChain.get(path);
  const job = (prev === undefined ? Promise.resolve() : prev.catch(() => undefined)).then(() => replayIncrementalInner(path));
  replayChain.set(path, job);
  try {
    return await job;
  } finally {
    if (replayChain.get(path) === job) replayChain.delete(path); // 无并发即回收（有界）
  }
}

async function replayIncrementalInner(path: string): Promise<AgentEvent[]> {
  let st;
  try {
    st = await stat(path);
  } catch {
    replayCache.delete(path); // 会话文件被清理：缓存同步失效
    return [];
  }
  const cached = replayCache.get(path);
  if (!cached || cached.ino !== st.ino || cached.offset > st.size) {
    // 首访 / 文件被重建（inode 变化）/ 被截断 → 全量解析并重建缓存
    const raw = await readFile(path, "utf8").catch(() => "");
    const events: AgentEvent[] = [];
    const bad: number[] = [];
    let offset = 0;
    let lastGood = 0;
    const allParts = raw.split("\n");
    const completeInit = raw === "" ? [] : allParts.slice(0, -1); // 最后一段是尾行（空串或半写）
    for (let i = 0; i < completeInit.length; i++) {
      const rawLine = completeInit[i];
      offset += Buffer.byteLength(rawLine, "utf8") + 1; // 完整行都推进偏移（含空行/坏行）
      const t = rawLine.trim();
      if (!t) continue;
      const e = parseReplayLine(t);
      if (e) { lastGood = i + 1; events.push(e); } else bad.push(i + 1);
    }
    const midBad = bad.filter((l) => l < lastGood);
    if (midBad.length > 0) throw midBadLineError(path, midBad); // 抛在写缓存之前：不留半份缓存
    if (bad.length > 0) console.warn(`[events] replayIncremental 跳过尾部 ${String(bad.length)} 条坏行（降级容错）: ${path}`);
    if (replayCache.size >= REPLAY_CACHE_MAX) {
      const oldest = replayCache.keys().next().value;
      if (oldest !== undefined) replayCache.delete(oldest);
    }
    const entry: ReplayCacheEntry = { ino: st.ino, offset: Math.min(offset, st.size), events, line: completeInit.length, tailBad: bad };
    replayCache.set(path, entry);
    return entry.events.slice(); // 交副本：消费方排序/清空不得影响缓存
  }
  // 增量：只读上次偏移之后的完整行（半写尾行留待完整落盘——不推进偏移、不重复解析）
  const len = st.size - cached.offset;
  if (len <= 0) return cached.events.slice();
  const fresh: AgentEvent[] = [];
  const bad: number[] = [];
  let lastGood = 0;
  let consumed = 0;
  let done = 0; // 本批消费的完整行数（含空行/坏行——它们同样占行号）
  const fh = await open(path, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, cached.offset);
    const text = buf.toString("utf8");
    const parts = text.split("\n");
    const complete = parts.slice(0, -1); // 最后一段是尾行（空串=到 EOF；否则半写）
    done = complete.length;
    for (let i = 0; i < complete.length; i++) {
      const rawLine = complete[i];
      consumed += Buffer.byteLength(rawLine, "utf8") + 1;
      const t = rawLine.trim();
      if (!t) continue;
      const abs = cached.line + i + 1;
      const e = parseReplayLine(t);
      if (e) { lastGood = abs; fresh.push(e); } else bad.push(abs);
    }
  } finally {
    await fh.close();
  }
  // 跨批裁决：上一批留下的尾坏，只要本批出现新事件就已离开尾部 ⇒ 与 replay 同判必炸。
  // 先算后写：抛出去时不碰缓存（偏移不推进 → 下次同一批重读，仍抛，不会退化成静默错位）。
  const midBad = [...(fresh.length > 0 ? cached.tailBad : []), ...bad.filter((l) => l < lastGood)];
  if (midBad.length > 0) throw midBadLineError(path, midBad);
  if (bad.length > 0) console.warn(`[events] replayIncremental 跳过尾部 ${String(bad.length)} 条坏行（降级容错）: ${path}`);
  cached.events.push(...fresh);
  cached.offset += consumed;
  cached.line += done;
  cached.tailBad = fresh.length > 0 ? [...bad] : [...cached.tailBad, ...bad];
  return cached.events.slice();
}

/** 流式渲染的合成基底：同一轮回复的增量片段按序拼回完整文本。 */
export function mergeAssistantDeltas(deltas: AssistantDeltaEvent[], callId?: string): string {
  return deltas
    .filter((d) => callId === undefined || d.callId === callId)
    .map((d) => d.text)
    .join("");
}

export interface ForkResult {
  /** 新会话目录。 */
  sessionDir: string;
  /** 新会话事件文件路径。 */
  eventsPath: string;
  /** 新会话事件条数 = N + 1（session_meta）。 */
  count: number;
}

/** 会话分支：从事件点 eventId 派生新会话目录。
 * 内容 = 原会话前 N 条（含该事件点）+ 一条 session_meta{branch_of: 原会话路径}。
 * 原会话文件只读，字节不变；新文件从空日志 append-only 写出。 */
export async function forkSession(sessionPath: string, eventId: string, targetDir?: string): Promise<ForkResult> {
  const all = await replay(sessionPath);
  const n = Number(eventId);
  if (!Number.isInteger(n) || n < 1 || n > all.length) {
    throw new Error(`无效 eventId: ${JSON.stringify(eventId)}（会话共 ${all.length} 条事件）`);
  }
  const dir = targetDir ?? join(dirname(sessionPath), `${basename(sessionPath, ".jsonl")}-fork-${Date.now()}`);
  const eventsPath = join(dir, "events.jsonl");
  await mkdir(dir, { recursive: true });
  const log = createEventLog(eventsPath);
  for (const e of all.slice(0, n)) await log.append(e);
  await log.append({ type: "session_meta", branch_of: sessionPath });
  return { sessionDir: dir, eventsPath, count: n + 1 };
}
