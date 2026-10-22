// 对话内查找（⌘F，2026-10-18 对照 Claude 桌面端 Edit > Find…）：在已渲染的用户/助手正文里找文本。
// 交互：⏎ / ↓ 下一个、⇧⏎ / ↑ 上一个、Esc 关闭。只搜「看得见的正文」（.row .t）——工具行、元信息、
// 折叠摘要不参与；高亮用瞬态 class（900ms 自清），不往 Stream 塞匹配态（查找是读面，不改数据）。
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
  onClose: () => void;
}

/** 每次查询/步进都重新取一遍 DOM：流式追加或重渲染会换掉旧节点，缓存 Element 会指向已卸载的树。 */
function collect(container: HTMLElement | null, query: string): HTMLElement[] {
  const q = query.trim().toLowerCase();
  if (q === "" || container === null) return [];
  return [...container.querySelectorAll<HTMLElement>(".row.user .t, .row.assistant .t")]
    .filter((el) => (el.textContent ?? "").toLowerCase().includes(q));
}

function flash(el: HTMLElement): void {
  el.scrollIntoView({ block: "center", behavior: scrollBehavior("smooth") });
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

  const search = (value: string): void => {
    setQuery(value);
    const hits = collect(props.container, value);
    setCount(hits.length);
    setIndex(0);
    if (hits[0] !== undefined) flash(hits[0]);
  };

  /** 用最新 DOM 重算再走位：计数与位置始终对得上当前流（流式期间也能用）。 */
  const step = (dir: 1 | -1): void => {
    const hits = collect(props.container, query);
    if (hits.length === 0) {
      setCount(0);
      setIndex(0);
      return;
    }
    const next = (index + dir + hits.length) % hits.length;
    setCount(hits.length);
    setIndex(next);
    flash(hits[next]!);
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
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); step(e.shiftKey ? -1 : 1); return; }
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
