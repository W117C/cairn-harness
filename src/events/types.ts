// 事件协议面：`AgentEvent` 联合 + 各事件类型 + `KNOWN_TYPES` 注册表（append 拒未知类型的那份事实源）。
// 2026-10-17 从 events/index.ts 拆出：前 770 行协议面住这里，存储引擎（句柄/尾行修复/replay/fork）住
// ./log.ts——拆前两张脸同宅，改协议与改存储永远互相扰动行号。公开面 = ./index.ts 按原路径逐名再导出。
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
  /** 来源 sidechat 事件 id（1-based 行号，可跳回源消息）。来源引用形式下为空数组。 */
  source_event_ids: number[];
  /** 来源引用形式（指针分叉）：与 source_event_ids 互斥；每条的 eventId 是所属文件的物理行号。 */
  source_event_refs?: import("./session-ref").EventRef[];
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
/** 用户消息附带的文件/目录引用（2026-10-18）：只记引用，不含内容；缺省 = 无附件，既有事件字节不变。
 *  kind 与主进程 RunAttachmentKind 同字面量；事件层不反向依赖 main，故就地声明。 */
export interface UserMessageAttachment { path: string; kind: "file" | "directory" }

export interface UserMessageEvent { type: "user_message"; content: string; origin?: UserMessageOrigin; skill?: SkillInvocationMeta; attachments?: readonly UserMessageAttachment[] }
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
  /** 交付给用户的产物引用（`ToolResult.artifact` 的透传）。**只放路径不放字节**——
   *  图片字节进 `images` 那条内存通道给模型，这一格给的是"用户在哪儿看它"。
   *  从前这一路整段缺席：agent 说"图已经贴在上面了"，而落盘事件里没有任何可指的产物，
   *  桌面端也就无从显示。缺席 = 这次调用没有交付物（绝大多数调用）。 */
  artifact?: { kind: "image" | "html" | "svg" | "text"; path: string; note?: string };
  change?: "created" | "modified";
  /** 动作融合的结构事实：写已落盘，随后的 lint 可能失败（因此 `ok` 可能是 false）。
   *  写盘证据的读者（goal / worker-report / tool-choice）必须把它与 `ok` 一起看；
   *  缺席 = 旧事件或非融合写（仍由 `ok` 判定）。 */
  fusedWrite?: boolean;
  /** 多文件写工具成功落盘的 workspace 相对路径清单；缺席表示没有结构化清单。 */
  changedPaths?: string[]; /** 进程退出码（run_shell / worker shell / 沙箱出口才有）。
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
  /** 指针分叉的血缘（ADR 0005：分叉是**指针**不是拷贝）。
   *
   *  **缺席 = 这是个独立/根会话**（不是「边界 0」）——两者必须分得开：
   *  「没有 fork 字段」说的是「压根没有父会话」，不是「父会话存在但边界在 0」。
   *  一旦把缺席读成「边界 0」，独立会话就会被当成"分叉自某个空前缀"，血缘树整个歪掉。
   *
   *  `from_session_path` = 父会话 events.jsonl 的路径（与 `branch_of` 同一口径：绝对路径）。
   *  `boundary_event_id` = 继承的父事件前缀长度（**含**该 id，1-based 行号口径）。
   *  `from_session_id` = 父会话 id（可选）：路径改名/移动时仍有一个人读的身份。 */
  fork?: { from_session_path: string; boundary_event_id: number; from_session_id?: string };
}

/** 日志结构控制记录（ADR 0005）：**关于日志本身**的记录，不是「agent 做了什么」。
 *
 *  §①.3「新增能力优先走既有字段的 origin 通道」管的是**描述 agent 行为**的能力；
 *  它不管**日志结构控制记录**——回退指针、元数据补丁这类东西没有 origin 通道可挂：
 *  它们不是某个 user_message 的来源标注，而是**对日志本身的改写**。
 *  先例已在仓内：`compaction`（关于日志的记录）与 `session_meta`（关于会话身份的记录）都是既有事件型。
 *
 *  **`replay()` 不解释它们**（逐字原样返回，含控制记录）：解释控制记录是**投影**的活
 *  （`src/events/projection.ts` 的 `effectiveEvents` / `sessionMetaPatch`）。
 *  这正是「JSONL 逐字重放」与「事件 id = 1-based 行号」能同时为真的原因。 */
