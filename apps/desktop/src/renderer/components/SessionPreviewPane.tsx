// 会话预览窗格（2026-10-25）：⌘+点击侧栏会话，在右栏只读看另一场会话，不打断当前会话。
// 这是「会话分屏」的第一层闭环：独立 openSession + onEvent 订阅，复用 Stream 渲染；
// 头部「切到会话」才把主体会话换过去。完整双会话输入/队列仍不在本批。
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { isMainSessionTerminalEvent, mergeSessionSnapshot } from "../derived/session";
import { projectStream } from "../projections";
import { Stream } from "./Stream";
import "./session-preview.css";

export function SessionPreviewPane(props: {
  target: { id: string; workspace?: string; title: string } | null;
  onSwitch?: (id: string, workspace?: string) => void;
}): React.JSX.Element {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [retry, setRetry] = useState(0);
  const targetRef = useRef(props.target);
  targetRef.current = props.target;
  const loadingRef = useRef(false);
  const pendingRef = useRef<AgentEvent[]>([]);
  const genRef = useRef(0);

  useEffect(() => {
    return window.agent.onEvent((e) => {
      const target = targetRef.current;
      if (target === null) return;
      if ((e as { session_id?: string }).session_id !== target.id) return;
      if ((e as { type?: string }).type === "session_titled") return;
      const eventWorkspace = (e as { workspace?: string }).workspace;
      if (eventWorkspace !== undefined && target.workspace !== undefined && eventWorkspace !== target.workspace) return;
      if (loadingRef.current) { pendingRef.current.push(e); return; }
      setEvents((prev) => [...prev, e]);
      setRunning(!isMainSessionTerminalEvent(e));
    });
  }, []);

  useEffect(() => {
    const target = props.target;
    const gen = ++genRef.current;
    loadingRef.current = true;
    pendingRef.current = [];
    setEvents([]);
    setError(null);
    setRunning(false);
    if (target === null) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.agent.openSession(target.id, target.workspace).then((result) => {
      if (gen !== genRef.current) return;
      loadingRef.current = false;
      setEvents(mergeSessionSnapshot(result.events, pendingRef.current));
      pendingRef.current = [];
      const status = result as { running?: unknown };
      setRunning(status.running === true);
      setLoading(false);
    }).catch((err: unknown) => {
      if (gen !== genRef.current) return;
      loadingRef.current = false;
      pendingRef.current = [];
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
    return () => {
      // 卸载/换目标后迟到的 openSession 不落状态。
      if (gen === genRef.current) genRef.current += 1;
      loadingRef.current = false;
    };
  }, [props.target, retry]);

  const rows = useMemo(() => projectStream(events, running), [events, running]);
  const target = props.target;
  if (target === null) {
    return (
      <div className="session-preview" aria-label="会话预览">
        <div className="svp-empty">
          <p>在侧栏按住 ⌘ 点击一个会话，或从行菜单选「在侧栏预览」。</p>
          <p className="svp-dim">不会切走当前会话，也不会打断正在运行的任务。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="session-preview" aria-label="会话预览">
      <div className="svp-head">
        <div className="svp-title" title={target.title}>{target.title}</div>
        <span className="svp-readonly">只读</span>
        {running && <span className="svp-live">运行中</span>}
        {props.onSwitch !== undefined && (
          <button type="button" className="mini-btn svp-switch" onClick={() => { props.onSwitch?.(target.id, target.workspace); }}>
            切到会话
          </button>
        )}
      </div>
      {loading && <div className="svp-note" role="status">正在读取会话…</div>}
      {error !== null && (
        <div className="svp-note err" role="alert">
          <span>预览失败：{error}</span>
          <button type="button" className="mini-btn" onClick={() => { setRetry((n) => n + 1); }}>重试</button>
        </div>
      )}
      {!loading && error === null && (
        <div className="stream svp-stream">
          <Stream rows={rows} streaming={running} />
        </div>
      )}
    </div>
  );
}
