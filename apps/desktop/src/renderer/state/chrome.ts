// 状态簇·外观与布局（Phase 2 · 批 2.3）。
//
// 分层契约（见 src/renderer/LAYERING.md）：
//   · 本层**不含 JSX**、**不 import components/**（I2）；
//   · 钩子只吐「状态 + 动作」，不吐界面；
//   · 搬移口径：代码逐行原样搬过来（判卷钉的是声明行与依赖数组的写法，搬家不改写法）。
//
// 装的是哪几样：侧栏（宽度/折叠）、插件侧栏、主题与字号/尺寸档、视图三档、
// 专注模式、右侧检查器、窗格集（含打开顺序）、v6 项目预览。
// 为什么它们住一起：它们**互相咬合**——专注模式要收起检查器、检查器展开要收起窄窗侧栏、
// 开窗格要露出检查器、检查器初始态要看窗格数。一拆开就得靠 ref 互指，越拆越绕。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../src/main/settings";
// 预览状态是**类型**导入（值面留在主进程：project-preview 拖 node:http/child_process，
// 渲染层只消费推送快照；文案在渲染层按 status 组合）。
import type { PreviewSnapshot } from "../../../../../src/main/project-preview";
import { initialInspectorOpen } from "../inspector-pref";
import { lastOpenedPane, PANE_META, type PaneKind } from "../pane-registry";
import { applyTheme, browserThemeEnv, type ThemePref } from "../theme";
import { toast } from "../toast";
import type { ViewMode } from "../view-mode";

/** 侧栏宽度域（2026-10-20 真机还原更正）。
 * 依据：Claude 桌面端 2.42304.2 真机实测——1100×700 原生窗、2× 截图（2200×1400，
 * 倍率严格 2.0，已用 CGWindowList 独立验证 bounds），侧栏/主区接缝在 y=200/400/900/1300
 * 四个高度**完全一致**落在 x=399–400 ⇒ 侧栏宽 **(399−2)/2 = 198.5pt**。
 * 规范 §3.11 写的 242px 与实测差 −19%，据此改域：缺省取 200（198.5 的整数近似）。
 * 上限保留 280（规范既有上限，不因本轮实测收窄）。 */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
export const SIDEBAR_DEFAULT = 256;

/** 主区最小 420 + 检查器最小 320 + 分隔条 3 + 余量 1：不足时先收起侧栏再展开检查器。 */
export const INSPECTOR_SIDEBAR_COLLAPSE_BELOW = 744;
/** 宽屏首次进入会话时自动展开检查器（2026-10-21 三栏工作台）。只在用户**从未表过态**时生效。 */
export const INSPECTOR_AUTO_OPEN_MIN = 1400;

export interface ChromeDeps {
  /** 错误条（预览启动失败等）。 */
  setLastError: (message: string, sessionId?: string) => void;
  /** 提示条（导出回执等）。 */
  setLastNotice: (message: string, sessionId?: string) => void;
  /** 元素选择信号（⌘⇧S）——草稿簇持有，这里只推它。 */
  setPickSignal: React.Dispatch<React.SetStateAction<number>>;
  /** 当前会话（宽屏首进自动展开检查器的判据）。 */
  activeId: string | null;
  /** 当前工作区（预览快照按工作区缓存/推送）。 */
  activeWorkspace: string | null;
  /** 当前工作区的镜像 ref（推送回调闭包只建一次 ⇒ 读 ref 避免过期值）。 */
  activeWorkspaceRef: React.MutableRefObject<string | null>;
}

