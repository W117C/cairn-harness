// 会话日志查看器（2026-10-21 批 132）：错误条 / 命令面板的「查看日志」落点。
// 只读尾部：主进程按会话归属解析路径后读最近 400 行（≤256 KiB），渲染层不传路径。
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, Loader2, RefreshCw, X } from "lucide-react";
import type { SessionLogPayload } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import { toast } from "../toast";
import { ModalSurface } from "./ModalSurface";

export type SessionLogState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: Extract<SessionLogPayload, { ok: true }> };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function copyText(text: string, okMessage: string): void {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    toast.error(STR.logViewer.copyFailed);
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => { toast.success(okMessage); },
    () => { toast.error(STR.logViewer.copyFailed); },
  );
}

/** 内容面（判卷可单独渲染三态，不必真开 IPC）。 */
export function SessionLogBody(props: {
  state: SessionLogState;
  onRetry: () => void;
  onCopyPath: (path: string) => void;
}): React.JSX.Element {
  if (props.state.status === "loading") {
    return (
      <p className="session-log-empty" role="status">
        <Loader2 size={13} className="s-spin" aria-hidden="true" /> {STR.logViewer.loading}
      </p>
    );
  }
  if (props.state.status === "error") {
    return (
      <div className="session-log-fail" role="alert">
        <p className="session-log-empty"><AlertTriangle size={13} aria-hidden="true" /> {STR.logViewer.failed}：{props.state.error}</p>
        <button className="mini-btn" title={STR.common.retry} onClick={props.onRetry}>{STR.common.retry}</button>
      </div>
    );
  }
  const data = props.state.data;
  return (
    <>
      <div className="session-log-meta">
        <code className="session-log-path" title={data.path} aria-label={STR.logViewer.pathAria}>{data.path}</code>
        <button className="mini-btn" title={STR.logViewer.copyPath} onClick={() => { props.onCopyPath(data.path); }}>{STR.logViewer.copyPath}</button>
      </div>
      {data.lines === 0
        ? <p className="session-log-empty">{STR.logViewer.empty}</p>
        : <pre className="session-log-pre" tabIndex={0} aria-label={STR.logViewer.logAria}>{data.text}</pre>}
      <div className="session-log-note">
        {data.truncated ? (data.lines === 1 && data.text.length > 100_000 ? STR.logViewer.singleLine : STR.logViewer.truncated) : null}
        <span className="num">{data.lines} {STR.logViewer.lines} · {STR.logViewer.size} {formatBytes(data.bytes)}</span>
      </div>
    </>
  );
}

export function SessionLogDialog(props: { id: string; title: string; onClose: () => void }): React.JSX.Element {
  const [state, setState] = useState<SessionLogState>({ status: "loading" });
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    void Promise.resolve()
      .then(() => window.agent.sessionLog(props.id, 400))
      .then(
        (r) => {
          if (seq !== seqRef.current) return;
          setState(r.ok ? { status: "ready", data: r } : { status: "error", error: r.error });
        },
        (e: unknown) => {
          if (seq !== seqRef.current) return;
          setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
        },
      );
  }, [props.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <ModalSurface
        className="modal-card modal-wide session-log-modal"
        label={`${STR.logViewer.title} · ${props.title}`}
        onClose={props.onClose}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="modal-head">
          <span>{STR.logViewer.title} <span className="session-log-target">{props.title}</span></span>
          <button className="iconbtn sm" aria-label={STR.logViewer.close} title={STR.logViewer.close} onClick={props.onClose}>
            <X size={13} />
          </button>
        </div>
        <SessionLogBody
          state={state}
          onRetry={load}
          onCopyPath={(path) => { copyText(path, STR.logViewer.copiedPath); }}
        />
        <div className="modal-foot">
          <button className="mini-btn" title={STR.logViewer.refresh} onClick={load} disabled={state.status === "loading"}>
            <RefreshCw size={12} aria-hidden="true" /> {STR.logViewer.refresh}
          </button>
          <button className="mini-btn" title={STR.logViewer.copyLog} onClick={() => {
            if (state.status === "ready") copyText(state.data.text, STR.logViewer.copiedLog);
          }} disabled={state.status !== "ready"}>
            <Copy size={12} aria-hidden="true" /> {STR.logViewer.copyLog}
          </button>
          <button className="mini-btn primary" title={STR.logViewer.close} onClick={props.onClose}>{STR.logViewer.close}</button>
        </div>
      </ModalSurface>
    </div>
  );
}
