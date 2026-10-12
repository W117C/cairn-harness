// C-09/10/11/12 事件流（产品化重排 2026-10-07，spec ③⑤）：
//   user 行 = 右对齐浅底消息块（hover 出复制/回滚）；assistant 行 = 头像 + markdown 正文
//   （代码块带语言标签与复制钮；流式期细竖条光标）；工具行 = 状态图标（旋转弧/对勾/叉）
//   + mono 头 + 展开参数；思考行保留走秒与默认展开。
// 判卷约束（render-structure.test.tsx）：.row.user/.row.assistant/.row.error-row/.toolcluster、
// data-round-anchor、think-live/think-elapsed/aria 全套保留——本文件只动字形与包裹层，不动锚。
import { useEffect, useState } from "react";
import { relativeTime, type StreamRow } from "../projections";
import { Markdown } from "../markdown";
import { Ic } from "./icons";

function RowTime(props: { ts?: number }) {
  if (props.ts === undefined) return null;
  return (
    <span className="row-time" title={new Date(props.ts).toLocaleString()}>
      {relativeTime(Date.now(), props.ts)}
    </span>
  );
}

/** C-12 工具行三态字形：pending=旋转弧（CSS .glyph.pending 转动）/ ok=对勾 / failed=叉。
 *  ok 缺席按成功处理（不造假失败）。 */
function ToolGlyph(props: { pending?: boolean; ok?: boolean }) {
  if (props.pending) return <span className="glyph pending" aria-label="执行中"><Ic.loader size={12} /></span>;
  if (props.ok === false) return <span className="glyph failed" aria-label="失败"><Ic.x size={12} /></span>;
  return <span className="glyph ok" aria-label="完成"><Ic.check size={12} /></span>;
}

