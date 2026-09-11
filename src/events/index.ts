// 事件流：append-only JSONL，一事件一行。
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
export interface UserMessageEvent { type: "user_message"; content: string; origin?: PromoteOrigin }
export interface AssistantMessageEvent { type: "assistant_message"; content: string }
/** 流式增量片段：callId 标识同一轮回复，text 为逐字追加的一小段。 */
export interface AssistantDeltaEvent { type: "assistant_delta"; callId: string; text: string }
/** M3a：worker 子流的工具调用（§4.4.9 落主流口径）——agent_id 在场 = 该事件属于该 worker 子流，
 *  主上下文投影（projectContext）跳过带 agent_id 的事件（父上下文唯一接收物 = agent_result，§4.4.4）。 */
export interface ToolCallEvent { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; agent_id?: string }
/** M1c 自动放行来源审计（§11.7.5）：仅自动放行的 tool_result 携带，零新事件类型。 */
export interface AutoApproveMeta { source: "rule" | "session_scope"; ruleId?: string }
export interface ToolResultEvent { type: "tool_result"; callId: string; ok: boolean; output: string; auto?: AutoApproveMeta; agent_id?: string }
export interface UsageEvent { type: "usage"; inputTokens: number; outputTokens: number; /** M3a §4.4.10：usage 按 agent 归因（主 loop usage 无此字段）。 */ agent_id?: string }
/** 会话元信息：分支会话首行携带 branch_of 指向原会话；
 *  M2f：sidechat 会话首行携带 kind="sidechat" + parent_session_id 指向主会话。 */
export interface SessionMetaEvent {
  type: "session_meta";
  branch_of?: string;
  kind?: "sidechat";
  parent_session_id?: string;
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

export interface VerifyCommandResult { command: string; ok: boolean; output: string }
/** 验证门：一次 lint/test 执行结果。attempt 从 1 起；失败时错误输出经 tool_result 注入同轮继续修。 */
export interface VerifyResultEvent {
  type: "verify_result";
  callId: string;
  ok: boolean;
  attempt: number;
  maxAttempts: number;
  results: VerifyCommandResult[];
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
}

// ---- M2f 产出代码安全 report（§11.6 定稿，本轮只做 off/report）----
// 静态快筛（零 token、本地）：从事件流写动作重建变更集 → 密钥扫描（熵 + 已知模式）+ 危险 API 六类规则。
// findings 走严格 schema；被审内容是数据不是指令；报告进事件流前过输出扫描（密钥脱敏）。
export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type SecurityConfidence = "low" | "medium" | "high";
/** 危险 API 六类 + 密钥类（密钥非「危险 API」，单列以便验收计数）。 */
export type SecurityCategory =
  | "secret"
  | "eval"
  | "deserialization"
  | "weak_random"
  | "command_injection"
  | "sql_injection"
  | "path_traversal";

export interface SecurityFinding {
  /** 规则 id（稳定可审计）。 */
  ruleId: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  /** 命中文件（workspace 相对）。 */
  path: string;
  /** 行号（1-based，落在变更集内）。 */
  line: number;
  title: string;
  description: string;
  confidence: SecurityConfidence;
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
  mode: "report";
  findings: SecurityFinding[];
  changeSet: SecurityChangeRef[];
  summary: { total: number; bySeverity: Record<SecuritySeverity, number>; byCategory: Record<string, number> };
  /** 扫描时间（ISO 串；缺省 = 未标注）。 */
  scannedAt?: string;
}

// ---- M3a 多 agent 编排（§3.4 / §4.4）：agent 子流事件 + 审批事件协议 ----
// 子流纪律（§4.4.9 / 任务书裁决 1）：worker 事件落主会话 JSONL——agent_* 事件 + 该 worker 的
// tool_call/tool_result/usage 均带 agent_id；agent_spawned 携 parent_event_id（spawn tool_call 的
// 1-based 事件 id）建立血缘树。心跳 = 子流 tool_call/tool_result 天然时间戳，不造独立心跳事件。

/** spawn_agent 的 mode（§4.1）：M3a 只接入 read；write/pipeline spawn 即拒绝（M3b）。 */
export type AgentMode = "read" | "write" | "pipeline";
/** worker 状态机五态 + cancelled（§4.4.8）。 */
export type AgentStatus = "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "cancelled";
/** 权限档（与 src/permissions 的 PermissionMode 同字面量；events 层零依赖不自引）。 */
export type AgentPermissionMode = "read-only" | "default" | "auto";

export interface AgentSpawnedEvent {
  type: "agent_spawned";
  agent_id: string;
  /** 血缘：主流里 spawn_agent tool_call 的事件 id（1-based 行号）。 */
  parent_event_id: number;
  mode: AgentMode;
  task: string;
  /** 写租约声明（M3a 仅解析存档，租约求交与警告 M3b 落地）。 */
  resources?: string[];
  /** 依赖链（M3a 仅解析存档，事件驱动链接 M3c）。 */
  depends_on?: string[];
  model?: string;
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

/** 终态回传（§4.4.4）：父上下文唯一接收物。错误永不冒充结果——failed 走 status/reason 分型。 */
export interface AgentResultEvent {
  type: "agent_result";
  agent_id: string;
  status: "done" | "failed";
  reason?: string;
  /** ≤2000 token，超限类型化裁剪（summary_truncated = true + 尾部截断提示）。 */
  summary: string;
  summary_truncated?: boolean;
  artifacts: { report?: string; files_changed?: string[] };
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

export type AgentEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | AssistantDeltaEvent
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
  | AgentSpawnedEvent
  | AgentStatusEvent
  | AgentMessageEvent
  | AgentResultEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | CardActionEvent;

const KNOWN_TYPES = new Set([
  "user_message",
  "assistant_message",
  "assistant_delta",
  "tool_call",
  "tool_result",
  "usage",
  "session_meta",
  "clarify_requested",
  "plan_proposed",
  "plan_approved",
  "verify_result",
  "compaction",
  "security_report",
  "agent_spawned",
  "agent_status",
  "agent_message",
  "agent_result",
  "approval_requested",
  "approval_resolved",
  "card_action",
]);

export interface EventLog {
  /** 追加一个事件到日志末尾；只追加，永不改写已有内容。 */
  append(event: AgentEvent): Promise<void>;
}

/** 创建绑定到日志路径的事件流。 */
export function createEventLog(path: string): EventLog {
  return {
    async append(event) {
      if (!event || typeof event.type !== "string" || !KNOWN_TYPES.has(event.type)) {
        throw new Error(`未知事件类型: ${JSON.stringify((event as { type?: unknown })?.type)}`);
      }
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
}

/** 重放：按写入顺序读回全部事件。untilEventId 给定时只重放到该事件点（含）。
 * 事件 id = 1-based 行号（append-only 保证永不漂移），即「事件点」。 */
export async function replay(path: string, untilEventId?: string): Promise<AgentEvent[]> {
  const raw = await readFile(path, "utf8");
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue; // 容忍文件末尾空行
    events.push(JSON.parse(t) as AgentEvent);
  }
  if (untilEventId === undefined) return events;
  const n = Number(untilEventId);
  if (!Number.isInteger(n) || n < 1 || n > events.length) {
    throw new Error(`无效 untilEventId: ${JSON.stringify(untilEventId)}（会话共 ${events.length} 条事件）`);
  }
  return events.slice(0, n);
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
