import { useRef, useEffect, type RefObject } from "react";
export function usePopoverDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>): void {
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement ? active : null;
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
  }, [open, close, ref]);
}
