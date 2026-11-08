import { STR } from "../strings";

/** 正文与队列未读完整时的恢复出口；不会清除用户草稿。 */
export function SessionLoadNotice(props: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (!props.loading && props.error === null) return null;
  return (
    <div className="session-load-notice" role={props.error === null ? "status" : "alert"} aria-busy={props.loading}>
      <div className="session-load-heading">
        <span>{props.loading ? STR.sessionLoad.loading : STR.sessionLoad.failed}</span>
        {props.error !== null && (
          <button type="button" className="btn-ghost" data-session-retry disabled={props.loading} onClick={props.onRetry}>
            {STR.sessionLoad.retry}
          </button>
        )}
      </div>
      {props.error !== null && (
        <details>
          <summary>{STR.sidebar.errorDetails}</summary>
          <pre tabIndex={0}>{props.error}</pre>
        </details>
      )}
    </div>
  );
}