export interface ChromeState {
  // ── 侧栏 ──
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarWidth: number;
  sidebarWidthRef: React.MutableRefObject<number>;
  persistSidebarWidth: (w: number) => void;
  startSidebarDrag: (e: React.PointerEvent<HTMLDivElement>) => void;
  toggleSidebar: () => void;
  // ── 插件侧栏 ──
  pluginSidebarOpen: boolean;
  pluginSidebarWidth: number;
  setPluginSidebarWidthPersist: (width: number) => void;
  togglePluginSidebar: () => void;
  closePluginSidebar: () => void;
  // ── 外观档 ──
  themePref: ThemePref;
  setThemePref: React.Dispatch<React.SetStateAction<ThemePref>>;
  changeTheme: (next: ThemePref) => void;
  textSize: TextSizeSetting;
  setTextSize: React.Dispatch<React.SetStateAction<TextSizeSetting>>;
  uiSize: UiSizeSetting;
  setUiSize: React.Dispatch<React.SetStateAction<UiSizeSetting>>;
  // ── 视图三档 ──
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  viewToast: string | null;
  setViewToast: React.Dispatch<React.SetStateAction<string | null>>;
  viewRef: React.MutableRefObject<ViewMode>;
  viewToastTimer: React.MutableRefObject<number | null>;
  // ── 专注模式 ──
  focusMode: boolean;
  focusModeRef: React.MutableRefObject<boolean>;
  focusRestoreRef: React.MutableRefObject<{ sidebar: boolean; inspector: boolean; inspectorWidth: number | null } | null>;
  exitFocusRef: React.MutableRefObject<() => void>;
  toggleFocusMode: () => void;
  // ── 右侧检查器 ──
  inspectorCollapsed: boolean;
  setInspectorCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  inspectorDefault: number;
  inspectorRef: React.MutableRefObject<PanelImperativeHandle | null>;
  inspectorColRef: React.MutableRefObject<HTMLDivElement | null>;
  mainGroupRef: React.MutableRefObject<HTMLDivElement | null>;
  inspectorSaveTimer: React.MutableRefObject<number | null>;
  revealInspector: () => void;
  revealInspectorRef: React.MutableRefObject<(() => void) | null>;
  toggleInspector: () => void;
  // ── 窗格集 ──
  paneTabs: PaneKind[];
  setPaneTabs: React.Dispatch<React.SetStateAction<PaneKind[]>>;
  notePaneOpened: (kind: PaneKind) => void;
  togglePane: (kind: PaneKind) => void;
  closePane: (kind: PaneKind) => void;
  closeLastPane: () => boolean;
  openPane: (kind: PaneKind) => void;
  requestPickElement: () => void;
  // ── v6 项目预览 ──
  preview: PreviewSnapshot | null;
  openPreview: (target: string) => Promise<void>;
  exportActiveProject: (projectPath: string) => Promise<void>;
}

