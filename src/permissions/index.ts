import type { ToolName } from "../tools";

export type PermissionMode = "read-only" | "default" | "auto";
export type Decision = "allow" | "ask" | "deny";

// ---- M1c 自治等级：规则库 / 风险三通道 / 评估管线 / scope / 断路器（§11.7）----
export {
  loadPermissionRules,
  savePermissionRules,
  parsePermissionsFile,
  globalPermissionsPath,
  judgeChain,
  splitCommandChain,
  normalizeCommand,
  type PermissionRule,
  type RuleBehavior,
  type ChainVerdict,
} from "./rules";
export {
  staticRisk,
  modelRisk,
  sandboxRisk,
  isNetworkCommand,
  maxRisk,
  THREAT_TABLE,
  type RiskLevel,
  type RiskFinding,
  type ThreatCategory,
} from "./risk";
export {
  evaluate,
  newAutonomySession,
  noteScopeApproval,
  noteManualDecision,
  noteCriticalDenial,
  noteCriticalResolved,
  downgradeSuggestion,
  toolTableFor,
  scopeKey,
  isNetworkCommandCall,
  isSideEffectTool,
  MAX_AUTO_APPROVALS,
  CRITICAL_DENIAL_LIMIT,
  type AutonomySession,
  type AutoMeta,
  type AskScope,
  type EvaluateDecision,
  type ToolResultWithAudit,
} from "./autonomy";

// ---- 方案门状态（M1b）：存在未批准 plan 时，副作用工具在权限层被拒 ----
// 状态是会话级的单一事实源：gate()（loop 路径）与 checkPermission()（gatedTool 路径）
// 双口生效，调用方零改动拿到写禁。只读工具与门工具（clarify/propose_plan/verify）不受拦。
export interface PlanState {
  /** 已有 plan 提交（尚未批准）。 */
  proposed: boolean;
  /** plan 已获批。 */
  approved: boolean;
}

let planState: PlanState = { proposed: false, approved: false };

export function getPlanState(): PlanState {
  return { ...planState };
}

/** propose_plan 工具落计划时调用：进入「未批准即写禁」状态。 */
export function markPlanProposed(): void {
  planState = { proposed: true, approved: false };
}

/** 批准当前 plan：解锁写工具。 */
export function approvePlan(): void {
  planState = { proposed: true, approved: true };
}

/** 回到无 plan 状态（新会话/测试复位用）。 */
export function resetPlanState(): void {
  planState = { proposed: false, approved: false };
}

function planBlocks(): boolean {
  return planState.proposed && !planState.approved;
}

function isSideEffectTool(tool: ToolName): boolean {
  return tool === "write_file" || tool === "edit_file" || tool === "run_shell";
}

// 原始判定：read_file 与三门工具（clarify/propose_plan/verify）不产生用户数据副作用，任何档都放行；
//   write_file / run_shell 有副作用：
//     方案门：存在未批准 plan → 一律 deny（唯一有强制力的门，先批后写）
//     read-only：副作用工具一律 deny
//     default  ：副作用工具 ask（交互模式下问人）
//     auto     ：全放行
export function checkPermission(mode: PermissionMode, tool: ToolName): Decision {
  if (!isSideEffectTool(tool)) return "allow";
  if (planBlocks()) return "deny";
  if (mode === "read-only") return "deny";
  if (mode === "default") return "ask";
  return "allow";
}

// 实际执行前的门：非交互模式下 ask 一律按 deny（fail-closed）。
export function gate(mode: PermissionMode, tool: ToolName, interactive: boolean): Decision {
  const decision = checkPermission(mode, tool);
  if (decision === "ask" && !interactive) return "deny";
  return decision;
}

/** 拒绝原因（deny 时给人看的一句话；null = 未拒绝）。 */
export function denyReason(tool: ToolName): string | null {
  if (isSideEffectTool(tool) && planBlocks()) return "存在未批准 plan（方案门：先批后写）";
  return null;
}
