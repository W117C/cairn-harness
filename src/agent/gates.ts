// 三门的「等人」状态机（纯逻辑、零 electron 依赖，仿 AskGate）。
// clarify / propose_plan 工具挂起等待，驱动方（UI 卡片动作 / gate-check 驱动 / 单测）
// 经 submit / approve / reject 解挂 —— 提交路径与模型 turn 解耦：谁在等就挂给谁，
// 无人等待时提交返回 false（会话已不在等，不误挂）。
import { approvePlan } from "../permissions";
import type { ClarifyAnswerMap } from "../events";

export class ClarifyGate {
  private readonly pending = new Map<string, (answers: ClarifyAnswerMap) => void>();

  get pendingCount(): number {
    return this.pending.size;
  }

  /** clarify 工具调用：登记等待，直到对应表单提交。 */
  wait(callId: string): Promise<ClarifyAnswerMap> {
    return new Promise<ClarifyAnswerMap>((resolve) => {
      this.pending.set(callId, resolve);
    });
  }

  /** 表单提交：把提交值交给等待中的工具调用。返回 false = 该 callId 无人等待。 */
  submit(callId: string, answers: ClarifyAnswerMap): boolean {
    const resolve = this.pending.get(callId);
    if (!resolve) return false;
    this.pending.delete(callId);
    resolve(answers);
    return true;
  }
}

export type PlanDecision = "approved" | "rejected";

export class PlanGate {
  private readonly pending = new Map<string, (decision: PlanDecision) => void>();

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 当前在等批准的 callId（决议事件落盘用；批准/拒绝会结算并清空）。 */
  get pendingIds(): string[] {
    return [...this.pending.keys()];
  }

  /** propose_plan 工具调用：登记等待，直到批准 / 拒绝。 */
  waitApproval(callId: string): Promise<PlanDecision> {
    return new Promise<PlanDecision>((resolve) => {
      this.pending.set(callId, resolve);
    });
  }

  /** 批准：权限层解锁写工具 + 解挂等待中的 propose_plan。 */
  approve(callId?: string): boolean {
    return this.settle(callId, "approved");
  }

  /** 拒绝：plan 状态保持「已提交未批准」（写禁不解除），模型须重新提议再批。 */
  reject(callId?: string): boolean {
    return this.settle(callId, "rejected");
  }

  private settle(callId: string | undefined, decision: PlanDecision): boolean {
    if (this.pending.size === 0) return false;
    if (callId !== undefined) {
      const resolve = this.pending.get(callId);
      if (!resolve) return false;
      this.pending.delete(callId);
      if (decision === "approved") approvePlan();
      resolve(decision);
      return true;
    }
    // 未指定 callId：结算全部等待（同一时刻至多一个 propose_plan 挂起，此为兜底）
    const ids = [...this.pending.keys()];
    if (decision === "approved") approvePlan();
    for (const id of ids) {
      const resolve = this.pending.get(id);
      this.pending.delete(id);
      resolve!(decision);
    }
    return true;
  }
}
