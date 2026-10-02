import { relativeTime, type StreamRow } from "../projections";

/** 行右侧安静时间戳：ts 在场才渲染（事件真值恒带 ts；旧日志 undefined ⇒ 留空不造假），
 *  hover 出精确本地时间。 */
function RowTime(props: { ts?: number }) {
  if (props.ts === undefined) return null;
  return (
    <span className="row-time" title={new Date(props.ts).toLocaleString()}>
      {relativeTime(Date.now(), props.ts)}
    </span>
  );
}

// 行主体占满、时间戳列靠右的共享布局（不新增类，布局走内联）。
const rowLayout = { display: "flex", gap: 8 } as const;
const mainCell = { flex: 1, minWidth: 0 } as const;

export function Stream(props: { rows: StreamRow[] }) {
  return (
    <div className="stream">
      {props.rows.map((r, i) => {
        switch (r.kind) {
          case "user":
            return (
              <div key={i} className="row-user" style={rowLayout}>
                <span style={mainCell}>{r.text}</span>
                <RowTime ts={r.ts} />
              </div>
            );
          case "assistant":
            return (
              <div key={i} style={rowLayout}>
                <span style={mainCell}>
                  {r.text}
                  {/* live=true = delta 流式中尚未被终稿取代的未结桶行 ⇒ 行尾呼吸光标 */}
                  {r.live && <span className="cursor-breathe">▮</span>}
                </span>
                <RowTime ts={r.ts} />
              </div>
            );
          case "tool":
            return (
              <div key={i} className="row-tool">
                {/* 未决 = 脉冲点；收口后按 ok 显 ⌁ / ✕（ok 缺席按成功处理，不造假失败） */}
                {r.pending
                  ? <span className="tool-pending">●</span>
                  : r.ok === false ? <span>✕</span> : <span>⌁</span>}
                <span>{r.tool}</span>
                <span className="summary" style={mainCell}>· {r.summary}</span>
                <RowTime ts={r.ts} />
              </div>
            );
          case "error":
            return (
              <div key={i} style={rowLayout}>
                <span style={mainCell}>{r.text}</span>
                <RowTime ts={r.ts} />
              </div>
            );
        }
      })}
    </div>
  );
}
