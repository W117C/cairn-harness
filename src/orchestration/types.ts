/** Versioned orchestration data. Runtime authority is the existing session event log. */
export type Verdict = "pass" | "fail" | "unverifiable";
export type EvidenceState = "verified" | "failed" | "stale" | "absent";
export type TaskPhase = "planned" | "queued" | "running" | "verifying" | "merging" | "done" | "failed" | "cancelled" | "paused" | "needs_you";
export type PlanPhase = "proposed" | "approved" | "paused" | "cancelled" | "rejected";
export interface Budget { usd: number; }
export interface ArtifactRef { id: string; kind: "file" | "blob" | "json" | "url"; hash?: string; }
export interface Capability {
  tools: string[];
  fs_read: string[];
  fs_write: string[];
  network: string[];
  shell: "none" | "read" | "sandboxed";
  git: "none" | "read" | "commit" | "merge";
  external_effects: "none" | "allowlist";
}
export type AcceptanceCheck =
  | { kind: "command"; id: string; run: string; timeout_ms: number }
  | { kind: "artifact"; id: string; artifact_id: string; hash?: string }
  | { kind: "evidence"; id: string; fields: string[] }
  | { kind: "human"; id: string; instruction: string };
export interface Contract {
  acceptance: AcceptanceCheck[];
  effect: "none" | "workspace" | "external";
  idempotency_key?: string;
  rollback?: string;
}
export interface FlowTask {
  task_id: string;
  goal: string;
  non_goals: string[];
  agent_spec: string;
  lane: "read" | "write" | "external";
  depends_on: string[];
  write_scopes: string[];
  inputs: ArtifactRef[];
  contract: Contract;
  budget: Budget;
  max_attempts: number;
  priority: number;
  deadline_ms?: number;
}
export type Expr = { literal: unknown } | { ref: string };
export type FlowNode =
  | { kind: "task"; task: FlowTask }
  | { kind: "sequence" | "parallel"; steps: FlowNode[]; max_concurrency?: number }
  | { kind: "map"; items: Expr; body: FlowNode; max_items: number; max_concurrency?: number }
  | { kind: "branch"; when: Expr; then: FlowNode; else?: FlowNode }
  | { kind: "loop"; while: Expr; max_iterations: number; body: FlowNode }
  | { kind: "race"; steps: FlowNode[] }
  | { kind: "gather"; steps: FlowNode[]; strategy: "all" | "any" | "quorum"; quorum?: number }
  | { kind: "checkpoint"; label: string }
  | { kind: "escalate"; reason: string };
export interface AgentSpec {
  agent_spec_id: string;
  role: string;
  capability: Capability;
  max_turns: number;
}
export interface OrchPlan {
  plan_id: string;
  version: number;
  goal: string;
  non_goals: string[];
  domain: "coding" | "research" | "ops" | "data" | "generic";
  tasks: FlowTask[];
  flow?: FlowNode;
  agents: AgentSpec[];
  budget: Budget;
  max_concurrency: number;
  policy_ref: string;
  created_by: "user" | "planner" | "policy";
}
/** Added only as an optional field on existing event kinds. No new log kind. */
export interface OrchestrationStamp {
  schema_version: 1;
  plan_id: string;
  version: number;
  task_id?: string;
  run_id?: string;
  attempt?: number;
  phase?: TaskPhase;
  actor?: "kernel" | "producer" | "verifier" | "delivery";
  request_id?: string;
  evidence?: EvidenceState;
  verdict?: Verdict;
  revision?: string;
  verifier_id?: string;
  producer_id?: string;
  spent_usd?: number;
  reserved_usd?: number;
  lease_expires_at?: number;
  checks?: VerificationResult["checks"];
  output?: { artifacts: ArtifactRef[]; evidence: Record<string, unknown> };
}
export interface TaskView {
  task: FlowTask;
  summary?: string;
  artifacts?: ArtifactRef[];
  phase: TaskPhase;
  attempt: number;
  run_id?: string;
  agent_id?: string;
  producer_id?: string;
  evidence: EvidenceState;
  verdict?: Verdict;
  revision?: string;
  verifier_id?: string;
  spent_usd: number;
  reserved_usd: number;
  lease_expires_at?: number;
  reason?: string;
  delivered?: boolean;
}
export interface PlanView {
  plan: OrchPlan;
  phase: PlanPhase;
  tasks: Record<string, TaskView>;
  spent_usd: number;
  reserved_usd: number;
  source_event_id: number;
}
export interface OrchestrationView {
  plans: Record<string, PlanView>;
  anomalies: string[];
  last_event_id: number;
  now: number;
}
export type ControlAction = "approve_plan" | "reject_plan" | "pause_plan" | "resume_plan" | "cancel_plan" | "pause_task" | "resume_task" | "cancel_task" | "takeover_task" | "retry_task" | "merge_task" | "reject_merge" | "rollback_task";
export interface ControlCommand {
  request_id: string;
  plan_id: string;
  version: number;
  action: ControlAction;
  task_id?: string;
}
export interface ScheduleAction {
  kind: "dispatch" | "verify" | "merge" | "cancel" | "escalate";
  plan_id: string;
  version: number;
  task_id: string;
  reason?: string;
}
export interface ContextPacket {
  plan_goal: string;
  plan_non_goals: string[];
  task_goal: string;
  task_non_goals: string[];
  inputs: ArtifactRef[];
  write_scopes: string[];
  acceptance: AcceptanceCheck[];
  capability: Capability;
  budget: Budget;
}
export interface ExecutionRequest {
  plan: OrchPlan;
  task: FlowTask;
  run_id: string;
  request_id: string;
  context: ContextPacket;
  signal: AbortSignal;
}
export interface ExecutionResult {
  agent_id: string;
  summary: string;
  revision: string;
  artifacts: ArtifactRef[];
  evidence: Record<string, unknown>;
  spent_usd: number;
}
export interface VerificationResult {
  verdict: Verdict;
  verifier_id: string;
  revision: string;
  checks: { id: string; verdict: Verdict; detail: string }[];
  spent_usd: number;
  results?: import("../events").VerifyCommandResult[];
}
/** Backends must enforce declared capabilities and budget before returning this interface. */
export interface ExecutionBackend {
  id: string;
  max_concurrency: number;
  supports(task: FlowTask, spec: AgentSpec): string | null;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  verify(request: ExecutionRequest, result: ExecutionResult): Promise<VerificationResult>;
  deliver?(request: ExecutionRequest, result: ExecutionResult): Promise<{ revision: string }>;
  rollback?(request: ExecutionRequest): Promise<void>;
}
