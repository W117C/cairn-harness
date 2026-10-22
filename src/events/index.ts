// 事件流：append-only JSONL，一事件一行。
// **公开面（2026-10-17 拆分后逐字不变）**：协议面（类型 + `KNOWN_TYPES`）住 ./types，存储引擎
// （句柄 / 尾行修复 / replay / forkSession）住 ./log，脱敏原语住 ./redact（2026-10-20 抽出，
// 见那里的说明）；本文件按原路径**逐名**再导出——全部消费者
// （src/、apps/desktop/、tests/、scripts/）一行不用动，「这份清单 = 公开面契约」。
// 新增导出请想清楚归属：契约字段进 ./types，存储机制进 ./log；不在此清单里的名字不算公开面。
export type {
  PromoteOrigin, SkillInvocationMeta, GoalTurnOrigin, UserMessageOrigin, UserMessageAttachment,
  UserMessageEvent, AssistantMessageEvent, AssistantDeltaEvent, ThinkingDeltaEvent,
  ToolCallEvent, ToolBlockReason, HarnessHoldReason, ToolResultEvent,
  UsageEvent, SessionMetaEvent,
  ClarifyQuestion, ClarifyAnswerMap, ClarifyRequestedEvent,
  PlanFileChange, PlanProposal, PlanProposedEvent, PlanApprovedEvent,
  VerifyCause, VerifyCommandResult, VerifyResultEvent,
  CompactionUsage, CompactionEvent,
  SecuritySeverity, SecurityConfidence, SecurityCategory, SecurityFinding, SecurityChangeRef,
  SecurityReportEvent, ImpactReportEvent,
  AgentMode, AgentStatus, AgentPermissionMode,
  AgentSpawnedEvent, AgentStatusEvent, AgentMessageEvent, WorkerEvidence, AgentResultEvent,
  ApprovalRequestedEvent, ApprovalResolvedEvent, CardActionEvent, DiffCommentEvent,
  RoutingDecisionEvent,
  AutomationTriggeredEvent, AutomationSkippedEvent, AutomationCompletedEvent,
  RunErrorEvent,
  GoalSetEvent, GoalStoppedEvent, GoalPausedEvent, GoalResumedEvent,
  TurnTruncatedEvent, TurnStopMissingEvent, SurfaceAccountEvent,
  AgentEvent,
} from "./types";
export { AGENT_PERMISSION_MODES, HARNESS_HOLD_PROSE_TOKEN, HARNESS_HOLD_REASONS, TOOL_BLOCK_REASONS, isEnvVerifyCause } from "./types";
export type { EventLog, ForkResult } from "./log";
export {
  closeAllEventLogs, createEventLog, forkSession, hasEventLogHandle, invalidateEventLogHandle,
  mergeAssistantDeltas, replay, replayIncremental, resolveHandle,
} from "./log";
// 脱敏原语（2026-10-20 抽出）：脱敏是**持久化边界**的职责（`./log` 的 append 自己擦），
// 抽成独立模块是为了让 storage engine 不必依赖 agent 层。公开面照旧从这里走。
export {
  redactEventForLog, redactSecrets, SECRET_PATTERNS, findHighEntropyTokens, shannonEntropy,
  DEFAULT_ENTROPY, secretFindings,
} from "./redact";
export type { EntropyOptions, RedactResult, ScanOptions } from "./redact";
// 日志结构控制记录的**投影**（ADR 0005）：控制记录由这一层解释，`replay()` 逐字不动它们。
export { effectiveEvents, sessionMetaPatch } from "./projection";
export { forkSessionPointer, replaySession, SessionReplayError } from "./session";
export type { PointerForkResult, ReplaySessionOptions, SessionReplayErrorCode } from "./session";