export interface SessionRewindEvent {
  type: "session_rewind";
  /** 回退到哪条事件（1-based 行号口径，**含**该条）。语义见 ADR 0005。 */
  to_event_id: number;
  /** 回退理由（自由文本，可缺席）。**缺席 = 没记理由**，不等于「没有理由存在」。 */
  reason?: string;
}

/** 会话元数据的增量补丁（ADR 0005）：改**会话的身份/属性**，不改消息历史。
 *
 *  `patch` = 键值对。**缺席的键 = 该键不变**（不是"清空"）；空 patch = 什么都没改
 *  （记录存在，但这一笔不改变任何东西）。 */
export interface SessionMetaUpdateEvent {
  type: "session_meta_update";
  patch: Record<string, string>;
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
/** 摘要注入锚点（来源形式）：在某个事件之前，或明确的末尾。 */
export type SummaryAnchor = { before: import("./session-ref").EventRef } | { end: true };

/** 压缩记录的公共字段（两种引用形式共享；新旧互斥）。 */
export interface CompactionCommon {
  type: "compaction";
  trigger: "auto" | "manual" | "overflow";
  reason: "threshold" | "hard_buffer" | "user_request";
  summary: string;
  tokens_before: number;
  tokens_after: number;
  usage?: CompactionUsage;
  model?: string;
  /** M3c：worker 归因（§7.5 worker 压缩事件落子流；主会话压缩无此字段）。 */
  agent_id?: string;
}

/** 旧数字形式：`compressed_event_ids` 是**本文件**的 1-based 行号，`summary_offset` 是**本文件**的注入位置。
 *  继续可读；跨文件写回一律使用来源形式。 */
export interface NumericCompaction extends CompactionCommon {
  compressed_event_ids: number[];
  summary_offset: number;
  reference_version?: undefined;
  compressed_event_refs?: undefined;
  summary_anchor?: undefined;
  superseded_summary_refs?: undefined;
}

/** 来源形式（ADR 0005 产品接入）：跨文件压缩只认 EventRef，数字位置不在拼接数组上解释。
 *  完整来源集合与锚点必须成套在场；旧摘要若进入新摘要输入，其来源须列入 `superseded_summary_refs`。 */
export interface ReferencedCompaction extends CompactionCommon {
  reference_version: 1;
  compressed_event_refs: import("./session-ref").EventRef[];
  summary_anchor: SummaryAnchor;
  superseded_summary_refs: import("./session-ref").EventRef[];
  compressed_event_ids?: undefined;
  summary_offset?: undefined;
}

export type CompactionEvent = NumericCompaction | ReferencedCompaction;

/** 形状判别：新旧互斥，不会同时为真（类型上就互斥）。 */
export function isReferencedCompaction(e: CompactionEvent): e is ReferencedCompaction {
  return "reference_version" in e && e.reference_version === 1;
}

export function isNumericCompaction(e: CompactionEvent): e is NumericCompaction {
  return "compressed_event_ids" in e;
}

/** 旧数字形式的行号集合；来源形式没有「本文件行号集合」这回事 ⇒ 显式抛，不返回空数组。 */
export function numericCompactionIds(e: CompactionEvent): number[] {
  if (!isNumericCompaction(e)) throw new Error("压缩记录不是旧数字形式：来源形式没有本文件行号集合");
  return e.compressed_event_ids;
}

/** 旧数字形式的注入位置（本文件 1-based 行号）；来源形式用 `summary_anchor`。 */
export function numericCompactionOffset(e: CompactionEvent): number {
  if (!isNumericCompaction(e)) throw new Error("压缩记录不是旧数字形式：来源形式没有本文件 summary_offset");
  return e.summary_offset;
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
  /** 卡片来源的**真实**归属（指针分叉：祖先行）。旧数字形式没有它 = 来源是当前会话自己的行。 */
  source_event_ref?: import("./session-ref").EventRef;
}

/** M3b 评审闭环（§3.4 / §4.5）：diff 卡行级评论 → 定向 user_message 注入该 worker 子流 → 修正 → diff 卡 v2。
 *  评论回传不挂 turn、走事件流协议（与 card_action 同族）。 */
export interface DiffCommentEvent {
  type: "diff_comment";
  agent_id: string;
  /** 评论所依据的卡片来源（可选；祖先行时记录真实来源）。 */
  source_ref?: import("./session-ref").EventRef;
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
/** 一次「还原」的事实（检查器「撤销此文件改动」成功后落流）。
 *
 *  为什么需要它：改动面（Inspector 的「改动」Tab、变更窗格、顶栏 Changes 徽标、交付卡的
 *  「改动已验证」）此前**全部**从事件流投影，而还原这件事只改了盘上的文件、**不留任何事件**
 *  ⇒ 还原之后那一行仍写着"修改"、仍提供"撤销"、徽标仍数着它、交付卡仍说"改动已验证"——
 *  而那个改动在盘上已经不存在了。这不是显示小疵，是产品对"这一轮交付了什么"在撒谎。
 *
 *  语义：一个文件被显式还原 ⇒ 它退出改动面（用户明说"这一项我撤了"）；此后 agent **再写**它，
 *  它重新进改动面（还原只撤掉改动，没撤掉这个文件以后再被改的资格）。 */
export interface FileRestoredEvent {
  type: "file_restored";
  /** 被还原的路径（相对工作区，与 tool_call 的 path 同一口径）。 */
  path: string;
  /** 还原所用的覆盖前快照 id（可选；同一份事件流里能对回是哪一次覆盖）。 */
  snapshotId?: string;
  /** 被撤销对象在来源视图里的真实归属（祖先行时指向父文件；旧事件缺席）。 */
  source_ref?: import("./session-ref").EventRef;
  ts?: number;
}

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

/** 一轮模型输出结束了，而**一个停止原因都没收到**（2026-10-13 第 471 页）。
 *
 *  与 `turn_truncated` 的分界：那一族是「知道它没说完」（有可判原因：篇幅／策略）；
 *  这一枚是「不知道它说没说」——模型自己收尾（provider 会报 stop）与上游静默掐流
 *  （一个字节都没报）此前在事件流里长得一模一样（都零新事件），于是「叙述后停住」
 *  到底是模型的账还是传输的账**不可归因**。它只补观测面，不改 loop 行为：
 *  「缺失」不是「截断」，所以不进模型上下文、不参与判定（同 `surface_account` 的口径）。 */
export interface TurnStopMissingEvent {
  type: "turn_stop_missing";
  /** 哪一轮（与 assistant_delta 的 callId 同源）。 */
  callId: string;
  /** 当时已用掉多少输出 token：缺 = provider 没上报（同 turn_truncated 的口径）。 */
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
   *  `session-provider.ts` 不传 `volatileChars`，`accountModelSurface` 落到 0。
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
  | TurnStopMissingEvent
  | SurfaceAccountEvent
  | FileRestoredEvent
  | SessionRewindEvent
  | SessionMetaUpdateEvent
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
// **导出是模块内共享**（./log.ts 的 append 校验读它）；公开面 = ./index.ts 的逐名再导出清单——
// 它不在清单里（拆分前就没有导出过它，公开面逐字不变）。
export const KNOWN_TYPES: Record<AgentEvent["type"], true> = {
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
  turn_stop_missing: true,
  surface_account: true,
  file_restored: true,
  session_rewind: true,
  session_meta_update: true,
  error: true,
};
