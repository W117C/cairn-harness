// M5c 受限 Supervisor（§m5-proposal 步骤 11，闭合 M3 gate loopback）。
// V1 纯规则实现，不调 LLM——动作空间是**封闭枚举**（保住可验证性的关键）：
//   A 封闭性：任意输入（含畸形 report）→ 输出必属枚举；非法输入 → escalate（fail-visible，不静默猜）
//   B 有界性三重保险：maxStages（缺省 6）+ 预算闸（budgetBlocked）+ 同 (role, task-hash) 重复 ≥3 次强制 escalate
// 若 M6 上 LLM 版：输出必须过 schema 校验 + 动作白名单，非法动作一律 escalate——枚举与保险原样保留，只换决策函数。
// 审批面双轨（§5.1）：supervise 模式审批卡批准 { goal, budget, forbidden, maxStages }，
// 与 pipeline 的 stages 全表审批语义**分开**——不动旧模式（agents-check N1c–N1d / N5 冻结语义不变红）。

/** 封闭动作空间（唯一合法输出形态）。 */
export type SupervisorAction =
  | { kind: "spawn"; role: string; task: string }
  | { kind: "retry"; agent_id: string; feedback: string }
  | { kind: "accept" }
  | { kind: "escalate"; why: string }
  | { kind: "abort"; why: string };

export const SUPERVISOR_ACTION_KINDS = ["spawn", "retry", "accept", "escalate", "abort"] as const;

export type StageVerdict = "pass" | "fail" | "error";

export interface SupervisorContext {
  /** 前环 verdict（复用 parseVerdict 语义；畸形 report → null → escalate）。 */
  verdict: StageVerdict | null;
  /** 已用环数（1-based）。 */
  stageCount: number;
  /** 有界保险①：最大环数（缺省 6；超限 abort）。 */
  maxStages?: number;
  /** 有界保险②：会话预算闸（复用 orchestrator.budgetBlocked；超限 abort）。 */
  budgetBlocked?: boolean;
  /** 有界保险③：同 (role, task-hash) 出现次数（≥3 次强制 escalate，防死循环）。 */
  repeatCount?: number;
  /** 前一环 agent_id（retry 目标）。 */
  lastAgentId?: string;
  /** 前一环失败摘要（feedback 载体）。 */
  lastFailure?: string;
  /** 下一环角色（verdict=fail 且无 lastAgentId 时 spawn 用）。 */
  nextRole?: string;
}

/** 纯规则决策（V1 不调 LLM）：预算 > maxStages > 重复防死循环 > 畸形 escalate > verdict。 */
export function decideSupervisor(ctx: SupervisorContext): SupervisorAction {
  const maxStages = ctx.maxStages ?? 6;
  // 有界②：预算超限 → abort（复用 M3c budgetBlocked 闸）
  if (ctx.budgetBlocked) return { kind: "abort", why: "预算超限（maxBudgetUsd），编排中止" };
  // 有界①：环数耗尽 → abort
  if (ctx.stageCount >= maxStages) return { kind: "abort", why: "maxStages 耗尽（" + String(maxStages) + "），编排中止" };
  // 有界③：同任务第三次出现 → 强制 escalate（防死循环）
  if ((ctx.repeatCount ?? 0) >= 3) return { kind: "escalate", why: "同 (role, task-hash) 重复 ≥3 次，强制升级人工裁决" };
  // 畸形 report → escalate（fail-visible，不静默猜；verdict 必须为三态之一）
  if (ctx.verdict !== "pass" && ctx.verdict !== "fail" && ctx.verdict !== "error") {
    return { kind: "escalate", why: "report 畸形（verdict 不可解析），升级人工裁决" };
  }
  if (ctx.verdict === "pass") return { kind: "accept" };
  // fail/error → 有前一环则 retry，否则 spawn 下一环（错误永不冒充结果）
  if (ctx.lastAgentId !== undefined && ctx.lastAgentId !== "") {
    return { kind: "retry", agent_id: ctx.lastAgentId, feedback: ctx.lastFailure ?? "前环失败，重试" };
  }
  return { kind: "spawn", role: ctx.nextRole ?? "implement", task: "重试失败环" };
}

/** 封闭性判定：任意输出都必须落进枚举（supervisor-check A 的判定基底）。 */
export function isSupervisorAction(a: unknown): a is SupervisorAction {
  if (typeof a !== "object" || a === null) return false;
  const r = a as { kind?: unknown };
  if (typeof r.kind !== "string" || !(SUPERVISOR_ACTION_KINDS as readonly string[]).includes(r.kind)) return false;
  return true;
}

/** supervise 模式的审批契约（§5.1 双轨：与 pipeline 的 stages 全表审批分开；renderer 接线留 M6）。 */
export interface SuperviseApprovalContract {
  goal: string;
  budget: number;
  forbidden: string[];
  maxStages: number;
}

/** 契约摘要（审批卡必显的最小面；与 pipeline 的「stages 全表」形态可区分）。 */
export function superviseApprovalDigest(c: SuperviseApprovalContract): string {
  return (
    "supervise 授权：goal=" + c.goal.slice(0, 60) +
    " budget=$" + String(c.budget) +
    " forbidden=" + (c.forbidden.length > 0 ? c.forbidden.join(",") : "无") +
    " maxStages=" + String(c.maxStages)
  );
}
