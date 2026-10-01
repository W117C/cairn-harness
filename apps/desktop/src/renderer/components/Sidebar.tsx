import type { SessionInfoPayload } from "../../../../../src/main/ipc-protocol";

export function Sidebar(props: { sessions: SessionInfoPayload[]; activeId: string | null; running: Set<string>; onOpen: (id: string) => void }) {
  return (
    <aside className="sidebar">
      <div className="group-title">M0 · 工作区</div>
      {props.sessions.map((s) => (
        <div key={s.id} className={"session" + (s.id === props.activeId ? " active" : "")} onClick={() => props.onOpen(s.id)}>
          <span className={"dot" + (props.running.has(s.id) ? " breathe" : "")} />
          <span>{s.title ?? s.id}</span>
        </div>
      ))}
    </aside>
  );
}
