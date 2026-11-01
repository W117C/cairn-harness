import { useRef, useEffect, type RefObject } from "react";
export function usePopoverDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>, triggerRef?: RefObject<HTMLElement | null>): void {
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // 自动聚焦的子组件可能已把 activeElement 移入弹层；显式入口不受挂载顺序影响。
    returnTo.current = triggerRef?.current ?? (active instanceof HTMLElement ? active : null);
    const onDoc = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (target !== null && target.closest?.("[data-radix-popper-content-wrapper]") !== null) return;
      if (ref.current !== null && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      const prev = returnTo.current;
      const cur = document.activeElement;
      const lost = cur === null || cur === document.body || (ref.current !== null && ref.current.contains(cur));
      if (lost && prev !== null && prev.isConnected) prev.focus();
    };
  }, [open, close, ref, triggerRef]);
}