export function useChrome(deps: ChromeDeps): ChromeState {
  const { setLastError, setLastNotice, setPickSignal, activeId, activeWorkspace, activeWorkspaceRef } = deps;

  // 侧栏折叠（渲染态，V1 不落 settings）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pluginSidebarOpen, setPluginSidebarOpen] = useState<boolean>(() => {
    try { return window.localStorage.getItem("cairn.pluginSidebar") === "1"; } catch { return false; }
  });
  const [pluginSidebarWidth, setPluginSidebarWidth] = useState<number>(() => {
    try {
      const n = Number(window.localStorage.getItem("cairn.pluginSidebarWidth"));
      return Number.isFinite(n) && n > 0 ? Math.max(280, Math.min(420, n)) : 340;
    } catch { return 340; }
  });
  // 侧栏宽度：可拖拽，持久在 localStorage。
  // 2026-10-20 真机还原更正：Claude 真机实测侧栏 **198.5pt**（1100×700 原生窗 2× 截图，
  // y=200/400/900/1300 四个高度接缝一致）。旧域 240–280（brief 第九节）据此改为
  // 200–280、缺省 200；旧值读回时就地收进新域。
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = Number(window.localStorage.getItem("cairn.sidebar.width"));
      if (Number.isFinite(raw) && raw > 0) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw));
    } catch { /* 读不到用缺省 */ }
    return SIDEBAR_DEFAULT;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const persistSidebarWidth = useCallback((w: number) => {
    const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
    setSidebarWidth(clamped);
    try { window.localStorage.setItem("cairn.sidebar.width", String(clamped)); } catch { /* 存不下则本会话内生效 */ }
  }, []);
  const startSidebarDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    let last = startW;
    // 拖拽期间关掉宽度过渡（2026-10-18）：.side-wrap 上挂着 `transition: width var(--t-fast)`
    // （⌘B 收/开要它），而拖拽是同一个 width 属性逐 pointermove 重写 ⇒ 每次移动都被插值 140ms，
    // 把手肉眼可见地落后于光标、松手又补一段。收/开要过渡、拖拽要即时，靠 data-resizing 分流。
    document.body.dataset.resizing = "sidebar";
    const onMove = (ev: PointerEvent): void => {
      last = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setSidebarWidth(last);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      delete document.body.dataset.resizing;
      try { window.localStorage.setItem("cairn.sidebar.width", String(last)); } catch { /* 同上 */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // 主题（设计规范 §4.6）：settings.theme 单一持有 → data-theme 属性（tokens.css 消费）。
  const [themePref, setThemePref] = useState<ThemePref>("system");
  // 2026-10-18：界面字号档（双轴变体的文字轴）。settings.textSize 单一持有 → html[data-text-size]，
  // tokens.css 的 `--rem-scale` 乘在每一个字号 calc 上 ⇒ 全界面文字一起缩放。
  // CSS 三档（html[data-text-size=sm|md|lg] → --rem-scale .92|1|1.08）早已写好，
  // 此前缺的只是「一个字段 + 这一处赋值」——data-text-size 从来没被任何代码写过。
  const [textSize, setTextSize] = useState<TextSizeSetting>("md");
  // 2026-10-20：组件尺寸档（双轴变体的**尺寸轴**，销 G2）。Claude 实测 data-step="1…5"。
  // 与 textSize 正交：几何令牌乘 --size-scale，字号令牌乘 --rem-scale，
  // 于是「调大字号」不再连带把控件也撑大（规范 §4.5 尾）。
  const [uiSize, setUiSize] = useState<UiSizeSetting>("2");
  // 主题应用（§4.6）：偏好变化即写 data-theme；system 跟随系统并订阅变化（清理函数解除）。
  useEffect(() => applyTheme(themePref, browserThemeEnv()), [themePref]);
  // 头像菜单「外观」子菜单的切主题（批 130）：点选即生效并落盘；
  // 失败要说人话（否则界面停在旧主题，用户以为点了没反应）。
  const changeTheme = useCallback((next: ThemePref) => {
    void window.agent.setSettings({ theme: next }).then(() => {
      setThemePref(next);
    }).catch((err: unknown) => {
      toast.error(`主题切换失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);
  // 2026-10-18 字号档应用：与主题同一形制——单一事实源写一个 data 属性，tokens.css 消费。
  // md 档不写属性（让 --rem-scale 保持 :root 的 1），不往 DOM 上堆无意义的状态。
  useEffect(() => {
    if (textSize === "md") document.documentElement.removeAttribute("data-text-size");
    else document.documentElement.setAttribute("data-text-size", textSize);
  }, [textSize]);
  // 2026-10-20 尺寸档应用：与字号同一形制——单一事实源写一个 data 属性，tokens.css 消费。
  // "2" 档不写属性（让 --size-scale 保持 :root 的 1），不往 DOM 上堆无意义的状态。
  useEffect(() => {
    if (uiSize === "2") document.documentElement.removeAttribute("data-ui-size");
    else document.documentElement.setAttribute("data-ui-size", uiSize);
  }, [uiSize]);

  // 视图三档（蓝本 §3.4）：Ctrl+O 循环，toast 一闪即走（不留常驻态）。
  const [viewMode, setViewMode] = useState<ViewMode>("normal");
  const [viewToast, setViewToast] = useState<string | null>(null);
  const viewToastTimer = useRef<number | null>(null);
  const viewRef = useRef(viewMode);
  viewRef.current = viewMode;

  // ── P3-2 右侧检查器（Inspector）：右 Panel 常驻但默认收起；⌘⌥I 开合；打开窗格时自动露出。──
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const sidebarAutoCollapsedRef = useRef(false);
  const mainGroupRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<PanelImperativeHandle | null>(null);
  const inspectorColRef = useRef<HTMLDivElement | null>(null);
  // 检查器宽度跨重启（2026-10-18）：320–420 内才记（0 = 收起不记）；拖动防抖 300ms 再落盘。
  const [inspectorDefault] = useState<number>(() => {
    try {
      const n = Number(window.localStorage.getItem("cairn.inspector.width"));
      return Number.isFinite(n) && n >= 320 && n <= 420 ? Math.round(n) : 360;
    } catch { return 360; }
  });
  const inspectorSaveTimer = useRef<number | null>(null);
  // 检查器开合状态（2026-10-18）：只记用户显式 ⌘⌥I 的结果；有恢复窗格时窗格优先可见。
  // 用 lazy state，而不是 useRef(IIFE)：useRef 的实参每次渲染都会求值，等于每帧读一次 localStorage。
  const [inspectorPrefSet] = useState<boolean>(() => {
    try { return window.localStorage.getItem("cairn.inspector.open.v1") !== null; } catch { return true; }
  });
  /** 自动展开判据必须读**实时**偏好：用户在第一个会话之前按 ⌘⌥I 关掉，写进了 storage，
   *  但启动快照还是 false；仍读快照会在第一个会话到来时把它强行掰开。 */
  const inspectorPrefSetRef = useRef(inspectorPrefSet);
  const [inspectorDefaultOpen] = useState<boolean>(() => {
    try { return window.localStorage.getItem("cairn.inspector.open.v1") === "1"; } catch { return false; }
  });
  const inspectorAutoOpened = useRef(false);
  // 专注模式（批 101）：只留中栏与输入区。进入时记下侧栏/检查器的开合，退出原样放回；
  // 专注中用户改开侧栏/检查器/窗格 ⇒ 视为放弃专注（不还原旧布局），状态与画面不打架。
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false);
  const focusRestoreRef = useRef<{ sidebar: boolean; inspector: boolean; inspectorWidth: number | null } | null>(null);
  const exitFocusRef = useRef<() => void>(() => undefined);
  const revealInspector = useCallback((): void => {
    // 专注模式里打开窗格/预览/检查器 = 明确要看右栏：先退出专注（不还原旧布局），再展开。
    exitFocusRef.current();
    const ref = inspectorRef.current;
    if (ref === null || !ref.isCollapsed()) return;
    const groupWidth = mainGroupRef.current === null ? window.innerWidth : mainGroupRef.current.getBoundingClientRect().width;
    if (groupWidth < INSPECTOR_SIDEBAR_COLLAPSE_BELOW) {
      if (!sidebarCollapsed) sidebarAutoCollapsedRef.current = true;
      setSidebarCollapsed(true);
      // 2026-10-20 真机：窄窗（主组 < 744）且侧栏开着时，⌘⌥I 第一次只把 storage 写成 "1"、
      // 宽度仍是 0；再按一次才开。两个 rAF 时侧栏 240ms 收起动画还没走完，expand() 被布局
      // 夹回 0。等过渡落定再 expand（与专注模式退出恢复宽度的 240ms 同口径）。
      const expandDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;
      window.setTimeout(() => { inspectorRef.current?.expand(); setInspectorCollapsed(false); }, expandDelay);
      return;
    }
    ref.expand();
  }, [sidebarCollapsed]);
  const revealInspectorRef = useRef<(() => void) | null>(null);
  revealInspectorRef.current = revealInspector; // 供上方 openPreview 绕开 TDZ 调用
  // 宽屏首次进入会话：用户从未显式开合过检查器 ⇒ 自动展开概览（三栏工作台）；
  // 用户关过一次（storage="0"）就不再抢——默认值只在「没有偏好」时生效。
  useEffect(() => {
    if (activeId === null || inspectorAutoOpened.current) return;
    inspectorAutoOpened.current = true;
    if (inspectorPrefSetRef.current) return;
    // 专注模式的承诺是「只留对话与输入」：自动展开会经 revealInspector 顺手退出专注，
    // 用户没按任何键却丢了专注。专注期间不抢，退出后用户自己开。
    if (focusModeRef.current) return;
    if (window.innerWidth < INSPECTOR_AUTO_OPEN_MIN) return;
    if (inspectorRef.current?.isCollapsed() ?? true) revealInspector();
  }, [activeId, revealInspector]);
  const setPluginSidebarWidthPersist = useCallback((width: number): void => {
    const next = Math.max(280, Math.min(420, width));
    setPluginSidebarWidth(next);
    try { window.localStorage.setItem("cairn.pluginSidebarWidth", String(next)); } catch { /* 存储不可用不阻拖动 */ }
  }, []);
  const togglePluginSidebar = useCallback((): void => {
    setPluginSidebarOpen((open) => {
      const next = !open;
      try { window.localStorage.setItem("cairn.pluginSidebar", next ? "1" : "0"); } catch { /* 存储不可用不阻开关 */ }
      return next;
    });
  }, []);
  const closePluginSidebar = useCallback((): void => {
    const active = document.activeElement;
    const fromSidebar = active instanceof HTMLElement && active.closest(".mod-sidebar") !== null;
    setPluginSidebarOpen(false);
    try { window.localStorage.setItem("cairn.pluginSidebar", "0"); } catch { /* 存储不可用不阻关闭 */ }
    // 从侧栏内部关闭时把焦点还给标题栏入口；点外部关闭不抢焦点。
    if (fromSidebar) requestAnimationFrame(() => { document.querySelector<HTMLElement>('[aria-label="插件侧栏"]')?.focus() });
  }, []);
  const toggleSidebar = useCallback((): void => {
    exitFocusRef.current();
    const opening = sidebarCollapsed;
    const groupWidth = mainGroupRef.current === null ? window.innerWidth : mainGroupRef.current.getBoundingClientRect().width;
    sidebarAutoCollapsedRef.current = false;
    if (opening && inspectorRef.current?.isCollapsed() === false && groupWidth - sidebarWidthRef.current < INSPECTOR_SIDEBAR_COLLAPSE_BELOW) {
      inspectorRef.current.collapse();
      // 2026-10-20：imperative collapse() 不保证触发 Panel onResize ⇒ React 仍以为展开、inert 不上、
      // 窄窗自动收起的侧栏也不回开。显式落状态，别只信 resize 回调。
      setInspectorCollapsed(true);
    }
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed]);
  const toggleInspector = useCallback((): void => {
    inspectorPrefSetRef.current = true; // 用户已表态：首屏自动展开从此不再抢
    exitFocusRef.current();
    const ref = inspectorRef.current;
    if (ref === null) return;
    if (ref.isCollapsed()) {
      revealInspector();
      try { window.localStorage.setItem("cairn.inspector.open.v1", "1"); } catch { /* 存不下则忽略 */ }
    } else {
      ref.collapse();
      setInspectorCollapsed(true);
      try { window.localStorage.setItem("cairn.inspector.open.v1", "0"); } catch { /* 同上 */ }
    }
  }, [revealInspector]);
  // 窄窗自动收检查器（2026-10-21 设计重做）：744px 门原先只在「打开检查器」时判，
  // 窗口从 1440 缩到 880 时检查器仍占 320px，正文会被压到 ~350px（真机实证）。
  // 只在窗口 resize 时收；侧栏已收起（rail 模式）时跳过——那时检查器仍有空间。
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  useEffect(() => {
    let timer = 0;
    const onResize = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ref = inspectorRef.current;
        const group = mainGroupRef.current;
        if (ref === null || group === null || ref.isCollapsed()) return;
        // rail 模式检查器仍有空间；用 ref 读当前值，effect 只随窗口 resize 重跑，
        // 不被侧栏/专注模式的状态变化连带触发（评审：否则会把刚恢复的检查器再收掉）。
        if (sidebarCollapsedRef.current) return;
        if (group.getBoundingClientRect().width < INSPECTOR_SIDEBAR_COLLAPSE_BELOW) {
          ref.collapse();
          setInspectorCollapsed(true);
        }
      }, 180);
    };
    onResize(); // 冷启动时也要判一次（上次退出时检查器开着、这次从小窗启动）
    window.addEventListener("resize", onResize);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", onResize); };
  }, []);
  // 专注模式开合（⌘⌥F / 顶栏按钮）：进入 = 收起侧栏与检查器；退出 = 回到进入前的开合。
  // 退出路径只认这一处（⌘⌥F / 按钮）；专注中改开其它 chrome 走 exitFocusRef（不还原）。
  const toggleFocusMode = useCallback((): void => {
    if (focusModeRef.current) {
      focusModeRef.current = false;
      setFocusMode(false);
      const prev = focusRestoreRef.current;
      focusRestoreRef.current = null;
      setSidebarCollapsed(prev?.sidebar ?? false);
      if (prev !== null && !prev.inspector) {
        const width = prev.inspectorWidth;
        window.requestAnimationFrame(() => {
          const ref = inspectorRef.current;
          ref?.expand();
          setInspectorCollapsed(false);
          // 宽度也回到进入前（展开是百分比口径，侧栏同时回开时会重新分配）；等侧栏过渡落定再钉宽。
          if (width !== null) {
            const restoreDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
            window.setTimeout(() => { ref?.resize(width); }, restoreDelay);
          }
        });
      }
      toast("已退出专注模式");
      return;
    }
    {
      const inspector = inspectorRef.current;
      const inspectorOpen = inspector !== null && !inspector.isCollapsed();
      focusRestoreRef.current = {
        sidebar: sidebarCollapsed,
        inspector: !inspectorOpen,
        inspectorWidth: inspectorOpen ? Math.round(inspector.getSize().inPixels) : null,
      };
    }
    focusModeRef.current = true;
    setFocusMode(true);
    setSidebarCollapsed(true);
    inspectorRef.current?.collapse();
    setInspectorCollapsed(true);
    toast("专注模式：只留对话与输入（⌘⌥F 退出）");
  }, [sidebarCollapsed]);
  exitFocusRef.current = () => {
    if (!focusModeRef.current) return;
    focusModeRef.current = false;
    setFocusMode(false);
    focusRestoreRef.current = null;
  };
  useLayoutEffect(() => {
    // 初始收起（brief 七「默认收起」）：layout 时机 collapse，不闪出 360 再收。
    // 恢复内容只在「用户没有显式偏好」时参与决策；显式关掉后带窗格重载必须保持关
    // （旧条件把 paneTabs 放在前面，等于让恢复内容覆盖用户的选择）。
    if (initialInspectorOpen({
      prefSet: inspectorPrefSet,
      defaultOpen: inspectorDefaultOpen,
      paneCount: paneTabs.length,
    })) {
      // 2026-10-20 真机：带窗格重载后 Panel 实际展开（宽 ~293），但 inspectorCollapsed 初值 true
      // ⇒ inert 挂在可见面板上，整列点不动/读屏不念。初始展开必须同步落状态。
      setInspectorCollapsed(false);
      return;
    }
    inspectorRef.current?.collapse();
    setInspectorCollapsed(true);
  }, []);
  useEffect(() => {
    if (!inspectorCollapsed || !sidebarAutoCollapsedRef.current) return;
    sidebarAutoCollapsedRef.current = false;
    setSidebarCollapsed(false);
  }, [inspectorCollapsed]);
  // 检查器收起 ⇒ 整列 inert（2026-10-18）：屏外控件不许进 Tab 序与无障碍树。
  // 为什么不用 hidden/display:none：那会把 react-resizable-panels 正在做的宽度收起动画
  // 一刀砍掉（⌘⌥I 退化成硬切）。inert 同样移出 Tab 序/无障碍树，但保留布局、过渡照常播完。
  // 走 setAttribute（同 ModalSurface 的 imperative 口径）——@types/react 18.3 没有 inert prop。
  useEffect(() => {
    const el = inspectorColRef.current;
    if (el === null) return;
    if (inspectorCollapsed) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [inspectorCollapsed]);

  // 窗格区（蓝本 §3.4）：打开的窗格集（网格化后多窗格同屏、纵向堆叠；渲染态，不落 settings）。
  // 窗格布局跨重启保留（2026-10-18）：上次开着的终端/浏览器/变更…重启后应还在。
  // 只存 kind 列表；终端会挂一个新 PTY、浏览器窗格空着开——各窗格自己的状态（标签/tab）不在此列。
  const [paneTabs, setPaneTabs] = useState<PaneKind[]>(() => {
    try {
      const raw = window.localStorage.getItem("cairn.panes.v1");
      if (raw === null) return [];
      const list: unknown = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      const valid = new Set<string>(Object.keys(PANE_META));
      const seen = new Set<string>();
      return list.filter((k): k is PaneKind => {
        // session 是「⌘+点击某个会话」的临时预览目标，目标本身不落盘；恢复一个空预览没有意义。
        if (typeof k !== "string" || k === "session" || !valid.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem("cairn.panes.v1", JSON.stringify(paneTabs)); } catch { /* 存不下则本会话内生效 */ }
  }, [paneTabs]);
  // 窗格打开顺序（2026-10-18）：只增不减（关掉的不删，lastOpenedPane 会跳过已不在场的）。
  // 为什么单记一份：paneTabs 的数组顺序是**渲染顺序**，会被拖拽/⌥↑⌥↓ 重排；
  // 而 ⌘\ 的文档承诺是「关闭最近打开的窗格」——那是打开顺序，两件事不能共用一个数组。
  const paneOpenOrder = useRef<PaneKind[]>(paneTabs);
  // 当前窗格集的镜像 ref：closeLastPane 要读「此刻开着哪些」，但不能为此把 paneTabs 塞进依赖
  // （那会让回调每次开合窗格都变，快捷键表跟着重建）。镜像 ref 是既有模式（activeIdRef 同用法）。
  const paneTabsRef = useRef<PaneKind[]>(paneTabs);
  paneTabsRef.current = paneTabs;
  const notePaneOpened = useCallback((kind: PaneKind): void => {
    const cur = paneOpenOrder.current;
    if (!cur.includes(kind)) paneOpenOrder.current = [...cur, kind];
  }, []);
  const togglePane = useCallback((kind: PaneKind) => {
    const opening = !paneTabs.includes(kind);
    setPaneTabs((tabs) => (tabs.includes(kind) ? tabs.filter((k) => k !== kind) : [...tabs, kind]));
    if (opening) { notePaneOpened(kind); revealInspector(); } // 打开窗格 ⇒ 右栏可见；检查器内容由 data-panes-open 让位（2026-10-24）
  }, [paneTabs, notePaneOpened, revealInspector]);
  const closePane = useCallback((kind: PaneKind) => {
    setPaneTabs((tabs) => tabs.filter((k) => k !== kind));
  }, []);
  /** ⌘\ 「关闭最近打开的窗格」（2026-10-18 修）：从 paneOpenOrder 里找最后一位仍在场的窗格。
   *  旧实现直接 slice(0,-1) 取数组尾项——数组顺序会被拖拽/⌥↑⌥↓ 重排，重排后关的就不再是
   *  「最近打开」的那个；且空窗格时 slice 仍是空数组、键却被 preventDefault 吞掉，按了没反应。
   *  返回 false = 无可关 ⇒ 调用方别 preventDefault（不吞键）。读 paneTabsRef 而非 paneTabs，
   *  好让本回调保持稳定引用（ shortcuts 表每次渲染重建无谓）。 */
  const closeLastPane = useCallback((): boolean => {
    const target = lastOpenedPane(paneTabsRef.current, paneOpenOrder.current);
    if (target === null) return false;
    setPaneTabs((tabs) => tabs.filter((k) => k !== target));
    return true;
  }, []);
  /** 「＋」菜单/命令面板用：打开（幂等，不做 toggle）。 */
  const openPane = useCallback((kind: PaneKind): void => {
    setPaneTabs((tabs) => (tabs.includes(kind) ? tabs : [...tabs, kind]));
    notePaneOpened(kind);
    revealInspector();
    // 2026-10-24：reveal 保证右栏可见；栏内检查器内容让位（data-panes-open），窗格占满整条侧栏。
  }, [notePaneOpened, revealInspector]);

  // v6 预览：先开浏览器窗格再起服务（就绪后由快照推着导航）；失败按分类文案落到错误条，
  // 不把「点过一次预览」说成「已经能看了」。
  // 传 HTML 文件路径也认（2026-10-15 修）：单文件交付物此前只会拿到 spec 阶段失败
  // 「不是 Cairn 模板项目 + 去用模板新建一个」，而那是错的方向——main 侧 PreviewRuntime
  // 对 .html/.htm 文件走静态服务，URL 直接指向那个文件。
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const previewByPath = useRef(new Map<string, PreviewSnapshot>());
  // v6 预览快照：按工作区缓存（切回工作区能看到上次的状态），推送只刷新当前工作区。
  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    setPreview(activeWorkspace === null ? null : (previewByPath.current.get(activeWorkspace) ?? null));
  }, [activeWorkspace]);
  useEffect(() => {
    const off = window.agent.onPreviewState((s) => {
      previewByPath.current.set(s.projectPath, s);
      if (s.projectPath === activeWorkspaceRef.current) setPreview(s);
    });
    return off;
  }, []);
  const openPreview = useCallback(async (target: string): Promise<void> => {
    let snapshot: PreviewSnapshot;
    try {
      // 已有预览（preparing/starting/ready）就复用，重复点「预览」不重启服务；
      // idle/stopped/failed 才走 start。previewStatus 这条通道由此有了真实消费点。
      const existing = await window.agent.previewStatus(target).catch(() => null);
      snapshot = existing !== null && (existing.status === "preparing" || existing.status === "starting" || existing.status === "ready")
        ? existing
        : await window.agent.previewStart(target);
    } catch (err) {
      setLastError(`预览启动失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setPreview(snapshot);
    previewByPath.current.set(snapshot.projectPath, snapshot);
    if (snapshot.status === "failed") {
      // 失败不开窗格（2026-10-18）：先开再失败会留下一个空白浏览器页，用户还得手动关；
      // 错误条已经说清原因与下一步，窗格只在真有东西可看时出现。
      setLastError(
        `预览失败（${snapshot.stage ?? "未知阶段"}）：${snapshot.message ?? ""}${snapshot.hint !== undefined ? `——${snapshot.hint}` : ""}`,
      );
      return;
    }
    // 2026-10-24：reveal 保证右栏可见；栏内检查器内容让位（data-panes-open），浏览器窗格占满。
    setPaneTabs((tabs) => (tabs.includes("browser") ? tabs : [...tabs, "browser"]));
    notePaneOpened("browser");
    revealInspectorRef.current?.();
  }, [setLastError, notePaneOpened]);

  // v6 导出：用户取消不是错误（不弹失败条）。
  const exportActiveProject = useCallback(async (projectPath: string): Promise<void> => {
    try {
      const r = await window.agent.projectExport(projectPath);
      if (r.ok) {
        setLastNotice(`项目已导出：${r.dest}（${r.copiedFiles} 个文件）`);
        return;
      }
      if (r.cancelled === true) return;
      setLastError(`导出失败：${r.error}`);
    } catch (err) {
      setLastError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setLastError, setLastNotice]);

  // v7 元素选择（§3.6 ⌘⇧S）：开浏览器窗格 + 递增选择信号 + 必须展开检查器。
  const requestPickElement = useCallback(() => {
    setPaneTabs((t) => (t.includes("browser") ? t : [...t, "browser"]));
    notePaneOpened("browser");
    setPickSignal((s) => s + 1);
    // 2026-10-24：reveal 保证右栏可见；栏内检查器内容让位（data-panes-open），浏览器窗格占满。
    revealInspector();
  }, [notePaneOpened, revealInspector]);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    sidebarWidthRef,
    persistSidebarWidth,
    startSidebarDrag,
    toggleSidebar,
    pluginSidebarOpen,
    pluginSidebarWidth,
    setPluginSidebarWidthPersist,
    togglePluginSidebar,
    closePluginSidebar,
    themePref,
    setThemePref,
    changeTheme,
    textSize,
    setTextSize,
    uiSize,
    setUiSize,
    viewMode,
    setViewMode,
    viewToast,
    setViewToast,
    viewRef,
    viewToastTimer,
    focusMode,
    focusModeRef,
    focusRestoreRef,
    exitFocusRef,
    toggleFocusMode,
    inspectorCollapsed,
    setInspectorCollapsed,
    inspectorDefault,
    inspectorRef,
    inspectorColRef,
    mainGroupRef,
    inspectorSaveTimer,
    revealInspector,
    revealInspectorRef,
    toggleInspector,
    paneTabs,
    setPaneTabs,
    notePaneOpened,
    togglePane,
    closePane,
    closeLastPane,
    openPane,
    requestPickElement,
    preview,
    openPreview,
    exportActiveProject,
  };
}
