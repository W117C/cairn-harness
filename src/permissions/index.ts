import type { ToolName } from "../tools";
// C9（审查根因 2）：能力域判定唯一实现——旧的模块内私有副本只认三个字面工具名（缺 shell_rw），
// 使 loop 路径（checkPermission/gate/denyReason）对 shell 家族新成员失效。删副本统一从 autonomy 导入。
import { isSideEffectTool } from "./autonomy";
import { planGateBlocks, currentPlanState } from "./plan-state";

/** 档位的集合与类型都在 ./modes（唯一事实源）；这里 re-export 保持既有 import 路径不变。 */
export { PERMISSION_MODES, isPermissionMode, permissionModeRank, type PermissionMode } from "./modes";
import { type PermissionMode } from "./modes";
export type Decision = "allow" | "ask" | "deny";

/** 副作用工具在每一档的**粗档**裁决表（细档政策在 autonomy 的 `MODE_POLICY`，两层各有判卷）。
 *  `Record<PermissionMode, Decision>` ⇒ **少一档就编译不过**，
 *  不再靠"掉到最后一行 return"的运气（那是 §11.7 语义被静默改写的入口）。 */
const SIDE_EFFECT_DECISION: Record<PermissionMode, Decision> = {
  "read-only": "deny",
  default: "ask",
  // guided 在粗档不逐笔问：它拆的正是这一条，「问不问」改由风险线判（autonomy 细档）。
  guided: "allow",
  auto: "allow",
};

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
  autoOf,
  gateBase,
  GATE_LAYERS,
  GATE_VERDICTS,
  modePolicyTable,
  MAX_AUTO_APPROVALS,
  CRITICAL_DENIAL_LIMIT,
  type AutonomySession,
  type AutoMeta,
  type AskScope,
  type EvaluateDecision,
  type GateLayer,
  type GateMeta,
  type GateVerdict,
  type McpGrade,
  type ModePolicy,
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

// ---- 工具名登记册（M7）：判据从四张既有表派生（不手抄），消费者见 autonomy.ts 的未知名分支 ----
export { KNOWN_TOOL_NAMES, isKnownToolName, isMcpScopedName, MCP_SCOPED_PREFIX } from "./tool-registry";

function planBlocks(): boolean {
  return planGateBlocks(currentPlanState());
}

// 原始判定：read_file 与三门工具（clarify/propose_plan/verify）不产生用户数据副作用，任何档都放行；
//   write_file / run_shell 有副作用（逐档裁决见上面的 `SIDE_EFFECT_DECISION`，一行一档）：
//     方案门：存在未批准 plan → 一律 deny（唯一有强制力的门，先批后写）
//     read-only：副作用工具一律 deny
//     default  ：副作用工具 ask（交互模式下问人）
//     guided   ：粗档不拦——它拆掉的正是"每写必问"，问不问由风险线判（autonomy 的 MODE_POLICY）
//     auto     ：全放行
export function checkPermission(mode: PermissionMode, tool: ToolName): Decision {
  // M7 曾在此加「未登记工具名 ⇒ deny」守卫，**已撤回**（理由留在原地，免得有人再加回来）：
  // ① 本函数在生产里只经 `gate()` 到达 loop.ts:401，而它的下一站（loop.ts:423）**已经**是那道闸——
  //    `const tool = (opts.tools ?? TOOLS)[name]` → `unknown tool: <name>` + `blockedBy:"unknown-tool"`。
  //    在这里先拒等于把同一件事判两遍，还让后者的输出永远见不到（实测：`tests/loop.test.ts` 与
  //    `tests/tool-block-witness.test.ts` 各因此红了 1 条，分母证人少印一种 blockedBy）。
  // ② 更硬的约束：`tests/registry-rung.test.ts` 明写「注册表判定只看**本会话**工具表
  //    `opts.tools ?? TOOLS`，不许拿静态 TOOLS 当唯一源」。本函数收不到会话工具表，
  //    在这里做任何 KNOWN_TOOL_NAMES 判断都必然误拒运行期注入的工具（该测试实测红）。
  // 真正的主刀因此在 `evaluate()`（autonomy.ts）：它答「这个名字危不危险」，
  // 不答「这次会话有没有这把工具」。两件事是两种问题，判据与数据源都不同。
  if (!isSideEffectTool(tool)) return "allow";
  if (planBlocks()) return "deny";
  // 未列出的档位值只可能来自未升级的持久化/外部构造者（类型内三档都已列表）。
  // 缺省取 **ask**：非交互时 `gate()` 会把它降成 deny（fail-closed），交互时至少还有人能看见。
  return SIDE_EFFECT_DECISION[mode] ?? "ask";
}

/** 导出给对账判卷：表必须**恰好**覆盖 `PERMISSION_MODES`（少一行 = 有一档没人判过）。 */
export function sideEffectDecisionTable(): Record<PermissionMode, Decision> {
  return { ...SIDE_EFFECT_DECISION };
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
