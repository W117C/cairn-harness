// 变更 diff 的懒加载状态机（2026-10-18 重构）。
//
// 背景：Inspector 的「改动」Tab 与检查器外的「变更」窗格各写了一份
// openKey + loading + changeDiff 的同一段逻辑（同一 IPC 通道、同一种载荷、同一套失败回执）。
// 复制的不只是代码：两份实现都**没有请求序号守卫**——快速点 A 再点 B，A 的迟到响应会覆盖
// B 的展开区（用户看到的是「点 B 展开的是 A 的 diff」）。这里收成唯一实现：
//   · 同一时刻只认最后一个请求（seq 守卫；折叠/撤销也会让在飞响应作废）；
//   · 失败回执统一成 ChangeDiffPayload 的 error 形状（调用方只渲染，不再各拼一句）；
//   · diffCount 与状态机同源导出（墙上的 +n −m 与 Inspector 的同一把尺）。
import { useCallback, useRef, useState } from "react";
import type { ChangeDiffPayload, DiffHunkView } from "../../../../src/main/change-diff";

export interface ChangeDiffState {
  loading: boolean;
  payload: ChangeDiffPayload | null;
}

const IDLE: ChangeDiffState = { loading: false, payload: null };

/** 响应是否仍属于当前展开位（纯函数，判卷直接钉）。 */
export function isCurrentDiffRequest(request: number, current: number): boolean {
  return request === current;
}

/** 逐 hunk 统计（展开区顶部的 `+n −m`）。 */
export function diffCount(hunks: readonly DiffHunkView[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === "add") add += 1;
      else if (l.kind === "del") del += 1;
    }
  }
  return { add, del };
}

export interface LazyChangeDiff {
  /** 当前展开的键（Inspector 用 path；变更窗格用 round:path）。null = 都收起。 */
  openKey: string | null;
  diff: ChangeDiffState;
  /** 点同一键 = 收起；点新键 = 立刻进入 loading，并作废上一笔在飞请求。 */
  toggle: (key: string, path: string, snapshotId?: string) => void;
  /** 收起并作废在飞响应（撤销快照后旧 diff 已失效）。 */
  close: () => void;
}

export function useLazyChangeDiff(): LazyChangeDiff {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [diff, setDiff] = useState<ChangeDiffState>(IDLE);
  const requestSeq = useRef(0);

  const close = useCallback((): void => {
    requestSeq.current += 1; // 让在飞响应作废
    setOpenKey(null);
    setDiff(IDLE);
  }, []);

  const toggle = useCallback((key: string, path: string, snapshotId?: string): void => {
    if (openKey === key) {
      close();
      return;
    }
    const seq = ++requestSeq.current;
    setOpenKey(key);
    setDiff({ loading: true, payload: null });
    void window.agent
      .changeDiff({ path, ...(snapshotId !== undefined ? { snapshotId } : {}) })
      .then(
        (payload) => {
          if (!isCurrentDiffRequest(seq, requestSeq.current)) return;
          setDiff({
            loading: false,
            payload: payload ?? { ok: false, error: "通道无应答（主进程未返回差异数据）" },
          });
        },
        (err: unknown) => {
          if (!isCurrentDiffRequest(seq, requestSeq.current)) return;
          setDiff({
            loading: false,
            payload: { ok: false, error: err instanceof Error ? err.message : String(err) },
          });
        },
      );
  }, [openKey, close]);

  return { openKey, diff, toggle, close };
}
