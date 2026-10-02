import type { SessionInfoPayload } from "../../../../../src/main/ipc-protocol";
import { relativeTime } from "../projections";

export function Sidebar(props: { sessions: SessionInfoPayload[]; activeId: string | null; running: Set<string>; onOpen: (id: string) => void }) {
  return (
    <aside className="sidebar">
      <div className="group-title">M0 · 工作区</div>
      {props.sessions.map((s) => {
        // 会话相对时间：updatedAt（ISO 串，可能缺席）优先，解析失败回退 mtimeMs，再失败不显示。
        const parsed = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
        const timeMs = Number.isFinite(parsed) ? parsed : s.mtimeMs;
        return (
          <div key={s.id} className={"session" + (s.id === props.activeId ? " active" : "")} onClick={() => props.onOpen(s.id)}>
            <span className={"dot" + (props.running.has(s.id) ? " breathe" : "")} />
            <span>{s.title ?? s.id}</span>
            {Number.isFinite(timeMs) && <span className="row-time">{relativeTime(Date.now(), timeMs)}</span>}
          </div>
        );
      })}
    </aside>
  );
}
