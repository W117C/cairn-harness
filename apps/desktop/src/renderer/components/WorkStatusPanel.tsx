// 工作状态面板（2026-11-04 业主截图右上角）：顶栏 pill = 当前任务一行（箭头 + 截断文本）；
// 点开浮层 = 进程 N/M（todo_write 清单：✓ 已完成 / ○ 进行中）+ 运行读数（阶段秒数 · 步数）。
// 没有清单且不在运行 ⇒ 不摆（空仪表不是诚实，是噪音）。
//
// 弹层走 **body 门户 + fixed 落位**（createPortal）：标题栏栈内的任何定位形态都会被正文区
// 盖住（真机实锤：连 z 99999 的色块都被 .reading 压住）——Portal 是 Radix 菜单同一条已验证的路。
// 关闭面自管（外点 / Esc；触发钮自己不算外点），不再走 usePopoverDismiss（那把尺认的是插槽）。
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import { STR } from "../strings";
import { currentTodoText, type TodoProjection } from "../derived/todo";

export interface WorkStatusProps {
  running: boolean;
  /** 阶段人话（runPhaseLabel 出品；运行中才有意义）。 */
  phaseLabel: string;
  elapsedSec: number;
  steps: number;
  todos: TodoProjection | null;
}

export function WorkStatusPill(props: WorkStatusProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState({ top: 40, right: 8, maxWidth: 400, maxHeight: 380 });
  const place = useCallback((): void => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r === undefined) return;
    const top = r.bottom + 6;
    const right = Math.min(Math.max(8, window.innerWidth - r.right), Math.max(8, window.innerWidth - 228));
    setPos({ top, right, maxWidth: window.innerWidth - right - 8, maxHeight: Math.max(0, window.innerHeight - top - 8) });
  }, []);
  // 在场条件：运行中（无清单给阶段+耗时）、或有清单可回看。**判据先算，hooks 全部挂完再退**——
  // 早退在 useEffect 之前 = hooks 数量随在场态漂移 = 整窗渲染崩（真机踩过：Rendered fewer hooks）。
  const visible = props.running || props.todos !== null;
  // 外点/Esc 关闭：面板与触发钮都不算外点（含住各自引用判）。
  useEffect(() => {
    if (!open) return;
    if (!visible) { setOpen(false); return; }
    (itemsRef.current ?? panelRef.current)?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    const anchor = btnRef.current?.closest(".tb-right") ?? btnRef.current;
    if (anchor !== null) observer.observe(anchor);
    window.addEventListener("resize", place);
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (panelRef.current?.contains(t) === true) return;
      if (btnRef.current?.contains(t) === true) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (panelRef.current?.contains(document.activeElement)) btnRef.current?.focus({ preventScroll: true });
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, visible, place]);
  if (!visible) return null;
  const current = currentTodoText(props.todos);
  const label = current
    ?? (props.running ? `${props.phaseLabel} · ${String(props.elapsedSec)}s` : null);
  const footer = props.running
    ? `${STR.work.runningLabel} ${String(props.elapsedSec)}s · ${String(props.steps)} ${STR.work.stepsUnit}`
    : null;
  const toggle = (): void => {
    if (!open) place();
    setOpen((v) => !v);
  };
  const panel = (
    <div
      ref={panelRef}
      id={panelId}
      role="region"
      aria-labelledby={`${panelId}-title`}
      tabIndex={-1}
      className={"pop down ws-pop" + (open ? " show" : "")}
      style={{ position: "fixed", left: "auto", ...pos, zIndex: 90 }}
    >
      <div className="ws-panel">
        <div className="ws-head">
          <span className="ws-title" id={`${panelId}-title`}>{STR.work.process}</span>
          {props.todos !== null && (
            <span className="ws-count num">{`${String(props.todos.done)}/${String(props.todos.total)}`}</span>
          )}
        </div>
        {props.todos !== null && props.todos.items.length > 0 && (
          <ul className="ws-items" ref={itemsRef} tabIndex={0} aria-label="任务清单">
            {props.todos.items.map((item, i) => (
              <li key={`${String(i)}:${item.text}`} className={"ws-item" + (item.state === "done" ? " done" : "")}>
                {item.state === "done"
                  ? <CircleCheck size={13} aria-hidden="true" />
                  : <Circle size={13} aria-hidden="true" />}
                <span className="ws-item-text" title={item.text}>{item.text}</span>
              </li>
            ))}
          </ul>
        )}
        {props.todos === null && (
          <div className="ws-empty">{props.running ? "这轮还没有任务清单。" : "最近一轮没有留任务清单。"}</div>
        )}
        {footer !== null && (
          <div className="ws-foot num">{footer}</div>
        )}
      </div>
    </div>
  );
  return (
    <div className="ws-slot">
      <button
        ref={btnRef}
        className="tb-workpill"
        aria-label={STR.work.pillAria}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={STR.work.pillAria}
        onClick={toggle}
      >
        <ArrowRight size={12} aria-hidden="true" />
        <span className="tb-workpill-text">{label ?? STR.work.pillAria}</span>
      </button>
      {/* 客户端走 body 门户（标题栏栈会被正文盖住——真机实锤）；SSR（node 无 document）
          不支持 createPortal，走内联（关态 display:none，判卷 SSR 读的就是它）。 */}
      {typeof document !== "undefined"
        ? (open ? createPortal(panel, document.body) : null)
        : panel}
    </div>
  );
}
