// DiffView：unified hunks 渲染（变更窗格的逐 hunk 展开区）+ 行级评注（蓝本 §3.6）。
// 渲染契约：hunk 头 `@@ -a,b +c,d @@`；每行 = 旧行号 · 新行号 · 符号（+ / − / 空格）· 文本。
// 色盲冗余：着色之外，符号与前缀始终在场（不只靠颜色表达增删——同仓 diff 纪律）。
// 截断如实标注（超字节/行数帽时不假装完整）。
// 评注：仅当传 onComment 时行 hover / 键盘聚焦出「＋」；**已评注的行常驻标记**（title 带评论原文）。
//   2026-11-01 第 875 页：本行原写「常显」，实现却把标记塞在 `opacity:0` 的 .dl-actions 里
//   ⇒ 只有悬停那一行才看得见，读差异时不会逐行悬停，「哪几行被评过」这个信息等于没有。
//   同时标记从 emoji 💬 换成 lucide MessageSquare（全应用图标族一致；emoji 随系统字形漂移）。
//   行键 = `<path>|<newNo ?? oldNo>`——评审对象是"现在的这一行"（del 行用旧行号回指）。
// 2026-10-31（R4）：新增并排视图（open-claude-ui StreamingDiffViewer 的双模式契约）。
//   统一仍为缺省；并排把 del/add 配对成左右两栏，context 两侧同置，空白侧留空。
import { MessageSquare } from "lucide-react";
import { isCompositionEnter } from "../ime";
import { useState, type KeyboardEvent } from "react";
import type { DiffHunkView, DiffLineView } from "../../../../../src/main/change-diff";

export type DiffViewMode = "unified" | "split";

export interface SplitDiffRow {
  left?: DiffLineView;
  right?: DiffLineView;
}

/** 把 unified 行序列配成并排行：context 两侧同置；del 块与紧随的 add 块逐行配对，
 *  多出的一侧留空。纯函数（判卷面）。 */
export function splitDiffRows(lines: readonly DiffLineView[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "ctx") {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    if (line.kind === "del") {
      const dels: DiffLineView[] = [];
      while (i < lines.length && lines[i]!.kind === "del") {
        dels.push(lines[i]!);
        i += 1;
      }
      const adds: DiffLineView[] = [];
      while (i < lines.length && lines[i]!.kind === "add") {
        adds.push(lines[i]!);
        i += 1;
      }
      const count = Math.max(dels.length, adds.length);
      for (let j = 0; j < count; j += 1) {
        rows.push({
          ...(dels[j] !== undefined ? { left: dels[j] } : {}),
          ...(adds[j] !== undefined ? { right: adds[j] } : {}),
        });
      }
      continue;
    }
    const adds: DiffLineView[] = [];
    while (i < lines.length && lines[i]!.kind === "add") {
      adds.push(lines[i]!);
      i += 1;
    }
    for (const add of adds) rows.push({ right: add });
  }
  return rows;
}

export interface DiffViewCommentApi {
  /** 行键 → 评论文本。 */
  comments: ReadonlyMap<string, string>;
  /** 行键前缀（`<path>|`）。 */
  keyPrefix: string;
  onComment: (lineKey: string, text: string) => void;
}

/** 行键 = `<path>|<side>:<line>`（第 922 页）：del 侧取旧文件行号，其余取新文件行号。
 *  此前只有行号 ⇒ 一次「改这一行」（del 与 add 同号）两侧共用一把键：一条评注会同时挂在删除行
 *  与新增行上，再写一条就把前一条覆盖掉；提交消息里的「第 N 行」也说不清是改前还是改后。 */
function lineKeyOf(api: DiffViewCommentApi, line: DiffLineView): string {
  const side = line.kind === "del" ? "old" : "new";
  const n = side === "old" ? line.oldNo : line.newNo;
  return `${api.keyPrefix}${side}:${String(n ?? 0)}`;
}

function CommentEditor(props: {
  lineNo: number;
  draft: string;
  onDraft: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}): React.JSX.Element {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Escape") props.onCancel();
    if (e.key === "Enter" && !isCompositionEnter(e, null) && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      props.onCommit();
    }
  };
  return (
    <div className={`dl-editor${props.className !== undefined ? ` ${props.className}` : ""}`}>
      <textarea
        autoFocus
        rows={2}
        value={props.draft}
        aria-label={`第 ${String(props.lineNo)} 行评注`}
        placeholder="写评论（⌘Enter 保存 · Esc 取消）"
        onChange={(e) => props.onDraft(e.target.value)}
        onKeyDown={onKey}
      />
      <button className="mini-btn primary" onClick={props.onCommit}>保存评论</button>
    </div>
  );
}

