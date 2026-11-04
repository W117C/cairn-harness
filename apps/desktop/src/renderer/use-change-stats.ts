// 改动行数（交付卡按 DSH 官方 ChangedFiles 口径，2026-11-03）。
//
// DSH 的块头直接读 Host 的 changes 摘要（每个文件自带 added/deleted）；Cairn 没有那条摘要路由，
// 只有逐文件的 changeDiff（读快照+当前文件算 hunk）。这里按文件懒取并缓存到本次挂载，
// 失败/二进制/过大都如实分类——不拿 0 冒充「无改动」，也不把截断的 hunk 数当完整行数。
import { useEffect, useState } from "react";
import type { ChangeDiffPayload } from "../../../../src/main/change-diff";
import { diffCount } from "./change-diff-state";

export type ChangeStat =
  | { kind: "loading" }
  | { kind: "counts"; add: number; del: number }
  | { kind: "binary" }
  | { kind: "oversized" }
  | { kind: "error"; message: string };

export const classifyChangeStat = (payload: ChangeDiffPayload | null | undefined): ChangeStat => {
  if (payload === null || payload === undefined) return { kind: "error", message: "通道无应答（主进程未返回差异数据）" };
  if (payload.ok !== true) {
    return payload.error.includes("二进制")
      ? { kind: "binary" }
      : { kind: "error", message: payload.error };
  }
  // 截断不冒充完整行数：DSH 对超帽文件也显示「过大」而不是给一个偏小的 +N。
  if (payload.truncated) return { kind: "oversized" };
  const c = diffCount(payload.hunks);
  return { kind: "counts", add: c.add, del: c.del };
};

export interface ChangeStatsResult {
  stats: Record<string, ChangeStat>;
  /** 预览用：成功读取的完整 hunk 载荷（同一请求不重复读）。 */
  payloads: Record<string, ChangeDiffPayload>;
}

/** 每个 path 一条状态；同一 path 的重复请求只发一次（按 path+snapshot 去重）。 */
export function useChangeStats(files: readonly { path: string; snapshotId?: string }[]): ChangeStatsResult {
  const [stats, setStats] = useState<Record<string, ChangeStat>>({});
  const [payloads, setPayloads] = useState<Record<string, ChangeDiffPayload>>({});
  const signature = files.map((f) => `${f.path}\u0000${f.snapshotId ?? ""}`).join("\u0001");
  useEffect(() => {
    let alive = true;
    if (files.length === 0) {
      setStats({});
      setPayloads({});
      return () => { alive = false; };
    }
    setStats(Object.fromEntries(files.map((f) => [f.path, { kind: "loading" } as const])));
    setPayloads({});
    for (const f of files) {
      void window.agent
        .changeDiff({ path: f.path, ...(f.snapshotId !== undefined ? { snapshotId: f.snapshotId } : {}) })
        .then(
          (payload) => {
            if (!alive) return;
            setStats((prev) => ({ ...prev, [f.path]: classifyChangeStat(payload) }));
            if (payload !== null && payload !== undefined && payload.ok === true) {
              setPayloads((prev) => ({ ...prev, [f.path]: payload }));
            }
          },
          (err: unknown) => {
            if (!alive) return;
            setStats((prev) => ({
              ...prev,
              [f.path]: { kind: "error", message: err instanceof Error ? err.message : String(err) },
            }));
          },
        );
    }
    return () => { alive = false; };
    // signature 包含 path+snapshotId；files 数组本身每次渲染新引用，不能进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return { stats, payloads };
}
