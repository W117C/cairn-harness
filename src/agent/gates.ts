// 三门的「等人」状态机（纯逻辑、零 electron 依赖，仿 AskGate）。
// clarify / propose_plan 工具挂起等待，驱动方（UI 卡片动作 / gate-check 驱动 / 单测）
// 经 submit / approve / reject 解挂 —— 提交路径与模型 turn 解耦：谁在等就挂给谁，
// 无人等待时提交返回 false（会话已不在等，不误挂）。
// H2（审查 A-2）：等待可被取消/超时收束——abort 或超时即拒绝并清 pending，
// 不再让解析器永久泄漏（旧实现 wait() 无出口，取消/超时场景 promise 悬挂）。
import { approvePlan } from "../permissions";
import { ToolError, type GateWaitOptions } from "../tools/base";
import type { ClarifyAnswerMap } from "../events";

/** 等待收束的公共骨架：登记 pending + abort/超时监听 + 三条出口（提交/中止/超时）都先 cleanup。 */
function waitWith<T>(
  pending: Map<string, (v: T) => void>,
  callId: string,
  opts: GateWaitOptions,
  label: string,
  onAbortReject: () => Error,
  onTimeoutReject: (ms: number) => Error,
): Promise<T> {
  const { signal, timeoutMs } = opts;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      pending.delete(callId);
      signal?.removeEventListener("abort", onAbort);
      if (timer !== undefined) clearTimeout(timer);
    };
    const rejectWith = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onAbort = (): void => rejectWith(onAbortReject());
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => rejectWith(onTimeoutReject(timeoutMs)), timeoutMs);
      (timer as { unref?: () => void }).unref?.(); // 看门狗不钉住事件循环（单测/收尾不悬挂）
    }
    pending.set(callId, (v) => {
      cleanup();
      resolve(v);
    });
  });
}

export class ClarifyGate {
  private readonly pending = new Map<string, (answers: ClarifyAnswerMap) => void>();

  get pendingCount(): number {
    return this.pending.size;
  }

  /** clarify 工具调用：登记等待，直到对应表单提交（或取消/超时拒绝）。 */
  wait(callId: string, opts: GateWaitOptions = {}): Promise<ClarifyAnswerMap> {
    return waitWith<ClarifyAnswerMap>(
      this.pending,
      callId,
      opts,
      "clarify",
      () => new ToolError("clarify 等待随会话中止而取消（fail-closed）"),
      (ms) => new ToolError(`clarify 等待超时（${String(ms)}ms，fail-closed）`),
    );
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

  /** propose_plan 工具调用：登记等待，直到批准 / 拒绝（或取消/超时拒绝）。 */
  waitApproval(callId: string, opts: GateWaitOptions = {}): Promise<PlanDecision> {
    return waitWith<PlanDecision>(
      this.pending,
      callId,
      opts,
      "propose_plan",
      () => new ToolError("propose_plan 等待随会话中止而取消（fail-closed）"),
      (ms) => new ToolError(`propose_plan 等待超时（${String(ms)}ms，fail-closed）`),
    );
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
