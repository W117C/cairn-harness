// M5c 受限 Supervisor（§m5-proposal 步骤 11，闭合 M3 gate loopback）。
// V1 纯规则实现，不调 LLM——动作空间是**封闭枚举**（保住可验证性的关键）：
//   A 封闭性：任意输入（含畸形 report）→ 输出必属枚举；非法输入 → escalate（fail-visible，不静默猜）
//   B 有界性三重保险：maxStages（缺省 6）+ 预算闸（budgetBlocked）+ 同 (role, task-hash) 重复 ≥3 次强制 escalate
// 若 M6 上 LLM 版：输出必须过 schema 校验 + 动作白名单，非法动作一律 escalate——枚举与保险原样保留，只换决策函数。
// 审批面双轨（§5.1）：supervise 模式审批卡批准 { goal, budget, forbidden, maxStages }，
// 与 pipeline 的 stages 全表审批语义**分开**——不动旧模式（agents-check N1c–N1d / N5 冻结语义不变红）。
import type { WorkerEvidence } from "../events";
import type { StageVerdict as ProseVerdict } from "./sequencer";

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
  /** 前环判据（由 `ringVerdict` 从机器凭据 / 契约行算出；无判据 → null → escalate）。 */
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
  // 无判据 → escalate（fail-visible，不静默猜。原因句不写「报告畸形」：implement 角色的任务书
  // 本来就不要求 verdict 行，把契约缺口说成模型的错，等于把缺陷记在它账上——真语料里三次复跑
  // 全死在这条，而三次的 agent_result 都是 status=done 且改动正确）。
  if (ctx.verdict !== "pass" && ctx.verdict !== "fail" && ctx.verdict !== "error") {
    return { kind: "escalate", why: "无判据（既没有机器验证凭据，报告也没有 verdict 契约行），升级人工裁决" };
  }
  if (ctx.verdict === "pass") return { kind: "accept" };
  // fail/error → 有前一环则 retry，否则 spawn 下一环（错误永不冒充结果）
  if (ctx.lastAgentId !== undefined && ctx.lastAgentId !== "") {
    return { kind: "retry", agent_id: ctx.lastAgentId, feedback: ctx.lastFailure ?? "前环失败，重试" };
  }
  return { kind: "spawn", role: ctx.nextRole ?? "implement", task: "重试失败环" };
}

/** 环判据的来源规则：**这一环有机器凭据就只认机器凭据**（`artifacts.verified`，W4b 四态，
 *  纯投影自 worker 自己的子流），凭据缺席时才回落到报告里的 verdict 契约行。
 *  为什么要回落：`absent` 有两种成因，本机分不开——⑴ 仓库根本没有可验面（无 config verify 字段、
 *  package.json 无 lint/test，收束闸按设计整段跳过），这时散文是唯一读物；⑵ 该跑而没跑
 *  （今天最大的一支：改动经 `run_shell` 落盘，而写向判定只看 write_file/edit_file 工具事件）。
 *  ⑵ 已单独立项去修（见 `mayHaveWrittenDisk`）；修完后 `absent` 只剩 ⑴，回落面自然收窄。
 *  `stale` **不回落到散文**：那里凭据是存在且被推翻的（绿拍之后又写了盘），过期证据不得当证据用。
 *  `forbiddenViolated` 先于一切：触碰禁改面是契约违反，不因凭据绿而翻面。 */
export function ringVerdict(ctx: {
  evidence: WorkerEvidence | undefined;
  prose: ProseVerdict;
  forbiddenViolated: boolean;
}): "pass" | "fail" | null {
  if (ctx.forbiddenViolated) return "fail";
  if (ctx.evidence === "verified") return "pass";
  if (ctx.evidence === "failed") return "fail";
  if (ctx.evidence === "stale") return null;
  return ctx.prose === "pass" ? "pass" : ctx.prose === "fail" ? "fail" : null;
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
