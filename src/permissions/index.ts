import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolName } from "../tools";
// C9（审查根因 2）：能力域判定唯一实现——旧的模块内私有副本只认三个字面工具名（缺 shell_rw），
// 使 loop 路径（checkPermission/gate/denyReason）对 shell 家族新成员失效。删副本统一从 autonomy 导入。
import { isSideEffectTool } from "./autonomy";

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
// P1（审查）：plan 门状态挂 run 级 AsyncLocalStorage——并发 run（交互 vs 定时 unattended）各持
// 独立 plan 态：A 会话的未批准 plan 不再拦死 B run 的写工具，A 的批准也不再解锁 B。
// run 外遗留路径（脚本/测试直调）回落模块态，行为不变。
const planScopeALS = new AsyncLocalStorage<{ state: PlanState }>();

/** 进入 run 级 plan 门作用域（agent-runner 在 runAgent 入口与 RunScope 同点接线）。 */
export function enterPlanRunScope(): void {
  planScopeALS.enterWith({ state: { proposed: false, approved: false } });
}

/** 在全新隔离 plan 作用域内执行 fn（als.run 语义：不泄漏到调用方上下文；测试/工具用）。 */
export function runWithPlanScope<T>(fn: () => T): T {
  return planScopeALS.run({ state: { proposed: false, approved: false } }, fn);
}

function currentPlanState(): PlanState {
  return planScopeALS.getStore()?.state ?? planState;
}

function setPlanState(next: PlanState): void {
  const scope = planScopeALS.getStore();
  if (scope) scope.state = next;
  else planState = next;
}

export function getPlanState(): PlanState {
  return { ...currentPlanState() };
}

/** propose_plan 工具落计划时调用：进入「未批准即写禁」状态。 */
export function markPlanProposed(): void {
  setPlanState({ proposed: true, approved: false });
}

/** 批准当前 plan：解锁写工具。propose_plan 工具在收到 approved 决议后于 run 链内调用——
 *  决议处理器（IPC/gate-check）不在本 run 异步链内，plan 态已 run 级隔离，谁的 plan 谁解锁。 */
export function approvePlan(): void {
  setPlanState({ proposed: true, approved: true });
}

/** 回到无 plan 状态（新会话/测试复位用）。 */
export function resetPlanState(): void {
  setPlanState({ proposed: false, approved: false });
}

function planBlocks(): boolean {
  const ps = currentPlanState();
  return ps.proposed && !ps.approved;
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
