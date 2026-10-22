import { Command } from "cmdk";
import { MessageSquare } from "lucide-react";
import type { SessionSearchResult } from "../../../../../src/main/ipc-protocol";

export type SessionSearchState =
  | { status: "idle" | "loading" }
  | { status: "ready"; result: SessionSearchResult }
  | { status: "error"; error: string };

export function SessionSearchResults(props: {
  state: SessionSearchState;
  workspace: string;
  onOpenSession: (id: string, workspace?: string) => void;
  onRetry: () => void;
}): React.JSX.Element | null {
  const { state, workspace } = props;
  if (state.status === "idle") return null;
  if (state.status === "loading") return <div className="cp-empty" role="status">正在搜索当前项目的对话正文…</div>;
  const error = state.status === "error" ? state.error
    : state.status === "ready" && state.result.kind === "unavailable"
      ? state.result.detail ?? "当前项目的对话正文暂时无法搜索" : null;
  if (error !== null) return (
    <div className="cp-empty" role="status">
      <span>{error}</span>{" "}
      <button type="button" className="mini-btn" onClick={props.onRetry}>重试搜索</button>
    </div>
  );
  if (state.status !== "ready" || state.result.kind === "unavailable") return null;
  const result = state.result;
  return (
    <Command.Group forceMount heading="当前项目正文" className="cp-group cp-body-search">
      {result.kind === "partial" && <div className="cp-empty" role="status">搜索尚未完成，可能还有结果</div>}
      {result.kind === "ok" && result.matches.length === 0 && <div className="cp-empty" role="status">正文中没有匹配</div>}
      {result.matches.map((match) => (
        <Command.Item
          key={match.sessionId}
          forceMount
          className="cp-item"
          data-session-search-result={match.sessionId}
          value={`正文 ${workspace} ${match.sessionId}`}
          onSelect={() => props.onOpenSession(match.sessionId, workspace)}
        >
          <span className="cp-ico" aria-hidden="true"><MessageSquare size={14} /></span>
          <span className="cp-stack">
            <span className="cp-label">{match.title ?? match.sessionId}</span>
            <span className="cp-sub" title={match.snippets[0]?.excerpt}>{match.snippets[0]?.excerpt}</span>
          </span>
          <span className="cp-at num">{match.matchCount}{match.complete && match.badLines === 0 ? "" : "+"} 条</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}
