// 第 1111 页：会话键控错误/提示条从 workbench.ts 拆出（同一套按 activeIdRef 的 key 读写）。
// workbench 已 1174 行；这两组 Map 的 set/clear 语义完全相同，只差载荷类型，集中一处避免漂移。
import { useCallback, useState } from "react";
import type { SurfaceError } from "../surface-error";

export function useSessionNotices(activeIdRef: { current: string | null }) {
  // M3-4/M4-4 会话键控错误条。载荷两种：一句话，或结构化 SurfaceError（原因/依据/下一步）。
  const [sessionErrors, setSessionErrors] = useState<ReadonlyMap<string, string | SurfaceError>>(new Map());
  const setLastError = useCallback((message: string | SurfaceError, sessionId?: string) => {
    setSessionErrors((prev) => new Map(prev).set(sessionId ?? activeIdRef.current ?? "", message));
  }, [activeIdRef]);
  const clearLastError = useCallback(() => {
    setSessionErrors((prev) => {
      const key = activeIdRef.current ?? "";
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [activeIdRef]);
  const [sessionNotices, setSessionNotices] = useState<ReadonlyMap<string, string>>(new Map());
  const setLastNotice = useCallback((message: string, sessionId?: string) => {
    setSessionNotices((prev) => new Map(prev).set(sessionId ?? activeIdRef.current ?? "", message));
  }, [activeIdRef]);
  const clearLastNotice = useCallback(() => {
    setSessionNotices((prev) => {
      const key = activeIdRef.current ?? "";
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [activeIdRef]);
  return { sessionErrors, setLastError, clearLastError, sessionNotices, setLastNotice, clearLastNotice };
}
