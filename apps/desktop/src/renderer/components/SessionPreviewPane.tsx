// 会话预览窗格（2026-10-25，2026-10-27 可继续）：⌘+点击侧栏会话，在右栏看另一场会话，
// 不打断当前会话。输入框走主会话同一条 sendTo 管线（插话/队列/runOn），不是预览私有副本；
// 附件、@引用、技能菜单仍归主输入框，预览只发纯文本。
import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { isMainSessionTerminalEvent, mergeSessionSnapshot } from "../derived/session";
import { isCompositionEnter } from "../ime";
import { projectStream } from "../projections";
import { Stream } from "./Stream";
import "./session-preview.css";

export interface PreviewSendOutcome {
  outcome: "steered" | "queued" | "started" | "failed";
  error?: string;
}

export function SessionPreviewPane(props: {
  target: { id: string; workspace?: string; title: string } | null;
  onSwitch?: (id: string, workspace?: string) => void;
  /** 在预览中继续发送；running = 目标会话此刻是否在跑（由本窗格的事件态传入）。 */
  onSend?: (text: string, running: boolean) => Promise<PreviewSendOutcome>;
  onStop?: () => void;
  /** 队列停表（本轮失败/停止后）时继续发送队首。 */
  onResume?: () => void;
}): React.JSX.Element {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
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
    setDraft("");
    setSending(false);
    setNotice(null);
    setQueued(false);
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
  useEffect(() => {
    const el = previewScrollRef.current;
    if (el !== null && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  useEffect(() => {
    if (running) setQueued(false);
  }, [running]);
  const onStreamScroll = (): void => {
    const el = previewScrollRef.current;
    if (el !== null) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const submit = async (): Promise<void> => {
    const text = draft.trim();
    const target = props.target;
    if (text === "" || sending || target === null || props.onSend === undefined || loading || error !== null) return;
    const submittedFor = target.id;
    setSending(true);
    setNotice(null);
    setDraft("");
    stickRef.current = true;
    try {
      const result = await props.onSend(text, running);
      if (targetRef.current?.id !== submittedFor) return;
      if (result.outcome === "steered") setNotice("已插话到本轮");
      else if (result.outcome === "queued") { setQueued(true); setNotice("已加入队列，本轮结束后发送"); }
      else if (result.outcome === "started") setNotice("已发送");
      else {
        setDraft((prev) => (prev === "" ? text : text + "\n" + prev));
        setNotice("发送失败：" + (result.error ?? "未知原因"));
      }
    } catch (err) {
      if (targetRef.current?.id === submittedFor) {
        setDraft((prev) => (prev === "" ? text : text + "\n" + prev));
        setNotice("发送失败：" + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      if (targetRef.current?.id === submittedFor) setSending(false);
    }
  };
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
        <span className="svp-badge" title="发送只作用于这个预览会话；点「切到会话」才换主体">不切主会话</span>
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
        <div className="stream svp-stream" ref={previewScrollRef} onScroll={onStreamScroll}>
          <Stream rows={rows} streaming={running} />
        </div>
      )}
      {props.onSend !== undefined && (
        <div className="svp-composer">
          {notice !== null && <div className="svp-composer-note" role="status">{notice}</div>}
          <div className="svp-composer-row">
            <textarea
              className="svp-input"
              rows={2}
              value={draft}
              placeholder="在预览中继续对话（Enter 发送，Shift+Enter 换行）"
              aria-label="在预览中继续对话"
              disabled={loading || error !== null}
              onChange={(e) => { setDraft(e.target.value); }}
              onKeyDown={(e) => {
                // IME 组字守卫（2026-10-28）：组字途中的一次回车归 IME，不发消息。
                // 口径与主输入框**同一处**（`ime.ts`）——此前这里自己抄了 `nativeEvent.isComposing`，
                // 与 Composer 的判定不同源：合成事件缺旗时两处行为会分叉。
                if (e.key === "Enter" && !e.shiftKey && !isCompositionEnter(e, null)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="svp-composer-actions">
              {running && props.onStop !== undefined && (
                <button
                  type="button"
                  className="mini-btn svp-stop"
                  aria-label="停止预览会话本轮"
                  title="停止这一轮"
                  onClick={() => { props.onStop?.(); setNotice("已请求停止"); }}
                >
                  <Square size={11} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="mini-btn svp-send"
                aria-label={running ? "发送到预览会话（本轮运行中则插入本轮）" : "发送到预览会话"}
                title={running ? "本轮运行中：发送即插话；主进程拒绝时自动入队" : "发送到预览会话"}
                disabled={draft.trim() === "" || sending || loading || error !== null}
                onClick={() => void submit()}
              >
                <Send size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
          {queued && !running && props.onResume !== undefined && (
            <button type="button" className="mini-btn svp-resume" onClick={() => { props.onResume?.(); setQueued(false); }}>
              继续发送队列
            </button>
          )}
        </div>
      )}
    </div>
  );
}
