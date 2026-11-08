// 对话内查找（⌘F，2026-10-18 对照 Claude 桌面端 Edit > Find…）：在用户/助手正文里找文本。
// 交互：⏎ / ↓ 下一个、⇧⏎ / ↑ 上一个、Esc 关闭。可见部分搜 DOM 的 `.row .t`；折叠轮次的正文不在 DOM 里
// （折叠分支只渲染标题行），按模型行补齐，命中时先展开再定位（第 926 页）。工具行与元信息不参与；
// 高亮用瞬态 class（900ms 自清），不往 Stream 塞匹配态（查找是读面，不改数据）。
import type { StreamRow } from "../derived/stream";
import { isCompositionEnter } from "../ime";
import { scrollBehavior } from "../useStickyScroll";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

/** 命令式入口：⌘G / ⇧⌘G 在输入框失去焦点后也要能步进（Claude Edit > Find Next/Previous 的标准键）。 */
import type { FindBarHandle } from "../app-controls";
export type { FindBarHandle } from "../app-controls";

export interface FindBarProps {
  open: boolean;
  /** 搜索范围：流的滚动容器（streamEl）。null = 还没有会话，只渲染不搜。 */
  container: HTMLElement | null;
  /** 折叠轮次的内容不在 DOM 里（`Stream` 的折叠分支只渲染标题行）⇒ 只搜 DOM 会漏。
   *  传了模型行与折叠集，就能把「已折叠轮次里的命中」也算进来，步进时先展开再定位。 */
  rows?: readonly StreamRow[];
  foldedRounds?: ReadonlySet<number>;
  onExpandRound?: (round: number) => void;
  onClose: () => void;
}

/** 每次查询/步进都重新取一遍 DOM：流式追加或重渲染会换掉旧节点，缓存 Element 会指向已卸载的树。 */
function domHits(container: HTMLElement | null, query: string): HTMLElement[] {
  const q = query.trim().toLowerCase();
  if (q === "" || container === null) return [];
  return [...container.querySelectorAll<HTMLElement>(".row.user .t, .row.assistant .t")]
    .filter((el) => (el.textContent ?? "").toLowerCase().includes(q));
}

const NO_FOLDS: ReadonlySet<number> = new Set<number>();

/** 一次命中：可见行给元素（按文档序），折叠轮次给行号（DOM 里还没有这个节点）。 */
type FindHit = { el: HTMLElement } | { seq: number; round: number };

/** 折叠轮次里的命中（模型行，第 926 页）。折叠分支只渲染「第 N 轮 + 摘要」——正文既不在 DOM、
 *  也不在 .t 里 ⇒ 折叠后 ⌘F 搜不到自己刚折起来的那些轮。只算 user/assistant 正文，与 DOM 同口径。 */
export function foldedHitSeqs(rows: readonly StreamRow[], folded: ReadonlySet<number>, query: string): number[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const out: number[] = [];
  for (const r of rows) {
    if (r.kind !== "user" && r.kind !== "assistant") continue;
    if (!folded.has(r.round)) continue;
    if (!r.text.toLowerCase().includes(q)) continue;
    out.push(r.seq);
  }
  return out;
}

function flash(el: HTMLElement): void {
  // inline: "nearest" ——只定位纵向，不许把祖先（对话列）横向拖走。
  el.scrollIntoView({ block: "center", behavior: scrollBehavior("smooth"), inline: "nearest" });
  const row = el.closest(".row");
  if (!(row instanceof HTMLElement)) return;
  row.classList.remove("find-hit");
  void row.offsetWidth; // 强制重排，让同一个匹配再次跳转也能重播动画
  row.classList.add("find-hit");
  window.setTimeout(() => row.classList.remove("find-hit"), 900);
}

export const FindBar = forwardRef<FindBarHandle, FindBarProps>(function FindBar(props, ref): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setCount(0);
    setIndex(0);
    // 打开即聚焦：面板刚挂载时 autofocus 偶尔被标题栏抢走，延一帧再聚焦（原生查找也是打开即可输）。
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [props.open]);

  /** 命中序列：可见行按文档序在前，折叠轮次里的按行序在后（折叠的节点还不存在，展开后才算可见）。 */
  const collectHits = (value: string): FindHit[] => {
    const visible = domHits(props.container, value).map((el): FindHit => ({ el }));
    const seqs = foldedHitSeqs(props.rows ?? [], props.foldedRounds ?? NO_FOLDS, value);
    const folded = seqs.map((seq): FindHit => {
      const row = (props.rows ?? []).find((r) => r.seq === seq);
      const round = row === undefined || row.kind === "tool" || row.kind === "error" ? 0 : row.round;
      return { seq, round };
    });
    return [...visible, ...folded];
  };

  /** 折叠轮次里的命中：先展开那一轮，等这一帧渲染完再按行锚找节点（拿不到就只展开，不硬闪）。 */
  const revealFolded = (seq: number, round: number): void => {
    props.onExpandRound?.(round);
    window.setTimeout(() => {
      const el = props.container?.querySelector<HTMLElement>(`[data-event-id="${String(seq + 1)}"] .t`);
      if (el !== null && el !== undefined) flash(el);
    }, 0);
  };

  const reveal = (hit: FindHit): void => {
    if ("el" in hit) { flash(hit.el); return; }
    revealFolded(hit.seq, hit.round);
  };

  const search = (value: string): void => {
    setQuery(value);
    const hits = collectHits(value);
    setCount(hits.length);
    setIndex(0);
    if (hits[0] !== undefined) reveal(hits[0]);
  };

  /** 用最新 DOM 重算再走位：计数与位置始终对得上当前流（流式期间也能用）。 */
  const step = (dir: 1 | -1): void => {
    const hits = collectHits(query);
    if (hits.length === 0) {
      setCount(0);
      setIndex(0);
      return;
    }
    const next = (index + dir + hits.length) % hits.length;
    setCount(hits.length);
    setIndex(next);
    reveal(hits[next]!);
  };

  // 钩子必须在早退之前调用（关闭态也要保持 hook 顺序）。
  useImperativeHandle(ref, () => ({ step, focus: () => inputRef.current?.focus() }));

  if (!props.open) return null;

  return (
    <div className="find-bar" role="search" aria-label="在对话中查找">
      <Search size={13} className="find-ico" aria-hidden="true" />
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder="在对话中查找"
        aria-label="查找内容"
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.onClose(); return; }
          if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.stopPropagation(); step(e.shiftKey ? -1 : 1); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); step(1); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); step(-1); }
        }}
      />
      <span className="find-count num" aria-live="polite">
        {query.trim() === "" ? "" : `${String(count === 0 ? 0 : index + 1)}/${String(count)}`}
      </span>
      <button className="find-btn" aria-label="上一个匹配" title="上一个（⇧⏎）" disabled={count === 0} onClick={() => step(-1)}>
        <ChevronUp size={13} />
      </button>
      <button className="find-btn" aria-label="下一个匹配" title="下一个（⏎）" disabled={count === 0} onClick={() => step(1)}>
        <ChevronDown size={13} />
      </button>
      <button className="find-btn" aria-label="关闭查找" title="关闭（Esc）" onClick={props.onClose}>
        <X size={13} />
      </button>
    </div>
  );
});
