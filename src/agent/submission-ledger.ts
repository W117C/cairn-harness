// ADR 0005：提交账本仅在本实例存活期内有效。无磁盘存储，不承诺跨重启 exactly-once。
// 调用方按会话持有账本并在会话关闭时释放；claim 的终态不可自动淘汰，否则会重做副作用。
// 2026-11-19 N4 审计改名：`submit` 在本仓有三义（orchestration 提交计划 / gates 答门 /
// 本账本幂等认领），这一支的真语义是「凭 requestId 认领既有提交或登记新提交」⇒ claim。

/** JSON 元组保留会话分域，避免字符串分隔符自身造成碰撞。
 *  provider 若在同一会话内复用 toolCallId，仍会碰撞；调用方不能把它当作新的调用。 */
export function submissionRequestId(scope: string, toolCallId: string): string {
  if (typeof scope !== "string" || scope.length === 0 || typeof toolCallId !== "string" || toolCallId.length === 0) {
    throw new TypeError("提交键必须含非空会话 scope 与 toolCallId");
  }
  return JSON.stringify([scope, toolCallId]);
}

export class SubmissionLedger<T = unknown> {
  private readonly submissions = new Map<string, Promise<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  /** 成功与失败均保留同一 promise。先登记再执行，同步抛错也不会逃过账本。 */
  claim(requestId: string, run: () => T | PromiseLike<T>): Promise<T> {
    const existing = this.submissions.get(requestId);
    if (existing !== undefined) return existing;
    const job = Promise.resolve().then(run);
    this.submissions.set(requestId, job);
    return job;
  }

  /** 仅在飞共享；成功或失败后都可重跑。两种策略独立，调用方须为同一操作固定策略。
   *  与 claim 的分工：claim 的终态粘滞（副作用不重跑），claimOnce 只并在飞段。 */
  claimOnce(requestId: string, run: () => T | PromiseLike<T>): Promise<T> {
    const existing = this.inFlight.get(requestId);
    if (existing !== undefined) return existing;
    const job = Promise.resolve().then(run).finally(() => { this.inFlight.delete(requestId); });
    this.inFlight.set(requestId, job);
    return job;
  }
}
