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
  "full-access": "allow",
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
  planPendingFromEvents,
  seedPendingPlanFromEvents,
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

/** remember（记忆写入）的裁决口径——**主会话与 worker 共用这一份**。
 *
 *  为什么必须是**一份**（2026-10-20 独立评审追出）：旧形状两处各判各的，
 *  而且**漂的方向是 worker 那条更松**——主会话的 remember 走
 *  `createGatedRemember`（方案门 → 档位表 → **全局层要人点头**），
 *  worker 的 remember 只过 `evaluate`，而 `remember` 不在 `SIDE_EFFECT_TOOLS` 里
 *  ⇒ 既不是写向（方案门/只读档都不管它）、风险也是 none ⇒ **L4-pass 放行**。
 *  实测：worker 一次 `remember {scope:"global"}` **连卡都不出**就把模型控制的文本
 *  写进了全局层，而全局索引会被注入到**每一个项目**的每一场会话（跨项目注入）。
 *  同一个工具、同一件事，两个出口两个结论——**门只对一半的出口有效**。
 *
 *  三条口径（与主会话旧行为逐条一致，不是新政策）：
 *  ① 方案门：先批后写（写记忆也是写）。
 *  ② 只读档：拒写向工具。
 *  ③ 项目层写入免批（2026-10-15 第十一遍业主裁决：只影响当前项目、写入即事件可见、
 *     记忆面板可删 ⇒ 不值得为它烧一张卡）；**全局层要人点头**（它跨项目、跨会话、且
 *     写进去的是模型控制的文本）。
 */
export type RememberDecision = "deny" | "ask" | "allow";
export function rememberDecision(opts: {
  /** remember 的顶层 `scope` 参数（`project` | `global`；非法值由工具层自己拒）。 */
  scope: unknown;
  mode: PermissionMode;
  /** 方案门的**活委托**（闭包，不是快照）。
   *  ⚠️ 这个参数名刻意**不是**「plan + Blocked 连写」的那个名字：那个名字被
   *  `tests/plan-required.test.ts` 的复发闸盯着（全 src 只有 `permissions/autonomy.ts` 能提），
   *  而这里要的是"读当前态"这件事本身。
   *  传**闭包**（每次调用现读）是活委托；传一个布尔快照就是旧语义（把方案门退回成一次性开关），
   *  那正是那条复发闸要挡的写法。 */
  isPlanBlocked: () => boolean;
}): RememberDecision {
  if (opts.isPlanBlocked()) return "deny";
  const decision = SIDE_EFFECT_DECISION[opts.mode] ?? "ask";
  if (decision === "deny") return "deny";
  if (decision === "ask" && opts.scope === "global") return "ask";
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
