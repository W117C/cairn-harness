import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSession } from "../sessions-view";

/** 清单快照与读取状态独立于活动会话；仅最新请求可发布结果。 */
export function useSessionList() {
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  // 只有成功读取才放行启动恢复；失败不能被当成空列表清掉上次会话。
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsLoadError, setSessionsLoadError] = useState(false);
  const [sessionsLoadErrorDetail, setSessionsLoadErrorDetail] = useState<string | null>(null);
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);
  const requestSeq = useRef(0);
  useEffect(() => () => { requestSeq.current += 1; }, []);

  const refreshSessions = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current;
    setSessionsRefreshing(true);
    try {
      const list = await window.agent.listSessions() as WorkspaceSession[];
      if (seq !== requestSeq.current) return;
      setSessions(list);
      setSessionsLoadError(false);
      setSessionsLoadErrorDetail(null);
      setSessionsLoaded(true);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setSessionsLoadError(true);
      setSessionsLoadErrorDetail(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === requestSeq.current) setSessionsRefreshing(false);
    }
  }, []);

  // 保留快照与失败原因；首读骨架仍由 loading={!sessionsLoaded && !sessionsLoadError} 收口。
  const retrySessions = useCallback(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return { sessions, sessionsLoaded, sessionsLoadError, sessionsLoadErrorDetail, sessionsRefreshing, refreshSessions, retrySessions };
}
