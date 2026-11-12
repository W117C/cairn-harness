// 第 1170 页：工具簇摘要的一次遍历纯函数，与旧「4 次 filter + 1 次 reduce」逐字段等值。
// 旧口径取自 Stream.tsx 改前的 toolStatusOf 优先级（中断 > 执行中 > 失败 > 完成 > 未知）
// 与「只累加两端都可信的调用」；这里直接在测试里复刻旧算法做对照，不 import 组件。
import { describe, expect, it } from "vitest";
import { collectToolClusterStats } from "../src/renderer/derived/tool-cluster-stats";

interface Row { seq: number; interrupted?: boolean; pending?: boolean; ok?: boolean; ts?: number; then?: number; }

function oldStatusOf(r: Row): string {
  if (r.interrupted) return "interrupted";
  if (r.pending) return "pending";
  if (r.ok === false) return "failed";
  if (r.ok === true) return "done";
  return "unknown";
}

function oldFivePass(rows: Row[]) {
  const pending = rows.filter((r) => oldStatusOf(r) === "pending");
  const failures = rows.filter((r) => oldStatusOf(r) === "failed");
  const interrupted = rows.filter((r) => oldStatusOf(r) === "interrupted");
  const unknown = rows.filter((r) => oldStatusOf(r) === "unknown");
  const totalMs = rows.reduce((sum, r) => {
    if (r.ts === undefined || r.then === undefined) return sum;
    if (!Number.isFinite(r.ts) || !Number.isFinite(r.then) || r.then < r.ts) return sum;
    return sum + (r.then - r.ts);
  }, 0);
  return { pending, failures, interrupted, unknown, latest: pending.at(-1), failure: failures.at(-1), totalMs };
}

const ROWS: Row[] = [
  { seq: 0, ok: true, ts: 1_000, then: 1_500 },
  { seq: 1, pending: true, ts: 1_500 },
  { seq: 2, ok: false },
  { seq: 3, interrupted: true, ok: false },
  { seq: 4, pending: true, ts: 2_000, then: 2_400 },
  { seq: 5 },
  { seq: 6, ok: false, ts: 3_000, then: 2_000 },
  { seq: 7, ok: true, ts: Number.NaN, then: 4_000 },
  { seq: 8, pending: true, ts: 4_000, then: 4_250 },
];

describe("collectToolClusterStats（工具簇一次遍历）", () => {
  it("四桶、桶内末行与总耗时与旧五遍扫描逐项等值", () => {
    const got = collectToolClusterStats(ROWS, oldStatusOf);
    const old = oldFivePass(ROWS);
    expect(got.pending.map((r) => r.seq)).toEqual(old.pending.map((r) => r.seq));
    expect(got.failed.map((r) => r.seq)).toEqual(old.failures.map((r) => r.seq));
    expect(got.interrupted.map((r) => r.seq)).toEqual(old.interrupted.map((r) => r.seq));
    expect(got.unknown.map((r) => r.seq)).toEqual(old.unknown.map((r) => r.seq));
    expect(got.latestPending?.seq).toBe(old.latest?.seq);
    expect(got.lastFailure?.seq).toBe(old.failure?.seq);
    expect(got.totalMs).toBe(old.totalMs);
    // 反对照：总耗时并非「所有行 ts/then 之差的和」，负跨度与缺字段必须不计。
    expect(got.totalMs).toBe(500 + 400 + 250);
  });

  it("状态优先级与空输入：中断压过 pending/ok，空簇全零不放假值", () => {
    const got = collectToolClusterStats([{ seq: 0, interrupted: true, pending: true, ok: false }], oldStatusOf);
    expect(got.interrupted.map((r) => r.seq)).toEqual([0]);
    expect(got.pending).toEqual([]);
    expect(got.failed).toEqual([]);
    const empty = collectToolClusterStats([], oldStatusOf);
    expect(empty.pending).toEqual([]);
    expect(empty.failed).toEqual([]);
    expect(empty.interrupted).toEqual([]);
    expect(empty.unknown).toEqual([]);
    expect(empty.latestPending).toBeUndefined();
    expect(empty.lastFailure).toBeUndefined();
    expect(empty.totalMs).toBe(0);
  });
});
