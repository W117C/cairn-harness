// 一轮的自动仲裁（发言权在**编排引擎**里的调用点；设计规格 §2 / ADR 0015 §四 第三件）。
//
// 形状故意做到最小：引擎在每次 dispatch 波之前问一次「这一轮开不开、按什么顺序派」，
// 别的什么都不问。这样仲裁可以来自团队档案（`planRound`），也可以来自将来别的策略，
// 而引擎不需要知道成员、主持、静默这些词。
//
// 三条纪律：
//  ① 缺席仲裁器 ⇒ 引擎行为零变化（默认路径不受影响）；
//  ② 仲裁器自己抛错 ⇒ **fail-open**（这一轮照常派，reason 留痕）——不能因为一个策略坏了就把活卡死；
//  ③ `paused` ⇒ 引擎不派，并落一条 `needs_you` 状态：停要有原因，人和 UI 都看得见。
import type { AgentPermissionMode } from "../events/types";
import { planRound, type RoundMember } from "./speech";

export interface RoundArbitrationInput {
  plan_id: string;
  version: number;
  /** 这一轮准备派发的任务 id（顺序即调度器给的顺序）。 */
  task_ids: string[];
}

export interface RoundDecision {
  paused: boolean;
  reason?: string;
  /** 只改派发顺序（并发与依赖不变）。缺席 = 保持调度器顺序。 */
  order?: string[];
}

export type RoundArbiter = (input: RoundArbitrationInput) => Promise<RoundDecision> | RoundDecision;

export interface TeamRoundPolicyInput {
  /** 团队名单（成员档案投影出来的那一份）。 */
  members: readonly { id: string; role: string; tier?: AgentPermissionMode }[];
  /** 连续零工具调用轮数（空转守卫的读数；调用方给）。 */
  idleRounds?: number;
  idleLimit?: number;
}

/**
 * 把团队名单变成引擎能用的仲裁器：主持（角色里写「主持」）先派，其余按名单顺序；
 * 空转到阈值 ⇒ 整轮停机。顺序只影响派发次序，不改并发。
 */
export function teamRoundArbiter(policy: TeamRoundPolicyInput): RoundArbiter {
  return (input: RoundArbitrationInput): RoundDecision => {
    const members: RoundMember[] = policy.members.map((m) => ({ id: m.id, chair: /主持/.test(m.role) }));
    const plan = planRound({
      members,
      mode: "chairFirst",
      ...(policy.idleRounds === undefined ? {} : { idleRounds: policy.idleRounds }),
      ...(policy.idleLimit === undefined ? {} : { idleLimit: policy.idleLimit }),
    });
    if (plan.paused) {
      return { paused: true, reason: "空转已达阈值：这一轮停机等人（发言权的空转守卫）" };
    }
    // 任务不是成员：只取「谁先说」这件事——把第一批发言者对应的任务提前，其余保持原序。
    const first = plan.batches[0]?.speakers ?? [];
    const order = [...input.task_ids].sort((a, b) => {
      const ia = first.indexOf(a);
      const ib = first.indexOf(b);
      const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
      const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
      return ra - rb;
    });
    return { paused: false, order };
  };
}
