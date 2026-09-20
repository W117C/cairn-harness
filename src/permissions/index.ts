import type { ToolName } from "../tools";
// C9（审查根因 2）：能力域判定唯一实现——旧的模块内私有副本只认三个字面工具名（缺 shell_rw），
// 使 loop 路径（checkPermission/gate/denyReason）对 shell 家族新成员失效。删副本统一从 autonomy 导入。
import { isSideEffectTool } from "./autonomy";
import { planGateBlocks, currentPlanState } from "./plan-state";

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
  isWriteCall,
  MAX_AUTO_APPROVALS,
  CRITICAL_DENIAL_LIMIT,
  type AutonomySession,
  type AutoMeta,
  type AskScope,
  type EvaluateDecision,
  type McpGrade,
  type ToolResultWithAudit,
} from "./autonomy";

// ---- 方案门状态（M1b）：状态与判据住在 plan-state.ts，这里原样再导出 ----
// 为什么抽出去：权限评估层（autonomy.ts）也要读这份状态，而它不能 import 本文件（本文件正 re-export
// autonomy 的符号 = 循环）。上一版它读的是调用方手动刷新的镜像布尔，worker 那一路从不刷新 ⇒
// 「先批后写」对 spawn 出的 worker 失效。现在两端共用 planGateLive() 这一份活判据。
export {
  planGateBlocks,
  enterPlanRunScope,
  runWithPlanScope,
  getPlanState,
  markPlanProposed,
  approvePlan,
  resetPlanState,
  type PlanState,
} from "./plan-state";

function planBlocks(): boolean {
  return planGateBlocks(currentPlanState());
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
  if (isSideEffectTool(tool) && planBlocks()) return "方案门：先批后写（当前没有已批准的方案）";
  return null;
}
