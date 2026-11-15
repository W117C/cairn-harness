// 第 1111 页：会话键控错误/提示条从 workbench.ts 拆出（同一套按活动会话的 key 读写）。
// workbench 已 1174 行；这两组 Map 的 set/clear 语义完全相同，只差载荷类型，集中一处避免漂移。
import { useCallback, useState } from "react";
import type { SurfaceError } from "../surface-error";
import { runKey } from "./session-identity";

type SessionRef = { current: string | null };

/** 同一 id 的会话可以在不同工作区各有一条；错误/提示的读写与运行态共用限定键。
 *  未给会话 id = 当前活动会话；显式给 id 的后台动作可再给 workspace，不能借“当前项目”猜。 */
function noticeKey(
  activeIdRef: SessionRef,
  activeWorkspaceRef: SessionRef,
  sessionId?: string,
  workspace?: string | null,
): string {
  const sid = sessionId ?? activeIdRef.current;
  if (sid === null || sid === "") return "";
  return runKey(workspace === undefined ? activeWorkspaceRef.current : workspace, sid);
}

export function useSessionNotices(activeIdRef: SessionRef, activeWorkspaceRef: SessionRef) {
  // M3-4/M4-4 会话键控错误条。载荷两种：一句话，或结构化 SurfaceError（原因/依据/下一步）。
  const [sessionErrors, setSessionErrors] = useState<ReadonlyMap<string, string | SurfaceError>>(new Map());
  const setLastError = useCallback((message: string | SurfaceError, sessionId?: string, workspace?: string | null) => {
    const key = noticeKey(activeIdRef, activeWorkspaceRef, sessionId, workspace);
    setSessionErrors((prev) => new Map(prev).set(key, message));
  }, [activeIdRef, activeWorkspaceRef]);
  const clearLastError = useCallback(() => {
    const key = noticeKey(activeIdRef, activeWorkspaceRef);
    setSessionErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [activeIdRef, activeWorkspaceRef]);
  const [sessionNotices, setSessionNotices] = useState<ReadonlyMap<string, string>>(new Map());
  const setLastNotice = useCallback((message: string, sessionId?: string, workspace?: string | null) => {
    const key = noticeKey(activeIdRef, activeWorkspaceRef, sessionId, workspace);
    setSessionNotices((prev) => new Map(prev).set(key, message));
  }, [activeIdRef, activeWorkspaceRef]);
  const clearLastNotice = useCallback(() => {
    const key = noticeKey(activeIdRef, activeWorkspaceRef);
    setSessionNotices((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [activeIdRef, activeWorkspaceRef]);
  return { sessionErrors, setLastError, clearLastError, sessionNotices, setLastNotice, clearLastNotice };
}