export function DiffView(props: {
  hunks: readonly DiffHunkView[];
  truncated?: boolean;
  comment?: DiffViewCommentApi;
  /** 并排/统一的初始档（缺省 unified；只在挂载时读一次）。 */
  initialView?: DiffViewMode;
}): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(props.initialView ?? "unified");
  const [editing, setEditing] = useState<string | null>(null);
  const [editingNo, setEditingNo] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  if (props.hunks.length === 0) {
    // 截断态不能说「没有差异」：那会把「没比完」说成「比完了且一样」（真机：大文件超帽）。
    return props.truncated === true
      ? <div className="diff-note">已截断比对：显示帽内的内容未发现不同，超出部分未比对。</div>
      : <div className="diff-empty">没有差异（与快照逐行一致）</div>;
  }
  const api = props.comment;
  const closeEditor = (): void => {
    setEditing(null);
    setEditingNo(null);
    setDraft("");
  };
  const openEditor = (key: string, lineNo: number): void => {
    setEditing(key);
    setEditingNo(lineNo);
    setDraft(api?.comments.get(key) ?? "");
  };
  const commit = (): void => {
    if (editing === null) return;
    const text = draft.trim();
    if (text !== "") api?.onComment(editing, text);
    closeEditor();
  };
  const switchMode = (next: DiffViewMode): void => {
    if (next === mode) return;
    closeEditor();
    setMode(next);
  };
  const commentButton = (line: DiffLineView): React.JSX.Element | null => {
    if (api === undefined) return null;
    // 并排视图只允许评右栏（现在还在的那一行）；左栏是删除基线，不重复给入口。
    const key = lineKeyOf(api, line);
    const has = api.comments.has(key);
    const lineNo = line.newNo ?? line.oldNo ?? 0;
    return (
      <>
        {/* 常驻标记在 hover 组之外：见文件头契约 */}
        {has && (
          <span className="dl-has-comment" title={api.comments.get(key)} aria-label="该行有评注">
            <MessageSquare size={11} aria-hidden="true" />
          </span>
        )}
        <span className="dl-actions">
          <button className="dl-comment" aria-label={`评论第 ${String(lineNo)} 行`} onClick={() => { openEditor(key, lineNo); }}>＋</button>
        </span>
      </>
    );
  };
  return (
    <div className="diff-view" data-view={mode} aria-label="文件差异">
      <div className="diff-view-head">
        <div className="diff-view-tabs" role="group" aria-label="差异视图">
          <button type="button" aria-pressed={mode === "unified"} onClick={() => { switchMode("unified"); }}>统一</button>
          <button type="button" aria-pressed={mode === "split"} onClick={() => { switchMode("split"); }}>并排</button>
        </div>
      </div>
      {mode === "unified" ? (
        <>
          {props.hunks.map((h, i) => (
            <div className="diff-hunk" key={`${h.header}:${String(i)}`}>
              <div className="diff-hunk-head num">{h.header}</div>
              {h.lines.map((l, j) => {
                const lineNo = l.newNo ?? l.oldNo ?? 0;
                const key = api === undefined ? "" : lineKeyOf(api, l);
                const has = api !== undefined && api.comments.has(key);
                return (
                  <div key={j}>
                    <div className={`diff-line ${l.kind}`}>
                      <span className="ln num" aria-hidden="true">{l.oldNo === null ? "" : String(l.oldNo)}</span>
                      <span className="ln num" aria-hidden="true">{l.newNo === null ? "" : String(l.newNo)}</span>
                      <span className="sign" aria-hidden="true">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                      <span className="txt">{l.text}</span>
                      {api !== undefined && has && (
                        <span className="dl-has-comment" title={api.comments.get(key)} aria-label="该行有评注">
                          <MessageSquare size={11} aria-hidden="true" />
                        </span>
                      )}
                      {api !== undefined && (
                        <span className="dl-actions">
                          <button
                            className="dl-comment"
                            aria-label={`评论第 ${String(lineNo)} 行`}
                            onClick={() => { openEditor(key, lineNo); }}
                          >＋</button>
                        </span>
                      )}
                    </div>
                    {editing === key && editingNo !== null && (
                      <CommentEditor lineNo={editingNo} draft={draft} onDraft={setDraft} onCommit={commit} onCancel={closeEditor} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <div className="diff-split" aria-label="并排差异">
          {props.hunks.map((h, i) => (
            <div className="diff-hunk" key={`${h.header}:${String(i)}`}>
              <div className="diff-hunk-head num diff-split-head">{h.header}</div>
              {splitDiffRows(h.lines).map((row, j) => {
                const leftKey = api !== undefined && row.left !== undefined ? lineKeyOf(api, row.left) : null;
                const rightKey = api !== undefined && row.right !== undefined ? lineKeyOf(api, row.right) : null;
                const editorHere = editing !== null && (editing === leftKey || editing === rightKey);
                return (
                  <div className="diff-split-row" key={j}>
                    <div className={`diff-cell ${row.left?.kind ?? "empty"}`}>
                      <span className="ln num" aria-hidden="true">{row.left?.oldNo === null || row.left === undefined ? "" : String(row.left.oldNo)}</span>
                      <span className="sign" aria-hidden="true">{row.left === undefined ? "" : row.left.kind === "del" ? "−" : " "}</span>
                      <span className="txt">{row.left?.text ?? ""}</span>
                    </div>
                    <div className={`diff-cell ${row.right?.kind ?? "empty"}`}>
                      <span className="ln num" aria-hidden="true">{row.right?.newNo === null || row.right === undefined ? "" : String(row.right.newNo)}</span>
                      <span className="sign" aria-hidden="true">{row.right === undefined ? "" : row.right.kind === "add" ? "+" : " "}</span>
                      <span className="txt">{row.right?.text ?? ""}</span>
                      {row.right !== undefined && commentButton(row.right)}
                    </div>
                    {editorHere && editingNo !== null && (
                      <CommentEditor className="diff-split-editor" lineNo={editingNo} draft={draft} onDraft={setDraft} onCommit={commit} onCancel={closeEditor} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {props.truncated === true && (
        <div className="diff-note">已截断（超字节 / 行数帽）——完整差异请用本地工具查看。</div>
      )}
    </div>
  );
}
