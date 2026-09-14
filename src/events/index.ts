// 事件流：append-only JSONL，一事件一行。
import { appendFile, mkdir, open, readFile, stat } from "node:fs/promises";
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
  confidence: SecurityConfidence;
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

// ---- M3a 多 agent 编排（§3.4 / §4.4）：agent 子流事件 + 审批事件协议 ----
// 子流纪律（§4.4.9 / 任务书裁决 1）：worker 事件落主会话 JSONL——agent_* 事件 + 该 worker 的
// tool_call/tool_result/usage 均带 agent_id；agent_spawned 携 parent_event_id（spawn tool_call 的
// 1-based 事件 id）建立血缘树。心跳 = 子流 tool_call/tool_result 天然时间戳，不造独立心跳事件。

/** spawn_agent 的 mode（§4.1）：M3a 只接入 read；write/pipeline spawn 即拒绝（M3b）；M5c supervise（受限自适应循环）。 */
export type AgentMode = "read" | "write" | "pipeline" | "supervise";
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
  /** M3b write mode：worktree 主 checkout 根相对路径（.agents/wt-<agent_id>）。 */
  worktree?: string;
  /** M3b write mode：spawn 时主 checkout HEAD（diff 与合并的对比基线）。 */
  base_commit?: string;
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
  artifacts: {
    report?: string;
    files_changed?: string[];
    /** M3b write mode：diff 出处引用（worktree 路径@base_commit）；diff 本体只进 git 面板（§4.4.4）。 */
    diff_ref?: string;
    /** M3c 崩溃恢复（§4.4.9）：reason=interrupted 时携带原 spawn 参数（恢复卡「重派」的数据源）。 */
    respawn?: { mode: string; task: string; resources?: string[]; max_turns?: number; tier?: string; model?: string };
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
  | CardActionEvent
  | DiffCommentEvent
  | RoutingDecisionEvent
  | AutomationTriggeredEvent
  | AutomationSkippedEvent
  | AutomationCompletedEvent;

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
  "diff_comment",
  "routing_decision",
  "automation_triggered",
  "automation_skipped",
  "automation_completed",
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
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
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
  if (midBad.length > 0) {
    throw new Error(
      `会话日志有 ${String(midBad.length)} 条非尾部坏行（首在第 ${String(midBad[0])} 行）：跳过会使事件 id 与 1-based 行号错位，` +
        `血缘/分支/压缩 id 全部失准，请修复该文件或从备份恢复: ${path}`,
    );
  }
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
// 语义与 replay 逐位一致：坏行/空行跳过照旧占字节；半写尾行留待下次（append 写整行，通常为空）。
// 投影本身仍是每轮全量（O(n)），增量折叠需处理 compaction 失效语义——收口留位第三批。
const replayCache = new Map<string, { ino: number; offset: number; events: AgentEvent[] }>();
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
    let offset = 0;
    const allParts = raw.split("\n");
    const completeInit = raw === "" ? [] : allParts.slice(0, -1); // 最后一段是尾行（空串或半写）
    for (const line of completeInit) {
      offset += Buffer.byteLength(line, "utf8") + 1; // 完整行都推进偏移（含空行/坏行）
      const t = line.trim();
      if (!t) continue;
      const e = parseReplayLine(t);
      if (e) events.push(e);
    }
    if (replayCache.size >= REPLAY_CACHE_MAX) {
      const oldest = replayCache.keys().next().value;
      if (oldest !== undefined) replayCache.delete(oldest);
    }
    const entry = { ino: st.ino, offset: Math.min(offset, st.size), events };
    replayCache.set(path, entry);
    return entry.events.slice(); // 交副本：消费方排序/清空不得影响缓存
  }
  // 增量：只读上次偏移之后的完整行（半写尾行留待完整落盘——不推进偏移、不重复解析）
  const len = st.size - cached.offset;
  if (len <= 0) return cached.events.slice();
  const fh = await open(path, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, cached.offset);
    const text = buf.toString("utf8");
    const parts = text.split("\n");
    let consumed = 0;
    for (const line of parts.slice(0, -1)) { // 最后一段是尾行（空串=到 EOF；否则半写）
      consumed += Buffer.byteLength(line, "utf8") + 1;
      const t = line.trim();
      if (!t) continue;
      const e = parseReplayLine(t);
      if (e) cached.events.push(e);
    }
    cached.offset += consumed;
  } finally {
    await fh.close();
  }
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
