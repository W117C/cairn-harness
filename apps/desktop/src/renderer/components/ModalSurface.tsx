import { useEffect, useRef, type HTMLAttributes, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

const MODAL_STACK: HTMLElement[] = [];

interface HiddenState {
  el: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

/** 只隔离弹层之外的兄弟子树，不把弹层自身或祖先设成 inert。 */
function isolateOutside(surface: HTMLElement): HiddenState[] {
  const states = new Map<HTMLElement, HiddenState>();
  let child = surface;
  while (child.parentElement !== null) {
    const parent = child.parentElement;
    for (const sibling of [...parent.children]) {
      if (sibling === child || !(sibling instanceof HTMLElement)) continue;
      if (["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(sibling.tagName)) continue;
      if (states.has(sibling)) continue;
      const state = {
        el: sibling,
        inert: sibling.hasAttribute("inert"),
        ariaHidden: sibling.getAttribute("aria-hidden"),
      };
      states.set(sibling, state);
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    if (parent === document.body) break;
    child = parent;
  }
  return [...states.values()];
}

function focusableWithin(surface: HTMLElement): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((el) => el.getClientRects().length > 0);
}

type ModalSurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "aria-modal" | "aria-label" | "tabIndex"> & {
  label: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ModalSurface(props: ModalSurfaceProps): React.JSX.Element {
  const { label, onClose, initialFocusRef, returnFocusRef, className, children, ...rest } = props;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const initialRef = useRef(initialFocusRef);
  const returnRef = useRef(returnFocusRef);
  closeRef.current = onClose;
  initialRef.current = initialFocusRef;
  returnRef.current = returnFocusRef;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    MODAL_STACK.push(surface);

    let previousFocus: HTMLElement | null = null;
    let hidden: HiddenState[] = [];

    const onKey = (e: KeyboardEvent): void => {
      if (MODAL_STACK[MODAL_STACK.length - 1] !== surface) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableWithin(surface);
      if (items.length === 0) {
        e.preventDefault();
        surface.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === surface || !surface.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === surface || !surface.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey, true);
    const activate = (): void => {
      const explicitReturn = returnRef.current?.current;
      previousFocus = explicitReturn !== null && explicitReturn !== undefined && explicitReturn.isConnected
        ? explicitReturn
        : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      hidden = isolateOutside(surface);
      const preferred = initialRef.current?.current;
      const first = preferred !== null && preferred !== undefined && surface.contains(preferred) && preferred.getClientRects().length > 0
        ? preferred
        : focusableWithin(surface)[0];
      if (first !== undefined) first.focus(); else surface.focus();
    };
    // Radix 在关闭菜单时会用 setTimeout(0) 把焦点还给触发器，并清理自己的
    // aria-hidden。第一轮等待它入队，第二轮等它完成后再采集真实状态。
    let init = window.setTimeout(() => {
      init = window.setTimeout(activate, 0);
    }, 0);

    return () => {
      window.clearTimeout(init);
      window.removeEventListener("keydown", onKey, true);
      const stackIndex = MODAL_STACK.lastIndexOf(surface);
      if (stackIndex >= 0) MODAL_STACK.splice(stackIndex, 1);
      for (const state of hidden.reverse()) {
        if (!state.inert) state.el.removeAttribute("inert");
        if (state.ariaHidden === null) state.el.removeAttribute("aria-hidden");
        else state.el.setAttribute("aria-hidden", state.ariaHidden);
      }
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      {...rest}
      ref={surfaceRef}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-modal-surface="true"
    >
      {children}
    </div>
  );
}
