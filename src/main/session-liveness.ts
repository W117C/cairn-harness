// 会话日志占用登记（唯一判据）：run 起时登记、收束时摘除；删除/重命名在窗口内登记。
// 独立成模块是为了让 sessions.ts（删除/重命名）与 agent-runner.ts（起跑互斥）共用同一张表，
// 且不制造 sessions ↔ agent-runner 的循环依赖。
import { resolve } from "node:path";

const liveRunPaths = new Set<string>();
const mutatingPaths = new Set<string>();

/** 「这条会话日志正被占用」：run 在跑，或正被删除/重命名。 */
export function isSessionLogBusy(logPath: string): boolean {
  const key = resolve(logPath);
  return liveRunPaths.has(key) || mutatingPaths.has(key);
}

export function markSessionRunLive(logPath: string): void {
  liveRunPaths.add(resolve(logPath));
}

export function unmarkSessionRunLive(logPath: string): void {
  liveRunPaths.delete(resolve(logPath));
}

/** 删除/重命名窗口：读事件、写事件、起跑都要让路（否则写到已 unlink 的 inode）。 */
export function markSessionMutating(logPath: string): void {
  mutatingPaths.add(resolve(logPath));
}

export function unmarkSessionMutating(logPath: string): void {
  mutatingPaths.delete(resolve(logPath));
}
