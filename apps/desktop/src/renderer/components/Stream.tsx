import type { StreamRow } from "../projections";

export function Stream(props: { rows: StreamRow[] }) {
  return (
    <div className="stream">
      {props.rows.map((r, i) =>
        r.kind === "user" ? <div key={i} className="row-user">{r.text}</div>
        : r.kind === "tool" ? <div key={i} className="row-tool"><span>⌁</span><span>{r.tool}</span><span className="summary">· {r.summary}</span></div>
        : <div key={i}>{r.text}</div>,
      )}
    </div>
  );
}
