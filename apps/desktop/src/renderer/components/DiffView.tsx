// DiffView：unified hunks 渲染（变更窗格的逐 hunk 展开区）+ 行级评注（蓝本 §3.6）。
// 渲染契约：hunk 头 `@@ -a,b +c,d @@`；每行 = 旧行号 · 新行号 · 符号（+ / − / 空格）· 文本。
// 色盲冗余：着色之外，符号与前缀始终在场（不只靠颜色表达增删——同仓 diff 纪律）。
// 截断如实标注（超字节/行数帽时不假装完整）。
// 评注：仅当传 onComment 时行 hover 出「＋」；已评注的行常显 💬（title 带评论原文）。
//   行键 = `<path>|<newNo ?? oldNo>`——评审对象是"现在的这一行"（del 行用旧行号回指）。
import { useState, type KeyboardEvent } from "react";
import type { DiffHunkView } from "../../../../../src/main/change-diff";

export interface DiffViewCommentApi {
  /** 行键 → 评论文本。 */
  comments: ReadonlyMap<string, string>;
  /** 行键前缀（`<path>|`）。 */
  keyPrefix: string;
  onComment: (lineKey: string, text: string) => void;
}

export function DiffView(props: {
  hunks: readonly DiffHunkView[];
  truncated?: boolean;
  comment?: DiffViewCommentApi;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (props.hunks.length === 0) {
    // 截断态不能说「没有差异」：那会把「没比完」说成「比完了且一样」（真机：大文件超帽）。
    return props.truncated === true
      ? <div className="diff-note">已截断比对：显示帽内的内容未发现不同，超出部分未比对。</div>
      : <div className="diff-empty">没有差异（与快照逐行一致）</div>;
  }
  const api = props.comment;
  const openEditor = (key: string): void => {
    setEditing(key);
    setDraft(api?.comments.get(key) ?? "");
  };
  const commit = (): void => {
    if (editing === null) return;
    const text = draft.trim();
    if (text !== "") api?.onComment(editing, text);
    setEditing(null);
    setDraft("");
  };
  const onEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Escape") { setEditing(null); setDraft(""); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  };
  return (
    <div className="diff-view" aria-label="文件差异">
      {props.hunks.map((h, i) => (
        <div className="diff-hunk" key={`${h.header}:${String(i)}`}>
          <div className="diff-hunk-head num">{h.header}</div>
          {h.lines.map((l, j) => {
            const lineNo = l.newNo ?? l.oldNo ?? 0;
            const key = api === undefined ? "" : `${api.keyPrefix}${String(lineNo)}`;
            const has = api !== undefined && api.comments.has(key);
            return (
              <div key={j}>
                <div className={`diff-line ${l.kind}`}>
                  <span className="ln num" aria-hidden="true">{l.oldNo === null ? "" : String(l.oldNo)}</span>
                  <span className="ln num" aria-hidden="true">{l.newNo === null ? "" : String(l.newNo)}</span>
                  <span className="sign" aria-hidden="true">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  <span className="txt">{l.text}</span>
                  {api !== undefined && (
                    <span className="dl-actions">
                      {has && (
                        <span className="dl-has-comment" title={api.comments.get(key)} aria-label="该行有评注">💬</span>
                      )}
                      <button
                        className="dl-comment"
                        aria-label={`评论第 ${String(lineNo)} 行`}
                        onClick={() => { openEditor(key); }}
                      >＋</button>
                    </span>
                  )}
                </div>
                {editing === key && (
                  <div className="dl-editor">
                    <textarea
                      autoFocus
                      rows={2}
                      value={draft}
                      aria-label={`第 ${String(lineNo)} 行评注`}
                      placeholder="写评论（⌘Enter 保存 · Esc 取消）"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onEditorKey}
                    />
                    <button className="mini-btn primary" onClick={commit}>保存评论</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {props.truncated === true && (
        <div className="diff-note">已截断（超字节 / 行数帽）——完整差异请用本地工具查看。</div>
      )}
    </div>
  );
}
