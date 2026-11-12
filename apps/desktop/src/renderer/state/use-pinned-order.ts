// 置顶会话拖拽排序（2026-10-31，R3）：参考库 DraggableSessionList 的 4px 死区 / 落点线 / 乐观重排。
// 只作用于置顶段；顺序写 localStorage（视图偏好，不改会话 metadata / IPC）。
// 拖拽用 pointer capture，落点用 elementFromPoint 找同工作区的置顶行；拖完吞掉随后那次 click，
// 避免「拖完顺手开会话」。键盘 Alt+↑/↓ 走同一张顺序表。
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyPinnedOrder,
  moveInOrder,
  orderKeyOf,
  parsePinnedOrder,
  PINNED_ORDER_KEY,
  type DropPosition,
  type OrderableSession,
} from "./pinned-order";

export interface PinnedDragProps {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export interface PinnedRowAttrs {
  "data-pinned"?: "true";
  "data-session-key"?: string;
  "data-dragging"?: "true";
  "data-drop"?: DropPosition;
}

interface DragState {
  key: string;
  workspace: string;
  startX: number;
  startY: number;
  active: boolean;
  pointerId: number;
}

interface DropState {
  key: string;
  position: DropPosition;
}

const DRAG_DEAD_ZONE = 4;
const EMPTY_ROW_ATTRS: PinnedRowAttrs = {};

export interface PinnedOrderApi {
  /** 当前持久化顺序（数组身份随拖拽/键盘排序变化，供调用方做 memo 依赖）。 */
  order: readonly string[];
  ordered<T extends OrderableSession>(list: readonly T[]): T[];
  dragProps(s: OrderableSession): PinnedDragProps;
  rowAttrs(s: OrderableSession): PinnedRowAttrs;
  moveByKeyboard(s: OrderableSession, delta: -1 | 1): void;
}

export function usePinnedOrder(): PinnedOrderApi {
  const [order, setOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return parsePinnedOrder(window.localStorage.getItem(PINNED_ORDER_KEY));
    } catch {
      return [];
    }
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const dragRef = useRef<DragState | null>(null);
  const dropRef = useRef<DropState | null>(null);

  const persist = useCallback((next: string[]): void => {
    orderRef.current = next;
    setOrder(next);
    try {
      window.localStorage.setItem(PINNED_ORDER_KEY, JSON.stringify(next));
    } catch {
      // 视图偏好写失败不打断拖拽；下次启动退回默认序。
    }
  }, []);

  const ordered = useCallback(function orderedList<T extends OrderableSession>(list: readonly T[]): T[] {
    return applyPinnedOrder(list, orderRef.current);
  }, []);

  const onPointerDown = (s: OrderableSession) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || s.pinned !== true || s.archived === true) return;
    const target = e.target as HTMLElement;
    if (target.closest("button,input,textarea,a,[role='menu']") !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      key: orderKeyOf(s),
      workspace: s.workspace,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    if (!drag.active) {
      if (Math.max(Math.abs(e.clientX - drag.startX), Math.abs(e.clientY - drag.startY)) < DRAG_DEAD_ZONE) return;
      drag.active = true;
      setDragging(drag.key);
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-session-key][data-pinned='true']") ?? null;
    const key = hit?.getAttribute("data-session-key") ?? null;
    if (key === null || key === drag.key || key.split("\u0000")[0] !== drag.workspace) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const rect = hit!.getBoundingClientRect();
    const next: DropState = { key, position: e.clientY < rect.top + rect.height / 2 ? "before" : "after" };
    dropRef.current = next;
    setDrop(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancel: boolean): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (drag.active) {
      if (!cancel) {
        const target = dropRef.current;
        if (target !== null) {
          // 基表取 DOM 当前全部置顶键：只拿 drag+target 两个键会漏掉未入表的项，
          // 排序后它们会被当成「未知」排到已知项之后（真机：丙拖到甲后变成 甲丙乙）。
          const visual = [...document.querySelectorAll<HTMLElement>(".session[data-pinned='true'][data-session-key]")]
            .map((el) => el.getAttribute("data-session-key"))
            .filter((key): key is string => key !== null);
          // 旧顺序里可能有当前未渲染的键（搜索/筛选/归档）；并集提交，别把隐藏项挤掉。
          const base = [...new Set([...orderRef.current, ...visual])];
          persist(moveInOrder(base.length > 0 ? base : orderRef.current, drag.key, target.key, target.position));
        }
      }
      // 拖完的那次 click 不该开会话（capture + once；没有 click 时下一拍自清）。
      const swallow = (ev: MouseEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    }
    dropRef.current = null;
    setDrop(null);
    setDragging(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const dragProps = (s: OrderableSession): PinnedDragProps => ({
    onPointerDown: onPointerDown(s),
    onPointerMove,
    onPointerUp: (e) => { endDrag(e, false); },
    onPointerCancel: (e) => { endDrag(e, true); },
  });

  const rowAttrs = (s: OrderableSession): PinnedRowAttrs => {
    // 第 1168 页：非置顶行共用一个空属性对象，别为每行每次渲染新造 {}。
    if (s.pinned !== true) return EMPTY_ROW_ATTRS;
    const key = orderKeyOf(s);
    const attrs: PinnedRowAttrs = { "data-pinned": "true", "data-session-key": key };
    if (dragging === key) attrs["data-dragging"] = "true";
    if (drop !== null && drop.key === key) attrs["data-drop"] = drop.position;
    return attrs;
  };

  const moveByKeyboard = (s: OrderableSession, delta: -1 | 1): void => {
    if (s.pinned !== true || s.archived === true) return;
    const rows = [...document.querySelectorAll<HTMLElement>(".session[data-pinned='true'][data-session-key]")];
    const keys = rows
      .map((el) => el.getAttribute("data-session-key"))
      .filter((key): key is string => key !== null);
    const key = orderKeyOf(s);
    const at = keys.indexOf(key);
    if (at < 0) return;
    const target = keys[at + delta];
    if (target === undefined) return;
    // 同上：旧顺序 ∪ 当前可见键，键盘移动也不会挤掉搜索/归档里的隐藏项。
    persist(moveInOrder([...new Set([...orderRef.current, ...keys])], key, target, delta < 0 ? "before" : "after"));
  };

  return { order, ordered, dragProps, rowAttrs, moveByKeyboard };
}
