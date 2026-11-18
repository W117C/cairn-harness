import { useEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import { appMotionReduced } from "../state/motion-pref";
import { useNativeViewOcclusion } from "../state/native-view-occlusion";

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

const MODAL_STACK: HTMLElement[] = [];

/** 消失过渡时长：与进场（scrim-in --t-fast / panel-in --t-med）对称的一拍，收场不硬切。 */
const EXIT_MS = 150;

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
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ModalSurface(props: ModalSurfaceProps): React.JSX.Element {
  const { label, onClose, onEscapeKeyDown, initialFocusRef, returnFocusRef, className, children, ...rest } = props;
  // 原生视图让位（第 1261 页接线）：模态面挂载期间 WebContentsView 收成零矩形——
  // z-index 盖不过原生层，唯一让位手段是宿主把视图收走；卸载即释放（计数制，叠开安全）。
  useNativeViewOcclusion(true);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const escapeRef = useRef(onEscapeKeyDown);
  const initialRef = useRef(initialFocusRef);
  const returnRef = useRef(returnFocusRef);
  closeRef.current = onClose;
  escapeRef.current = onEscapeKeyDown;
  initialRef.current = initialFocusRef;
  returnRef.current = returnFocusRef;
  // 消失过渡（对标 Claude/Codex 的收场拍）：关闭请求先落 data-closing 播退场，过渡完再真卸载。
  // reduced-motion 直接关（不装模）；收场期间的重复请求幂等忽略。
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const requestClose = (close: () => void): void => {
    if (closingRef.current) return;
    if (appMotionReduced()) { close(); return; }
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => { closingRef.current = false; close(); }, EXIT_MS);
  };

  useEffect(() => {
    if (!closing) return;
    const surface = surfaceRef.current;
    if (surface !== null) {
      surface.setAttribute("data-closing", "true");
      // backdrop 族（modal-backdrop/sheet 外包一层）的遮罩层在父级：一并标记，遮罩与卡同拍淡出。
      surface.parentElement?.setAttribute("data-closing", "true");
    }
  }, [closing]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    MODAL_STACK.push(surface);

    let previousFocus: HTMLElement | null = null;
    let hidden: HiddenState[] = [];

    const onKey = (e: KeyboardEvent): void => {
      if (MODAL_STACK[MODAL_STACK.length - 1] !== surface) return;
      if (e.key === "Escape") {
        // Let the topmost surface consume Escape locally before dismissing it.
        escapeRef.current?.(e);
        const canceled = e.defaultPrevented;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!canceled) requestClose(() => closeRef.current());
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
