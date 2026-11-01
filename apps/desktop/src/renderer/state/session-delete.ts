// 删除会话的「先停再删」等待口径（纯函数，可判卷）。
// 核心对运行中的会话有硬闸（「会话正在运行，先停止再删除」）：取消信号到锁释放是异步的，
// 渲染层不能确认一次就把锁错误当终态。
export const DELETE_RUNNING_WAIT_MS = 5_000;
export const DELETE_RUNNING_POLL_MS = 120;

/** 这条删除失败是「会话还在跑」吗（核心原文 / 英文兜底）。 */
export function isRunningDeleteError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /会话正在运行|已经在运行|正在运行|already running|session is running/iu.test(message);
}

/** 已等待 elapsedMs：还在预算内才继续重试（超时把锁错误如实报给用户）。 */
export function shouldRetryDelete(elapsedMs: number): boolean {
  return elapsedMs < DELETE_RUNNING_WAIT_MS;
}

export interface SessionDeleteResult {
  currentSession: string | null;
}

/** 先停再删的等待环：只有「还在运行」类错误在预算内重试；其他错误立即抛出。
 *  now/sleep 可注入，判卷不必真等 5 秒。 */
export async function deleteSessionWaitingForRun(
  remove: (id: string) => Promise<SessionDeleteResult>,
  id: string,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<SessionDeleteResult> {
  const startedAt = now();
  for (;;) {
    try {
      return await remove(id);
    } catch (err) {
      if (!isRunningDeleteError(err) || !shouldRetryDelete(now() - startedAt)) throw err;
      await sleep(DELETE_RUNNING_POLL_MS);
    }
  }
}
