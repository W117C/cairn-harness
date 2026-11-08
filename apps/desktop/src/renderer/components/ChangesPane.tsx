// 变更窗格（diff 审阅面）：从 PaneDock 抽出（PaneDock 已顶到 1200 行帽）。
// 按轮列改动清单与验证凭据；点文件行懒加载逐 hunk diff；交付卡可通过 focus 直接选中某轮某文件。
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AgentEvent } from "../../../../../src/events";
import { turnDelivery } from "../projections";
import { changeLabel } from "../derived/change-labels";
import { diffCount, useLazyChangeDiff } from "../change-diff-state";
import { DiffView } from "./DiffView";
import { composeReviewMessage } from "./panes";

/** 变更窗格（diff 审阅面）：按轮列改动清单与验证凭据；点文件行懒加载逐 hunk diff（v4 通道）；
 *  行级评注（蓝本 §3.6）：多处评论汇总为一条消息，⌘Enter 一次性提交（复用 send → 新一轮）。 */
export interface ChangesFocus {
  round: number;
  path: string;
  snapshotId?: string;
  seq: number;
}

export function ChangesPane(props: {
  events: readonly AgentEvent[];
  onReview?: (text: string) => void;
  onPathMenu?: (rel: string, kind: "file" | "directory", x: number, y: number) => void;
  /** 交付卡点行：打开该轮并选中该文件（DSH 的 review tab 行跳转）。 */
  focus?: ChangesFocus;
}): React.JSX.Element {
  const turns = turnDelivery(props.events).filter((t) => t.files.length > 0);
  // 展开位（一次一个文件）；diff 懒加载与请求守卫收口在 change-diff-state.ts
  //（与 Inspector 同一实现；点开才要数据，不预取整会话的全部差异）。
  const { openKey, diff, toggle } = useLazyChangeDiff();
  // 交付卡的行/块头跳转：打开对应轮次并选中文件；seq 递增触发一次，重复点同一行不收起。
  const lastFocus = useRef(0);
  useEffect(() => {
    const f = props.focus;
    if (f === undefined || f.seq === lastFocus.current) return;
    lastFocus.current = f.seq;
    setOpenRound(f.round);
    const key = `${String(f.round)}:${f.path}`;
    if (openKey !== key) toggle(key, f.path, f.snapshotId);
  }, [props.focus, openKey, toggle]);
  // 每轮一张卡，但默认只展开最新一轮（2026-10-18 与交付卡同一批：23 轮全展开会把检查器塞满）。
  const [openRound, setOpenRound] = useState<number | null>(() => (turns.length > 0 ? turns[turns.length - 1]!.round : null));
  // 行级评注（行键 `<path>|<line>` → 文本）；提交后清空。
  const [comments, setComments] = useState<ReadonlyMap<string, string>>(new Map());
  const submitReview = (): void => {
    if (comments.size === 0 || props.onReview === undefined) return;
    props.onReview(composeReviewMessage(comments));
    setComments(new Map());
  };
  if (turns.length === 0) {
    return <div className="pane-empty">本会话还没有文件改动。<br />agent 写盘后会在这里按轮列出。</div>;
  }
  const verifyWord = (status: string): string =>
    status === "verified" ? "验证通过"
    : status === "failed" ? "验证失败"
    : status === "stale" ? "验证已过期"
    : status === "absent" ? "未验证"
    : "无需验证";
  const verifyCls = (status: string): string =>
    status === "verified" ? "ok" : status === "failed" ? "bad" : status === "absent" ? "warn" : "dim";
  // 分栏审阅器的选中项：openKey 就是选中态（与懒加载守卫同源 ⇒ 只在选中后才取差异，不预取）。
  const selected = (() => {
    if (openKey === null) return null;
    for (const t of turns) {
      for (const f of t.files) {
        if (`${String(t.round)}:${f.path}` === openKey) return { turn: t, file: f };
      }
    }
    return null;
  })();
  return (
    <div
      className="changes-pane review-split"
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitReview(); } }}
    >
      {comments.size > 0 && props.onReview !== undefined && (
        <div className="review-bar" role="status">
          <span className="rb-count num">{String(comments.size)} 条评注待提交</span>
          <button className="mini-btn primary" onClick={submitReview}>提交评论（⌘Enter）</button>
          <button className="mini-btn" onClick={() => setComments(new Map())}>清除</button>
        </div>
      )}
      <div className="review-cols">
        {/* 左栏：改动文件（按轮折叠的手风琴不动——它仍管「不把 23 轮全摊开」） */}
        <div className="pane-list review-files">
          {turns.map((t) => (
            <section className="pane-card" key={t.round}>
              <div className="pane-card-head">
                <span className="pc-title">第 {String(t.round)} 轮</span>
                <span className="chip">{String(t.files.length)} 个文件</span>
                <span className={"chip " + verifyCls(t.verification.status)}>{verifyWord(t.verification.status)}</span>
                <button
                  type="button"
                  className={"pane-card-toggle" + (openRound === t.round ? " on" : "")}
                  aria-expanded={openRound === t.round}
                  aria-label={openRound === t.round ? "收起这一轮的改动" : "展开这一轮的改动"}
                  onClick={() => { setOpenRound(openRound === t.round ? null : t.round); }}
                ><ChevronRight size={11} /></button>
              </div>
              {openRound === t.round && (
              <>
              <ul className="changes-list">
                {t.files.map((f) => {
                  const key = `${String(t.round)}:${f.path}`;
                  const open = openKey === key;
                  return (
                    <li className="change-item-wrap" key={`${f.path}:${f.change}`}>
                      <button
                        className={"change-item" + (open ? " open" : "")}
                        aria-expanded={open}
                        onClick={() => toggle(key, f.path, f.snapshotId)}
                        onContextMenu={(e) => { e.preventDefault(); props.onPathMenu?.(f.path, "file", e.clientX, e.clientY); }}
                      >
                        <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
                        <span className={"act " + f.change}>
                          {changeLabel(f.change)}
                        </span>
                        <span className="path">{f.path}</span>
                        {f.snapshotId !== undefined && (
                          <span className="snap" title="覆盖前快照已保留（.agent/snapshots）">快照</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {t.unverifiedFiles.length > 0 && (
                <div className="consequence">未验证：{t.unverifiedFiles.join("、")}</div>
              )}
              {t.nextAction !== "" && <div className="consequence">→ {t.nextAction}</div>}
              </>
              )}
            </section>
          ))}
        </div>
        {/* 右栏：选中文件的差异（Codex / Claude 的改审阅就是「文件列表在左、差异在右」） */}
        <div className="review-diff">
          {selected === null ? (
            <div className="pane-empty">左边选一个文件，这里看它改了什么。<br />选中之前不预取差异——点开才读快照与当前文件。</div>
          ) : (
            <>
              <div className="review-diff-head">
                <span className={"act " + selected.file.change}>
                  {changeLabel(selected.file.change)}
                </span>
                <span className="path">{selected.file.path}</span>
                {!diff.loading && diff.payload !== null && diff.payload.ok && (
                  <span className="change-diff-stat num">{`+${String(diffCount(diff.payload.hunks).add)} −${String(diffCount(diff.payload.hunks).del)}`}</span>
                )}
              </div>
              {diff.loading && <div className="pane-empty">正在读快照与当前文件…</div>}
              {!diff.loading && diff.payload !== null && (
                diff.payload.ok
                  ? (
                    <DiffView
                      hunks={diff.payload.hunks}
                      truncated={diff.payload.truncated}
                      {...(props.onReview !== undefined
                        ? {
                            comment: {
                              comments,
                              keyPrefix: `${selected.file.path}|`,
                              onComment: (lineKey: string, text: string) => {
                                setComments((prev) => {
                                  const next = new Map(prev);
                                  if (text === "") next.delete(lineKey); else next.set(lineKey, text);
                                  return next;
                                });
                              },
                            },
                          }
                        : {})}
                    />
                  )
                  : <div className="ap-notice err" role="alert">{diff.payload.error}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
