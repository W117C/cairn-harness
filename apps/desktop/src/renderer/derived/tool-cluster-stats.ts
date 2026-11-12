// 派生层·工具簇摘要（第 1170 页）：一次遍历产出状态桶、各桶最后一行与可信总耗时。
// 纪律：状态判定复用调用方注入的同一个 status 函数（与单行/簇计数同源），不另写布尔组合；
// 派生层不 import components/，也不 import 文案表——只吃行形状与纯函数。

export interface ClusterTimedRow { ts?: number; then?: number; }

export interface ToolClusterStats<T> {
  pending: T[]; failed: T[]; interrupted: T[]; unknown: T[];
  latestPending: T | undefined; lastFailure: T | undefined;
  totalMs: number;
}

/** 一次遍历分桶；totalMs 只累加两端都可信的调用（与单行 tDur、旧簇摘要同一口径），不补零。 */
export function collectToolClusterStats<T extends ClusterTimedRow>(
  rows: readonly T[],
  statusOf: (row: T) => string,
): ToolClusterStats<T> {
  const stats: ToolClusterStats<T> = {
    pending: [], failed: [], interrupted: [], unknown: [],
    latestPending: undefined, lastFailure: undefined, totalMs: 0,
  };
  for (const r of rows) {
    switch (statusOf(r)) {
      case "pending": stats.pending.push(r); break;
      case "failed": stats.failed.push(r); break;
      case "interrupted": stats.interrupted.push(r); break;
      case "unknown": stats.unknown.push(r); break;
    }
    if (r.ts === undefined || r.then === undefined) continue;
    if (!Number.isFinite(r.ts) || !Number.isFinite(r.then) || r.then < r.ts) continue;
    stats.totalMs += r.then - r.ts;
  }
  stats.latestPending = stats.pending.at(-1);
  stats.lastFailure = stats.failed.at(-1);
  return stats;
}