function ToolRow(props: { row: Extract<StreamRow, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const r = props.row;
  return (
    <div className={`row tool${open ? " open" : ""}`}>
      <button className="tool-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chev" aria-hidden="true"><Ic.chevronRight size={10} /></span>
        <ToolGlyph pending={r.pending} ok={r.ok} />
        <span className="tname">{r.tool}</span>
        <span className="tsum">· {r.summary}</span>
        <RowTime ts={r.ts} />
      </button>
      {open && (
        <div className="tool-body">
          <div className="kv">
            <span className="k">摘要</span>
            <pre>{r.summary}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export interface StreamActions {
  /** eventId → 当前生效评分（listFeedback 投影）；缺席 = 未评。 */
  feedback?: ReadonlyMap<number, "up" | "down">;
  /** 赞/踩真提交（core submitFeedback 落 sidecar）；rating=null = 撤销。 */
  onFeedback?: (eventId: number, rating: "up" | "down" | null) => void;
  /** 文件级回滚（core revertTurn；确认与结果提示在 App）。 */
  onRevertTurn?: (round: number) => void;
  /** 复制行文本（剪贴板与失败面在 App）。 */
  onCopyText?: (text: string) => void;
}

function AssistantActions(props: { text: string; eventId: number; actions: StreamActions }) {
  const current = props.actions.feedback?.get(props.eventId) ?? null;
  const { onCopyText, onFeedback } = props.actions;
  return (
    <span className="row-actions">
      <button className="row-action" aria-label="复制这行输出" title="复制" onClick={() => onCopyText?.(props.text)}>
        <Ic.copy size={12} />
      </button>
      <button
        className={`row-action${current === "up" ? " on" : ""}`}
        aria-label={current === "up" ? "取消点赞" : "赞这条输出"}
        aria-pressed={current === "up"}
        title={current === "up" ? "已赞（再点撤销）" : "赞"}
        onClick={() => onFeedback?.(props.eventId, current === "up" ? null : "up")}
      ><Ic.thumbUp size={12} /></button>
      <button
        className={`row-action${current === "down" ? " on" : ""}`}
        aria-label={current === "down" ? "取消点踩" : "踩这条输出"}
        aria-pressed={current === "down"}
        title={current === "down" ? "已踩（再点撤销）" : "踩"}
        onClick={() => onFeedback?.(props.eventId, current === "down" ? null : "down")}
      ><Ic.thumbDown size={12} /></button>
    </span>
  );
}

/** C-31 思考行（live）：可点开 + 计时。判卷钉住的锚（role/aria/think-live/think-elapsed/
 *  默认展开/折叠体）全保留；文案与字形随产品化更新。 */
export function ThinkingLive(props: { seq: number; thinking?: string; running?: boolean }): React.JSX.Element {
  // 有思考正文时**默认展开**：用户要的就是"看见它在想什么"。
  const [open, setOpen] = useState(props.thinking !== undefined && props.thinking !== "");
  const [elapsed, setElapsed] = useState(0);
  const running = props.running !== false;
  useEffect(() => {
    // running=false 时清掉定时器，elapsed 保留最后一次的值 ⇒ 定格在最终秒数（不继续跳）。
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return (
    <div
      className={"row think" + (open ? " open" : "")}
      key={`t${props.seq}`}
      role="button"
      aria-expanded={open}
      aria-label="模型思考中，点击展开说明"
      onClick={() => setOpen((v) => !v)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
    >
      <div className="think-line">
        <span className="chev" aria-hidden="true"><Ic.chevronRight size={10} /></span>
        <span className="think-label">思考中</span>
        {running ? (
          <span className="think-live" aria-hidden="true"><i /><i /><i /></span>
        ) : (
          <span className="think-done" aria-label="思考完成"><Ic.check size={12} /></span>
        )}
        <span className="think-elapsed" aria-live="polite">{elapsed}s</span>
      </div>
      <div className="think-body">
        {props.thinking !== undefined && props.thinking !== "" ? (
          // 逐段累计的思考正文（来自 thinking_delta；与正文分开落事件，转录不脏）
          <span className="think-text">{props.thinking}</span>
        ) : (
          <>
            正在思考（可以调档位；这家没吐思考正文时这里就是空的）。
            <span className="off-note">思考与正文分开落事件，不把推理内容混进转录。</span>
          </>
        )}
      </div>
    </div>
  );
}

export function Stream(props: { rows: StreamRow[]; actions?: StreamActions }) {
  const actions = props.actions;
  // 步骤簇：连续 tool 行收进同一簇（左侧 1px 轨道）；其余行打断簇。
  const out: Array<{ key: string; node: React.ReactNode }> = [];
  let cluster: Extract<StreamRow, { kind: "tool" }>[] = [];
  let clusterStart = 0;
  let n = 0;
  const flush = () => {
    if (cluster.length === 0) return;
    const rows = cluster;
    const key = `c${String(clusterStart)}`;
    cluster = [];
    out.push({
      key,
      node: (
        <div className="toolcluster" key={key}>
          {rows.map((r, i) => <ToolRow key={i} row={r} />)}
        </div>
      ),
    });
  };
  for (const r of props.rows) {
    n += 1;
    clusterStart = n;
    switch (r.kind) {
      case "tool":
        cluster.push(r);
        break;
      case "user": {
        flush();
        // 原型形态（design/prototype.html renderRow）：左对齐粗体纯文本，meta=悬停动作 + 时间；
        // 不做右对齐气泡（2026-10-07 业主指名回归原型）。data-round-anchor 是 TurnRail 的锚。
        out.push({
          key: `u${r.seq}`,
          node: (
            <div className="row user" style={{ scrollMarginTop: 14 }}>
              <span className="t" data-round-anchor={String(r.round)}>{r.text}</span>
              <span className="meta">
                {actions?.onCopyText !== undefined && (
                  <span className="row-actions">
                    <button className="row-action" aria-label="复制这条消息" title="复制" onClick={() => actions.onCopyText?.(r.text)}>
                      <Ic.copy size={12} />
                    </button>
                    <button
                      className="row-action"
                      aria-label={`还原第 ${String(r.round)} 轮改动过的文件`}
                      title={`还原第 ${String(r.round)} 轮的文件改动`}
                      onClick={() => actions.onRevertTurn?.(r.round)}
                    ><Ic.revert size={12} /></button>
                  </span>
                )}
                <RowTime ts={r.ts} />
              </span>
            </div>
          ),
        });
        break;
      }
      case "assistant": {
        flush();
        // C-31 ThinkingRow：live 行前挂一条思考行（有思考正文就渲染；正文来自 thinking_delta 桶）。
        if (r.live || (r.thinking !== undefined && r.thinking !== "")) {
          out.push({
            key: `t${r.seq}`,
            node: <ThinkingLive seq={r.seq} thinking={r.thinking} running={r.live === true && r.text === ""} />,
          });
        }
        out.push({
          key: `a${r.seq}`,
          node: (
            <div className="row assistant">
              <span className="spark" aria-hidden="true"><Ic.spark size={13} /></span>
              <span className="t">
                {/* 原型同款：追字光标在正文末尾行内（caret 进最后一个文本块），终稿到达即消失。 */}
                {r.text !== "" ? (
                  <Markdown
                    text={r.text}
                    {...(actions?.onCopyText !== undefined ? { onCopy: actions.onCopyText } : {})}
                    {...(r.live === true ? { caret: true } : {})}
                  />
                ) : (
                  r.live === true && <span className="cursor" aria-hidden="true" />
                )}
              </span>
              {!r.live && actions && <AssistantActions text={r.text} eventId={r.eventId} actions={actions} />}
              <span className="meta"><RowTime ts={r.ts} /></span>
            </div>
          ),
        });
        break;
      }
      case "error": {
        flush();
        out.push({
          key: `e${r.seq}`,
          node: (
            <div className="row error-row">
              <span className="err-glyph" aria-hidden="true"><Ic.alert size={14} /></span>
              <span className="t">{r.text}</span>
              <span className="meta"><RowTime ts={r.ts} /></span>
            </div>
          ),
        });
        break;
      }
    }
  }
  flush();
  return <>{out.map((o) => o.node)}</>;
}
