// 窗格区（蓝本 §3.4 窗格系统，D1 全采纳）：
//   右列容器——**多窗格同屏、纵向堆叠**（react-resizable-panels v4 的 Grid/Cell/Gridline：
//   每格一个窗格、格间分割线可拖行高）。每格自带标题头（标签 + 关闭钮），重开/关闭单一入口。
//   「堆叠要翻」的批评由"格少 + 每格常显标题"回应：≤4 个窗格全可见，没有翻找成本。
//   本轮窗格：变更（diff 审阅，含逐 hunk 展开）/ 方案 / 任务（多 agent）。subagent 详情并入任务窗格。
//   空态诚实：无数据即说明（不摆空壳）；价格不可知显式写"价格不可知"（不当 0）。
// 数据面全部来自 panes.ts 纯投影 + turnDelivery（既有）+ changeDiff（v4 通道，懒加载）。
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle, Check, ChevronRight, Crosshair, ExternalLink, GripVertical, Loader2, MoreHorizontal, PanelsTopLeft, Plus, X } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Cell, Grid, Gridline, useGridRef } from "react-resizable-panels";
import type { AgentEvent } from "../../../../../src/events";
import { turnDelivery } from "../projections";
import { diffCount, useLazyChangeDiff } from "../change-diff-state";
import { MIN_PANE_PCT, loadPaneRows, mergePaneRows, paneRowLayout, savePaneRows } from "../pane-layout";
import { ConfirmDialog } from "./ConfirmDialog";
import { parseUnifiedPatch } from "../diff-patch";
import { ModalSurface } from "./ModalSurface";
import { toast } from "../toast";
import { DiffView } from "./DiffView";
import { FilePane } from "./FilePane";
import { PluginSurface } from "./PluginSurface";
import { SidechatPane } from "./SidechatPane";
import { PathMenu } from "./PathMenu";
import { changedFileCount, composeReviewMessage, PANE_META, PANE_OPENABLE, projectPlans, projectWorkers, reorderTarget, sitePermissionFor, workerCardAction, type PaneKind, type WorkerPaneItem } from "./panes";

// PaneKind / PANE_META 的唯一事实源在 panes.ts（独立窗口路由同用）；此处 re-export 保接口。
export { PANE_META, PANE_OPENABLE, type PaneKind } from "./panes";

const BROWSER_ALLOW_KEY = "cairn.browser.allowedHosts";
const BROWSER_KEEP_COOKIES_KEY = "cairn.browser.keepCookies";

function loadAllowedHosts(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(BROWSER_ALLOW_KEY);
    if (raw === null) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

interface BpTab { key: number; viewId: string }
type BpTabState = { url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean };
type BpPickResult = { ok: boolean; selector?: string; snippet?: string; url?: string; error?: string };

/** 浏览器窗格（v5，WebContentsView；v7 多标签页 + ⋮ 菜单 + 元素选择）：
 *  每标签一个视图 id（本窗格实例前缀 + 序号），只给活动标签同步矩形（切走 = 零矩形隐藏）；
 *  卸载即关全部视图（不留孤儿 WebContents）。站点授权在渲染层先问：本地（localhost/.local）免问；
 *  外站 first-visit 询问。⌘⇧S / 工具钮 = 元素选择（页内按键由主进程捕获、经 browserState.pick 回程；
 *  结果经 onPickResult 回 App 填入输入框）。清除数据只及本独立 profile（persist:cairn-browser）。 */
function BrowserPane(props: {
  initialUrl?: string;
  /** 元素选择信号（App ⌘⇧S 递增；seq 变化触发一次）。 */
  pickSignal?: number;
  /** 选中结果回调（文进输入框；App 侧拼装）。 */
  onPickResult?: (r: { selector: string; snippet: string; url: string }) => void;
}): React.JSX.Element {
  const baseRef = useRef(`bp-${Math.random().toString(36).slice(2, 10)}`);
  const base = baseRef.current;
  const nextKeyRef = useRef(1);
  const [tabs, setTabs] = useState<BpTab[]>(() => [{ key: 0, viewId: `${base}-t0` }]);
  const [activeKey, setActiveKey] = useState(0);
  const [tabStates, setTabStates] = useState<Record<number, BpTabState>>({});
  const [urlDraft, setUrlDraft] = useState("");
  const [pending, setPending] = useState<{ url: string; tabKey: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // 已授权站点（2026-10-18）：⋮ 菜单里要能看见、**逐个**撤销——只给一键全清仍会让用户
  // 为了撤一个站点把其余的也丢掉。
  const [allowedHosts, setAllowedHosts] = useState<readonly string[]>([]);
  // 清除浏览数据前确认（2026-10-18）：菜单项带「…」却当场执行，且不可撤销——先问一句。
  const [confirmClear, setConfirmClear] = useState(false);
  const [keepCookies, setKeepCookies] = useState<boolean>(() => {
    try { return window.localStorage.getItem(BROWSER_KEEP_COOKIES_KEY) !== "0"; } catch { return true; }
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addrRef = useRef<HTMLInputElement | null>(null);
  const permitFirstRef = useRef<HTMLButtonElement | null>(null);
  const allowedRef = useRef<ReadonlySet<string>>(new Set());

  // latest-ref 组：监听器/定时回调只订阅一次，闭包每次渲染取最新值。
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const keyByViewRef = useRef(new Map<string, number>()); keyByViewRef.current = new Map(tabs.map((t) => [t.viewId, t.key]));
  const tabStatesRef = useRef(tabStates); tabStatesRef.current = tabStates;
  const activeViewId = tabs.find((t) => t.key === activeKey)?.viewId ?? null;
  const activeViewRef = useRef<string | null>(null); activeViewRef.current = activeViewId;
  const activeKeyRef = useRef(activeKey); activeKeyRef.current = activeKey;

  // 站点授权弹出时把焦点送进对话框（2026-10-18）：否则键盘用户还停在地址栏，
  // Tab 要穿过整条工具栏才能到「允许/拒绝」。默认聚焦允许本次（与浏览器首访语义一致）。
  useEffect(() => {
    if (pending !== null) permitFirstRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    const hosts = loadAllowedHosts();
    allowedRef.current = hosts;
    setAllowedHosts([...hosts]);
    // 主进程的页内跳转闸读它自己那份集合：启动时先同步一次，避免「界面已忘/从未授权、主进程还在放行」。
    void window.agent.browserSetAllowedHosts([...hosts]).catch(() => undefined);
  }, []);

  const boundsSync = (): void => {
    const vid = activeViewRef.current;
    const el = containerRef.current;
    if (vid === null || el === null) return;
    const r = el.getBoundingClientRect();
    void window.agent.browserBounds(vid, { x: r.left, y: r.top, width: r.width, height: r.height });
  };

  // 视图创建/导航统一入口：创建后立即同步一次矩形（新建的原生视图默认不在容器位）。
  const openIn = (viewId: string, url: string): void => {
    void window.agent.browserOpen(viewId, url).then(() => { requestAnimationFrame(() => { boundsSync(); }); }, () => undefined);
  };

  // 开窗即就绪（2026-10-18）：⌘⇧B 打开浏览器窗格后，光标应已经在地址栏——否则用户还得先点一下。
  // 有初始 URL（项目预览自动导航）时不抢焦点，避免把用户正在输入的 composer 焦点拽走。
  useEffect(() => {
    if (props.initialUrl === undefined || props.initialUrl === "") addrRef.current?.focus();
    // 只在挂载时做一次；后续 URL 变化不重新聚焦。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6 自动预览：项目预览就绪后 URL 由 App 推进来 —— 当前活动标签直接导航（localhost 免站点授权）。
  // 独立 effect：URL 可能在窗格挂载之后才就绪（vite 首次装依赖要等），必须跟着变化再导航。
  useEffect(() => {
    const target = props.initialUrl;
    if (target === undefined || target === "") return;
    setUrlDraft(target);
    const vid = activeViewRef.current;
    if (vid !== null) openIn(vid, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialUrl]);

  // 切换标签：旧视图零矩形（隐藏），新视图同步容器矩形。
  const lastActiveRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastActiveRef.current;
    if (prev !== null && prev !== activeViewId) void window.agent.browserBounds(prev, { x: 0, y: 0, width: 0, height: 0 });
    lastActiveRef.current = activeViewId;
    boundsSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewId]);

  // 选中结果处理（两条来路共用：browserPickElement 直返、页内 ⌘⇧S 经 browserState.pick 回程）。
  const handlePickResult = (r: BpPickResult): void => {
    setPicking(false);
    if (r.ok && r.selector !== undefined) {
      setNotice(`已选中：${r.selector}`);
      props.onPickResult?.({ selector: r.selector, snippet: r.snippet ?? "", url: r.url ?? "" });
    } else {
      setNotice(r.error ?? "选择元素失败");
    }
  };
  const handlePickRef = useRef(handlePickResult); handlePickRef.current = handlePickResult;

  useEffect(() => {
    const off = window.agent.onBrowserState((s) => {
      const key = keyByViewRef.current.get(s.id);
      if (key === undefined) return;
      setTabStates((prev) => ({ ...prev, [key]: { url: s.url, title: s.title, canGoBack: s.canGoBack, canGoForward: s.canGoForward, loading: s.loading } }));
      if (key === activeKeyRef.current && s.url !== "") setUrlDraft(s.url);
      if (s.pick !== undefined) handlePickRef.current(s.pick);
      // 页内跳转/302 被主进程拦下 ⇒ 走与地址栏相同的授权卡（允许一次/记住该域/拒绝）。
      if (s.pending !== undefined) setPending({ url: s.pending.url, tabKey: key });
    });
    return () => {
      off();
      for (const t of tabsRef.current) void window.agent.browserClose(t.viewId); // 卸载即关全部视图
    };
  }, []);

  // 位置同步：容器尺寸/窗口尺寸/滚动（scroll capture 用 window 级监听）变化都回报（活动视图）。
  useEffect(() => {
    boundsSync();
    const el = containerRef.current;
    const ro = new ResizeObserver(() => { boundsSync(); });
    if (el !== null) ro.observe(el);
    window.addEventListener("resize", boundsSync);
    window.addEventListener("scroll", boundsSync, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", boundsSync);
      window.removeEventListener("scroll", boundsSync, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPick = (): void => {
    const vid = activeViewRef.current;
    if (vid === null) { setNotice("先打开一个网页，再选择元素"); return; }
    if (picking) return;
    setPicking(true);
    setNotice("在页面上点选元素（Esc 取消）…");
    void window.agent.browserPickElement(vid).then((r) => { handlePickRef.current(r); }, (err: unknown) => {
      handlePickRef.current({ ok: false, error: `选择元素失败：${err instanceof Error ? err.message : String(err)}` });
    });
  };
  // App 级 ⌘⇧S（焦点在渲染层时）→ seq 触发一次；页内 ⌘⇧S 走主进程回程（见 onBrowserState）。
  const lastPickSignal = useRef(props.pickSignal ?? 0);
  useEffect(() => {
    const sig = props.pickSignal;
    if (sig === undefined || sig === lastPickSignal.current) return;
    lastPickSignal.current = sig;
    doPick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pickSignal]);

  const doClear = (): void => {
    const vid = activeViewRef.current;
    if (vid === null) { setNotice("先打开一个网页，再清除数据"); return; }
    setNotice("正在清除…");
    void window.agent.browserClearData(vid, { keepCookies }).then((r) => {
      setNotice(r.ok ? (keepCookies ? "已清除浏览数据（保留 cookies）" : "已清除浏览数据（含 cookies）") : (r.error ?? "清除失败"));
    }, (err: unknown) => {
      setNotice(`清除失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const toggleKeepCookies = (): void => {
    const v = !keepCookies;
    setKeepCookies(v);
    try { window.localStorage.setItem(BROWSER_KEEP_COOKIES_KEY, v ? "1" : "0"); } catch { /* 存不下则本会话内生效 */ }
  };

  const go = (tabKey: number, target: string): void => {
    const t = target.trim();
    if (t === "") return;
    const withProto = /^https?:\/\//.test(t)
      ? t
      : /^(localhost|127\.|\[?::1\]?)/i.test(t) ? `http://${t}` : `https://${t}`;
    const tab = tabsRef.current.find((x) => x.key === tabKey);
    if (tab === undefined) return;
    const perm = sitePermissionFor(withProto, allowedRef.current);
    if (perm === "ask") { setPending({ url: withProto, tabKey }); return; }
    openIn(tab.viewId, withProto);
  };
  const allowAndGo = (remember: boolean): void => {
    if (pending === null) return;
    if (remember) {
      try {
        const host = new URL(pending.url).hostname.toLowerCase();
        const next = new Set([...allowedRef.current, host]);
        allowedRef.current = next;
        setAllowedHosts([...next]);
        void window.agent.browserSetAllowedHosts([...next]).catch(() => undefined);
        window.localStorage.setItem(BROWSER_ALLOW_KEY, JSON.stringify([...next]));
      } catch { /* 解析不可能失败（进入 pending 前已过 URL 判定）；失败则不记 */ }
    }
    const tab = tabsRef.current.find((x) => x.key === pending.tabKey);
    if (tab !== undefined) openIn(tab.viewId, pending.url);
    setPending(null);
  };

  const switchTab = (key: number): void => {
    setActiveKey(key);
    setUrlDraft(tabStatesRef.current[key]?.url ?? "");
  };
  const addTab = (): void => {
    const key = nextKeyRef.current++;
    setTabs((prev) => [...prev, { key, viewId: `${base}-t${key}` }]);
    setActiveKey(key);
    setUrlDraft("");
    requestAnimationFrame(() => { addrRef.current?.focus(); });
  };
  const closeTab = (key: number): void => {
    const tab = tabsRef.current.find((x) => x.key === key);
    if (tab === undefined) return;
    void window.agent.browserClose(tab.viewId);
    setTabStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
    const rest = tabsRef.current.filter((x) => x.key !== key);
    if (rest.length === 0) {
      // 常留至少一个标签（浏览器式习惯）：关掉最后一个 = 换成一张空白页
      const nk = nextKeyRef.current++;
      setTabs([{ key: nk, viewId: `${base}-t${nk}` }]);
      setActiveKey(nk);
      setUrlDraft("");
      return;
    }
    setTabs(rest);
    if (key === activeKeyRef.current) {
      const idx = tabsRef.current.findIndex((x) => x.key === key);
      const neighbor = rest[Math.max(0, idx - 1)] ?? rest[0];
      setActiveKey(neighbor.key);
      setUrlDraft(tabStatesRef.current[neighbor.key]?.url ?? "");
    }
  };
  const titleOf = (t: BpTab): string => {
    const s = tabStates[t.key];
    if (s === undefined) return "新标签页";
    return s.title !== "" ? s.title : (s.url !== "" ? s.url : "新标签页");
  };
  const actState = tabStates[activeKey] ?? null;
  const nav = (action: "back" | "forward" | "reload"): void => {
    const vid = activeViewRef.current;
    if (vid !== null) void window.agent.browserNav(vid, action);
  };

  return (
    <div className="browser-pane">
      <div className="bp-tabs" role="tablist" aria-label="浏览器标签页">
        {tabs.map((t) => (
          <div key={t.key} className={`bp-tab${t.key === activeKey ? " on" : ""}`}>
            <button
              className="bp-tab-main"
              role="tab"
              aria-selected={t.key === activeKey}
              title={tabStates[t.key]?.url ?? ""}
              onClick={() => switchTab(t.key)}
            >
              <span className="bp-tab-title">{titleOf(t)}</span>
            </button>
            <button className="bp-tab-x" aria-label="关闭标签页" title="关闭标签页" onClick={() => closeTab(t.key)}>
              <X size={10} />
            </button>
          </div>
        ))}
        <button className="bp-tab-add" aria-label="新标签页" title="新标签页" onClick={addTab}>
          <Plus size={12} />
        </button>
      </div>
      <div className="bp-toolbar">
        <button className="iconbtn sm" aria-label="后退" disabled={actState?.canGoBack !== true} onClick={() => nav("back")}>←</button>
        <button className="iconbtn sm" aria-label="前进" disabled={actState?.canGoForward !== true} onClick={() => nav("forward")}>→</button>
        <button className="iconbtn sm" aria-label="刷新" onClick={() => nav("reload")}>⟳</button>
        <input
          ref={addrRef}
          className="bp-url"
          aria-label="地址"
          placeholder="localhost:5173 或 https://…"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(activeKey, urlDraft); }}
        />
        <button className="mini-btn" onClick={() => go(activeKey, urlDraft)}>打开</button>
        <button
          className="iconbtn sm"
          data-on={picking}
          aria-label="选择页面元素"
          title="选择页面元素（⌘⇧S）"
          onClick={doPick}
        >
          <Crosshair size={13} />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="iconbtn sm" aria-label="浏览器菜单" title="浏览器菜单"><MoreHorizontal size={13} /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="pop-rd" side="bottom" align="end" sideOffset={4}>
            <DropdownMenu.Item className="menu-item" onSelect={toggleKeepCookies}>
              <span className="fl-row">
                <span className="fl-label">保留 cookies（登录态）</span>
                {keepCookies && <span className="fl-check" aria-hidden="true">✓</span>}
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => { setConfirmClear(true); }}>清除浏览数据…</DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-sep" />
            <DropdownMenu.Item className="menu-item" disabled>
              <span className="menu-note">已授权站点（{String(allowedHosts.length)}）</span>
            </DropdownMenu.Item>
            {allowedHosts.map((host) => (
              <DropdownMenu.Item
                key={host}
                className="menu-item"
                onSelect={() => {
                  const next = new Set(allowedRef.current);
                  next.delete(host);
                  allowedRef.current = next;
                  setAllowedHosts([...next]);
                  void window.agent.browserSetAllowedHosts([...next]).catch(() => undefined);
                  try {
                    if (next.size === 0) window.localStorage.removeItem(BROWSER_ALLOW_KEY);
                    else window.localStorage.setItem(BROWSER_ALLOW_KEY, JSON.stringify([...next]));
                  } catch { /* 存不下则仅本窗格生效 */ }
                  setNotice(`已移除 ${host} 的授权（下次访问会重新询问）`);
                }}
              >移除 {host}</DropdownMenu.Item>
            ))}
            <DropdownMenu.Item
              className="menu-item"
              disabled={allowedHosts.length === 0}
              onSelect={() => {
                try { window.localStorage.removeItem(BROWSER_ALLOW_KEY); } catch { /* 同上 */ }
                allowedRef.current = new Set();
                setAllowedHosts([]);
                void window.agent.browserSetAllowedHosts([]).catch(() => undefined);
                setNotice("已清除全部已授权站点（下次访问会重新询问）");
              }}
            >忘记全部已授权站点</DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-sep" />
            <DropdownMenu.Item className="menu-item" disabled>
              <span className="menu-note">清除只及本窗格的独立 profile（persist:cairn-browser），不动你的个人浏览器</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      {pending !== null && (
        <div
          className="bp-permit"
          role="alertdialog"
          aria-label="站点授权"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPending(null); }
          }}
        >
          <div className="bp-permit-text">要打开外部站点 <b>{pending.url}</b> 吗？（本地 dev server 与项目文件免授权）</div>
          <div className="bp-permit-actions">
            <button ref={permitFirstRef} className="mini-btn primary" onClick={() => allowAndGo(false)}>允许本次</button>
            <button className="mini-btn" onClick={() => allowAndGo(true)}>记住该域</button>
            <button className="mini-btn danger-text" onClick={() => setPending(null)}>拒绝</button>
          </div>
        </div>
      )}
      {confirmClear && (
        <div className="bp-permit" role="alertdialog" aria-label="清除浏览数据">
          <div className="bp-permit-text">
            清除本窗格的浏览数据{keepCookies ? "（保留 cookies）" : "（含 cookies）"}？此操作不可撤销。
          </div>
          <div className="bp-permit-actions">
            <button className="mini-btn danger-text" onClick={() => { setConfirmClear(false); doClear(); }}>清除</button>
            <button className="mini-btn" onClick={() => { setConfirmClear(false); }}>取消</button>
          </div>
        </div>
      )}
      {notice !== null && <div className="bp-status" role="status">{notice}</div>}
      {actState !== null && (actState.title !== "" || actState.loading) && (
        <div className="bp-status">{actState.loading ? "加载中…" : actState.title}</div>
      )}
      <div className="bp-view" ref={containerRef} aria-label="网页视图（原生视图叠放区）" />
    </div>
  );
}

declare const __IPC_PROTOCOL_VERSION__: number;

/** 终端窗格（macOS）：xterm.js 渲染 + Python PTY 宿主，行列随面板尺寸同步。
 *  xterm 动态 import（SSR/判卷环境不加载 DOM 依赖）；卸载即 kill 终端（不留孤儿 shell）。 */
function TerminalPane(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<{ message: string; canRetry: boolean } | null>(null);
  // 退出后可就地重启（2026-10-18）：此前只把“已退出”写进终端，唯一出路是关窗格再开。
  // gen 递增触发 effect 重跑：旧 xterm 在 cleanup 里 dispose + kill，新会话接在同一 host 上。
  const [exited, setExited] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let alive = true;
    const showError = (message: string, canRetry = true): void => { if (alive) setNotice({ message, canRetry }); };
    let term: import("@xterm/xterm").Terminal | null = null;
    let termId: string | null = null;
    let offData: (() => void) | null = null;
    let offExit: (() => void) | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let resizeSub: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    void Promise.all([window.agent.protocolVersion(), import("@xterm/xterm"), import("@xterm/addon-fit")]).then(([version, { Terminal }, { FitAddon }]) => {
      if (!alive) return;
      if (version !== __IPC_PROTOCOL_VERSION__) { showError("桌面协议版本不一致，请关闭并重新打开应用", false); return; }
      const t = new Terminal({
        fontSize: 12,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        scrollback: 4000,
      });
      const fit = new FitAddon();
      t.loadAddon(fit);
      // 复制/粘贴/全选（2026-10-18）：xterm 默认不把选区写进系统剪贴板，Ctrl/Cmd+V 也不归它管——
      // 终端里选中的文字复制不出来、粘贴不进去，是“按键功能缺失”最典型的一处。只在“主修饰键”上拦：
      // macOS 用 ⌘；其他平台用 Ctrl+Shift（裸 Ctrl+C 必须留给 SIGINT）。
      t.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        const primary = e.metaKey || (e.ctrlKey && e.shiftKey);
        if (!primary) return true;
        const k = e.key.toLowerCase();
        if (k === "a" && !e.shiftKey) { t.selectAll(); return false; }
        if (k === "c") {
          const sel = t.getSelection();
          if (sel !== "") void navigator.clipboard.writeText(sel).catch(() => undefined);
          return false;
        }
        if (k === "v") {
          void navigator.clipboard.readText().then(
            (text) => { if (text !== "") t.paste(text); },
            () => undefined,
          );
          return false;
        }
        return true;
      });
      term = t;
      t.open(host);
      const syncSize = (): void => {
        const id = termId;
        if (!alive || id === null || host.clientWidth === 0 || host.clientHeight === 0) return;
        void window.agent.terminalResize(id, t.cols, t.rows).then((ok) => {
          if (alive && termId === id && !ok) showError("终端尺寸未能同步，请重新启动终端");
        }, (error: unknown) => {
          if (alive && termId === id) showError(`终端尺寸同步失败：${error instanceof Error ? error.message : String(error)}`);
        });
      };
      resizeSub = t.onResize(syncSize);
      // 列数自适应容器宽（此前固定 80 列在窄格被右缘裁切）；容器尺寸变化跟随。
      try { fit.fit(); } catch { /* 容器尺寸为 0 时忽略 */ }
      resizeObserver = new ResizeObserver(() => { try { fit.fit(); } catch { /* 同上 */ } });
      resizeObserver.observe(host);
      offData = window.agent.onTerminalData((e) => { if (termId !== null && e.id === termId) t.write(e.data); });
      offExit = window.agent.onTerminalExit((e) => {
        if (termId !== null && e.id === termId) {
          const why = e.code === null ? "信号终止" : `code ${String(e.code)}`;
          t.write(`\r\n[terminal] 已退出（${why}）——点上方「重新启动」或重开窗格\r\n`);
          termId = null;
          setExited(why);
        }
      });
      dataSub = t.onData((d) => {
        const id = termId;
        if (id === null) return;
        void window.agent.terminalWrite(id, d).then((ok) => {
          if (alive && termId === id && !ok) showError("终端已不可写，请重新启动终端");
        }, (error: unknown) => {
          if (alive && termId === id) showError(`终端输入失败：${error instanceof Error ? error.message : String(error)}`);
        });
      });
      void window.agent.terminalStart().then((r) => {
        if (r === undefined) { showError("通道无应答（主进程未返回终端）"); return; }
        if (!alive) { if (r.ok) void window.agent.terminalKill(r.id); return; }
        if (!r.ok) { showError(r.error); t.write(`[terminal] ${r.error}\r\n`); return; }
        termId = r.id;
        syncSize(); // fit 可能早于 IPC 返回 id；创建完成后必须补初次同步。
      }).catch((err: unknown) => {
        showError(err instanceof Error ? err.message : String(err));
      });
    }).catch((err: unknown) => {
      if (alive) showError(`终端无法启动：${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      alive = false;
      offData?.(); offExit?.(); dataSub?.dispose(); resizeSub?.dispose();
      resizeObserver?.disconnect();
      if (termId !== null) void window.agent.terminalKill(termId);
      term?.dispose();
    };
  }, [gen]);
  return (
    <div className="term-pane">
      {notice !== null && <div className="fp-note err" role="alert">{notice.message}</div>}
      {(exited !== null || notice?.canRetry === true) && (
        <div className="fp-note" role="status">
          {exited !== null && <span>终端已退出（{exited}）</span>}
          <button
            className="mini-btn ghost"
            onClick={() => { setExited(null); setNotice(null); setGen((g) => g + 1); }}
          >重新启动</button>
        </div>
      )}
      <div className="term-host" ref={hostRef} aria-label="终端会话" />
    </div>
  );
}

/** 变更窗格（diff 审阅面）：按轮列改动清单与验证凭据；点文件行懒加载逐 hunk diff（v4 通道）；
 *  行级评注（蓝本 §3.6）：多处评论汇总为一条消息，⌘Enter 一次性提交（复用 send → 新一轮）。 */
function ChangesPane(props: {
  events: readonly AgentEvent[];
  onReview?: (text: string) => void;
  onPathMenu?: (rel: string, kind: "file" | "directory", x: number, y: number) => void;
}): React.JSX.Element {
  const turns = turnDelivery(props.events).filter((t) => t.files.length > 0);
  // 展开位（一次一个文件）；diff 懒加载与请求守卫收口在 change-diff-state.ts
  //（与 Inspector 同一实现；点开才要数据，不预取整会话的全部差异）。
  const { openKey, diff, toggle } = useLazyChangeDiff();
  // 每轮一张卡，但默认只展开最新一轮（2026-10-18 与交付卡同一批：23 轮全展开会把检查器塞满）。
  const [openRound, setOpenRound] = useState<number | null>(() => (turns.length > 0 ? turns[turns.length - 1]!.round : null));
  // 行级评注（行键 `<path>|<line>` → 文本）；提交后清空。
  const [comments, setComments] = useState<ReadonlyMap<string, string>>(new Map());
  const submitReview = (): void => {
    if (comments.size === 0 || props.onReview === undefined) return;
    props.onReview(composeReviewMessage(comments));
    setComments(new Map());
  };
  if (turns.length === 0) {
    return <div className="pane-empty">本会话还没有文件改动。<br />agent 写盘后会在这里按轮列出。</div>;
  }
  const verifyWord = (status: string): string =>
    status === "verified" ? "验证通过"
    : status === "failed" ? "验证失败"
    : status === "stale" ? "验证已过期"
    : status === "absent" ? "未验证"
    : "无需验证";
  const verifyCls = (status: string): string =>
    status === "verified" ? "ok" : status === "failed" ? "bad" : status === "absent" ? "warn" : "dim";
  return (
    <div
      className="changes-pane"
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitReview(); } }}
    >
      {comments.size > 0 && props.onReview !== undefined && (
        <div className="review-bar" role="status">
          <span className="rb-count num">{String(comments.size)} 条评注待提交</span>
          <button className="mini-btn primary" onClick={submitReview}>提交评论（⌘Enter）</button>
          <button className="mini-btn" onClick={() => setComments(new Map())}>清除</button>
        </div>
      )}
      <div className="pane-list">
      {turns.map((t) => (
        <section className="pane-card" key={t.round}>
          <div className="pane-card-head">
            <span className="pc-title">第 {String(t.round)} 轮</span>
            <span className="chip">{String(t.files.length)} 个文件</span>
            <span className={"chip " + verifyCls(t.verification.status)}>{verifyWord(t.verification.status)}</span>
            <button
              type="button"
              className={"pane-card-toggle" + (openRound === t.round ? " on" : "")}
              aria-expanded={openRound === t.round}
              aria-label={openRound === t.round ? "收起这一轮的改动" : "展开这一轮的改动"}
              onClick={() => { setOpenRound(openRound === t.round ? null : t.round); }}
            ><ChevronRight size={11} /></button>
          </div>
          {openRound === t.round && (
          <>
          <ul className="changes-list">
            {t.files.map((f) => {
              const key = `${String(t.round)}:${f.path}`;
              const open = openKey === key;
              return (
                <li className="change-item-wrap" key={`${f.path}:${f.change}`}>
                  <button
                    className={"change-item" + (open ? " open" : "")}
                    aria-expanded={open}
                    onClick={() => toggle(key, f.path, f.snapshotId)}
                    onContextMenu={(e) => { e.preventDefault(); props.onPathMenu?.(f.path, "file", e.clientX, e.clientY); }}
                  >
                    <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
                    <span className={"act " + f.change}>
                      {f.change === "created" ? "新建" : f.change === "modified" ? "修改" : "变更"}
                    </span>
                    <span className="path">{f.path}</span>
                    {f.snapshotId !== undefined && (
                      <span className="snap" title="覆盖前快照已保留（.agent/snapshots）">快照</span>
                    )}
                  </button>
                  {open && (
                    <div className="change-diff-zone">
                      {diff.loading && <div className="pane-empty">正在读快照与当前文件…</div>}
                      {!diff.loading && diff.payload !== null && (
                        diff.payload.ok
                          ? (
                            <>
                              <div className="change-diff-stat num">{`+${String(diffCount(diff.payload.hunks).add)} −${String(diffCount(diff.payload.hunks).del)}`}</div>
                              <DiffView
                                hunks={diff.payload.hunks}
                                truncated={diff.payload.truncated}
                                {...(props.onReview !== undefined
                                  ? {
                                      comment: {
                                        comments,
                                        keyPrefix: `${f.path}|`,
                                        onComment: (lineKey: string, text: string) => {
                                          setComments((prev) => {
                                            const next = new Map(prev);
                                            if (text === "") next.delete(lineKey); else next.set(lineKey, text);
                                            return next;
                                          });
                                        },
                                      },
                                    }
                                  : {})}
                              />
                            </>
                          )
                          : <div className="ap-notice err" role="alert">{diff.payload.error}</div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {t.unverifiedFiles.length > 0 && (
            <div className="consequence">未验证：{t.unverifiedFiles.join("、")}</div>
          )}
          {t.nextAction !== "" && <div className="consequence">→ {t.nextAction}</div>}
          </>
          )}
        </section>
      ))}
      </div>
    </div>
  );
}

/** 方案窗格：全部方案（提交序）+ 决议状态。 */
function PlanPane(props: { events: readonly AgentEvent[] }): React.JSX.Element {
  const plans = projectPlans(props.events);
  if (plans.length === 0) {
    return <div className="pane-empty">本会话还没有提交过方案。<br />模型提请计划后会在审核后留档在这里。</div>;
  }
  const stateWord = (s: string): string => (s === "approved" ? "已批准" : s === "rejected" ? "已拒绝" : "待决");
  const stateCls = (s: string): string => (s === "approved" ? "ok" : s === "rejected" ? "bad" : "warn");
  return (
    <div className="pane-list">
      {plans.map((p) => (
        <section className="pane-card" key={p.callId}>
          <div className="pane-card-head">
            <span className={"chip " + stateCls(p.state)}>{stateWord(p.state)}</span>
            <span className="pc-goal" title={p.goal}>{p.goal}</span>
          </div>
          <ul className="changes-list">
            {p.files.map((f) => (
              <li className="change-item" key={`${f.action}:${f.path}`}>
                <span className={"act " + (f.action === "delete" ? "delete" : f.action === "create" ? "created" : "modified")}>
                  {f.action === "create" ? "新建" : f.action === "delete" ? "删除" : "修改"}
                </span>
                <span className="path">{f.path}</span>
              </li>
            ))}
          </ul>
          {p.approach !== undefined && (
            <details className="delivery-evidence">
              <summary>做法说明</summary>
              <div className="evidence-body">{p.approach}</div>
            </details>
          )}
          {p.verify !== undefined && (
            <div className="consequence">
              验证面：{p.verify.lint ?? "未声明 lint"}{" / "}{p.verify.test ?? "未声明 test"}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** 任务窗格：多 agent 状态（worker 簇）。 */
function TasksPane(props: { events: readonly AgentEvent[] }): React.JSX.Element {
  const workers = projectWorkers(props.events);
  const [ask, setAsk] = useState<{ w: WorkerPaneItem; action: "merge" | "reject" } | null>(null);
  const [diff, setDiff] = useState<{ agentId: string; text: string; hunks: ReturnType<typeof parseUnifiedPatch> } | null>(null);
  if (workers.length === 0) {
    return <div className="pane-empty">本会话还没有派过子任务。<br />agent 派出 worker 后会在这里列出。</div>;
  }
  const statusWord = (s: WorkerPaneItem["status"]): string =>
    s === "running" ? "运行中"
    : s === "waiting_approval" ? "等待审批"
    : s === "waiting_input" ? "等待输入"
    : s === "done" ? "完成"
    : s === "failed" ? "失败"
    : "已取消";
  const verifiedWord = (v: NonNullable<WorkerPaneItem["verified"]>): string =>
    v === "verified" ? "验证通过" : v === "failed" ? "验证失败" : v === "stale" ? "证据过期" : "无验证";
  const showDiff = async (w: WorkerPaneItem): Promise<void> => {
    if (w.diffRef === undefined) return;
    const r = await window.agent.worktreeDiff(w.diffRef);
    if (!r.ok) toast.error(`读取改动失败：${r.error}`);
    else {
      const text = r.patch.trim() === "" ? r.stat : r.patch;
      setDiff({ agentId: w.agentId, text, hunks: parseUnifiedPatch(r.patch) });
    }
  };
  const settle = async (w: WorkerPaneItem, action: "merge" | "reject"): Promise<void> => {
    setAsk(null);
    const r = await window.agent.cardAction({
      ...workerCardAction(w.agentId, w.resultEventId ?? 0, action),
    });
    if (!r.ok) toast.error(`${action === "merge" ? "合并" : "拒绝"}失败：${r.error ?? "未知原因"}`);
    else toast.success(action === "merge" ? "已合并回主工作区" : "已拒绝并清理 worktree");
  };
  return (
    <>
    <div className="pane-list">
      {workers.map((w) => (
        <section className="pane-card" key={w.agentId} data-status={w.status}>
          <div className="pane-card-head">
            <span className={"wk-dot " + w.status} aria-hidden="true">
              {w.status === "running" ? <Loader2 size={12} /> : w.status === "done" ? <Check size={12} /> : w.status === "failed" ? <X size={12} /> : <AlertTriangle size={12} />}
            </span>
            <span className="wk-task" title={w.task}>{w.task}</span>
          </div>
          <div className="wk-meta">
            {w.role !== undefined && <span className="vchip">{w.role}</span>}
            <span className="vchip">{w.mode}</span>
            <span className="vchip">{statusWord(w.status)}</span>
            {w.durationSec !== undefined && <span className="vchip num">{String(w.durationSec)}s</span>}
            {w.verified !== undefined && <span className="vchip">证据：{verifiedWord(w.verified)}</span>}
            {w.status !== "running" && w.status !== "waiting_approval" && w.status !== "waiting_input" && (
              w.spentUsd !== undefined
                ? <span className="vchip num">${w.spentUsd.toFixed(4)}</span>
                : <span className="vchip">价格不可知</span>
            )}
          </div>
          {w.progress.length > 0 && (
            <details className="delivery-evidence">
              <summary>进度 · {String(w.progress.length)} 条</summary>
              <div className="evidence-body">
                {w.progress.map((line, i) => <p className="wk-line" key={i}>{line}</p>)}
              </div>
            </details>
          )}
          {w.summary !== undefined && w.summary !== "" && (
            <div className="evidence-body wk-summary">{w.summary}</div>
          )}
          {w.reason !== undefined && <div className="consequence danger-text">{w.reason}</div>}
          {w.mode === "write" && w.status === "done" && w.resultEventId !== undefined && (
            <div className="wk-actions">
              {w.diffRef !== undefined && <button className="mini-btn ghost" onClick={() => void showDiff(w)}>查看改动…</button>}
              <button className="mini-btn primary" onClick={() => setAsk({ w, action: "merge" })}>合并…</button>
              <button className="mini-btn ghost" onClick={() => setAsk({ w, action: "reject" })}>拒绝…</button>
            </div>
          )}
        </section>
      ))}
    </div>
    {diff !== null && (
      <ModalSurface className="diff-modal" label={`${diff.agentId} 的改动`} onClose={() => setDiff(null)}>
        <div className="diff-modal-head">{diff.agentId} · 改动</div>
        {diff.hunks.length > 0 ? <DiffView hunks={diff.hunks} /> : <pre className="diff-patch">{diff.text}</pre>}
      </ModalSurface>
    )}
    {ask !== null && (
      <ConfirmDialog
        title={ask.action === "merge" ? `合并 ${ask.w.agentId} 的改动？` : `拒绝 ${ask.w.agentId} 的改动？`}
        note={ask.action === "merge"
          ? "把该 worker 的 worktree 变更提交并合并回主工作区；冲突时保留 worktree 供人工处理。"
          : "删除该 worker 的 worktree 与分支；未合并的改动无法恢复。"}
        confirmLabel={ask.action === "merge" ? "合并" : "拒绝"}
        danger={ask.action === "reject"}
        onClose={() => setAsk(null)}
        onConfirm={() => { if (ask !== null) void settle(ask.w, ask.action); }}
      />
    )}
    </>
  );
}

/** 窗格容器（网格化）：tabs 里的每个窗格各占一格、纵向堆叠，格间分割线可拖行高。
 *  tabs 为空时给空态说明（罕见路径——App 侧 tabs 空即整列收起）。 */
export function PaneDock(props: {
  tabs: readonly PaneKind[];
  events: readonly AgentEvent[];
  onClose: (kind: PaneKind) => void;
  onOpen?: (kind: PaneKind) => void;
  /** 行级评注一次性提交的去处（App 传 send → 新一轮/入队）；缺省 = 评注 UI 不出现。 */
  onReview?: (text: string) => void;
  /** 拖标题栏换位（from/to 为 tabs 下标）；缺省 = 不可拖。 */
  onReorder?: (from: number, to: number) => void;
  /** 弹出为独立窗口（缺省 = 无弹出入口）。 */
  onPopout?: (kind: PaneKind) => void;
  /** 独立窗格窗口（弹出的单窗格，PopoutApp 传）：**没有多面板可导航/可恢复**
   *  ⇒ 面板导航行（聚焦某窗格 / 恢复多面板布局）在那里是**死按钮**，
   *  且和窗格自己的标题行叠成两行同样的字（真机截图：弹出窗里两行「终端」）。
   *  ⇒ 独立窗格窗口不渲染那一行。 */
  inPopout?: boolean;
  /** v6 预览地址：browser 窗格就绪后自动导航到这里（缺省 = 只显示手动地址栏）。 */
  browserUrl?: string;
  /** v7 当前会话 id（sidechat 窗格的父会话面；缺省 = 旁路空态提示先开会话）。 */
  sessionId?: string | null;
  /** v7 附为上下文（§2.3 右键菜单）：工作区相对路径 → App 解析绝对路径后进 composer 附件。 */
  onAttach?: (rel: string, kind: "file" | "directory") => void;
  /** v7 元素选择信号（§3.6 ⌘⇧S，App 递增 seq）：browser 窗格据此对活动标签发起一次选择。 */
  pickSignal?: number;
  /** v7 元素选择结果（选择器/片段/页面 URL）→ App 拼文进输入框。 */
  onPickResult?: (r: { selector: string; snippet: string; url: string }) => void;
}): React.JSX.Element {
  // 拖拽换位状态（HTML5 DnD；拖动中的格子给视觉反馈）。
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [focusedPane, setFocusedPane] = useState<PaneKind | null>(null);
  const focused = focusedPane !== null && props.tabs.includes(focusedPane) ? focusedPane : null;
  const previousTabs = useRef(props.tabs);
  const navRef = useRef<HTMLElement | null>(null);
  const closePane = (kind: PaneKind): void => {
    props.onClose(kind);
    // 关闭按钮卸载后将焦点交给剩余窗格，避免键盘用户掉回文档起点。
    window.requestAnimationFrame(() => {
      navRef.current?.querySelector<HTMLButtonElement>(".pane-nav-item")?.focus();
    });
  };
  useEffect(() => {
    const added = props.tabs.find((kind) => !previousTabs.current.includes(kind));
    if (focusedPane !== null) setFocusedPane(added ?? (props.tabs.includes(focusedPane) ? focusedPane : null));
    previousTabs.current = props.tabs;
  }, [props.tabs, focusedPane]);
  // 右键路径菜单（§2.3）：窗格内坐标 + 目标；渲染层自绘（见 PathMenu）。
  const [pathMenu, setPathMenu] = useState<{ x: number; y: number; rel: string; kind: "file" | "directory" } | null>(null);
  const openPathMenu = (rel: string, kind: "file" | "directory", x: number, y: number): void => {
    setPathMenu({ x, y, rel, kind });
  };
  // 行高记忆：Grid 的行轨 id 用窗格 kind（不是行下标），重排/关开后尺寸跟着窗格走。
  const gridRef = useGridRef();
  const tabsSig = props.tabs.join("\u0001");
  const rowTracks = useMemo(
    () => props.tabs.map((kind) => ({ id: kind, minSize: `${MIN_PANE_PCT}%` })),
    // 数组每次渲染都是新引用；tabsSig 是内容签名，等价于「窗格集变了没有」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabsSig],
  );
  const defaultRows = useMemo(
    () => paneRowLayout(props.tabs, loadPaneRows()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabsSig],
  );
  // 窗格集变化（恢复上次布局 / 新开 / 关闭）时把记下的行高放回去。
  // setLayout 触发的 onLayoutChanged 带 isUserInteraction=false，不会回写存储。
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null || props.tabs.length === 0) return;
    grid.setLayout({ rows: paneRowLayout(props.tabs, loadPaneRows()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsSig]);
  if (props.tabs.length === 0) {
    return (
      <aside className="pane-dock" aria-label="窗格区">
        <div className="pane-empty">没有打开的窗格。<br />顶栏「变更」或 ⋮ 菜单可开。</div>
      </aside>
    );
  }
  return (
    <div className="pane-workbench">
    {/* 面板导航行只对「多窗格同屏」有意义：独立窗格窗口里它是死按钮（见 inPopout 注释）。 */}
    {props.inPopout !== true && (
    <nav className="pane-nav" aria-label="面板导航" ref={navRef}>
      <div className="pane-nav-items">
        {props.tabs.map((kind) => <button key={kind} className="pane-nav-item"
          aria-label={`聚焦${PANE_META[kind].label}窗格`} aria-pressed={focused === kind}
          onClick={() => setFocusedPane(kind)}>{PANE_META[kind].label}</button>)}
      </div>
      <button className="iconbtn sm" aria-label="恢复多面板布局" title="恢复多面板布局" aria-pressed={focused === null}
        onClick={() => setFocusedPane(null)}><PanelsTopLeft size={15} /></button>
      {props.onOpen !== undefined && <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button className="iconbtn sm" aria-label="添加面板" title="添加面板"><Plus size={15} /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="pop-rd" sideOffset={5} align="end">
          {PANE_OPENABLE.map((kind) => <DropdownMenu.Item key={kind} className="menu-item"
            onSelect={() => { if (!props.tabs.includes(kind)) props.onOpen?.(kind); setFocusedPane(kind); }}>
            <span>{PANE_META[kind].label}</span>{props.tabs.includes(kind) && <Check size={12} />}
          </DropdownMenu.Item>)}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
    </nav>
    )}
    <Grid
      gridRef={gridRef}
      columns={1}
      rows={rowTracks}
      defaultLayout={{ rows: defaultRows }}
      onLayoutChanged={(layout, meta) => {
        if (focused !== null) return;
        if (!meta.isUserInteraction) return;
        savePaneRows(mergePaneRows(loadPaneRows(), layout.rows, props.tabs));
      }}
      className="pane-grid"
      id="cairn-panes"
      data-focused={focused ?? undefined}
    >
      {props.tabs.map((kind, i) => (
        <Fragment key={kind}>
          {i > 0 && <Gridline type="row" row={i} className="pane-gridline" />}
          <Cell column={0} row={i} className="pane-cell" data-pane={kind} data-focused={focused === kind}>
            <section className="pane-chunk" aria-label={`${PANE_META[kind].label}窗格`}>
              <div
                className="pane-chunk-head"
                draggable={props.onReorder !== undefined}
                data-dragging={dragIndex === i}
                onDragStart={(e) => {
                  if (props.onReorder === undefined) return;
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragIndex !== null && dragIndex !== i) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== i) props.onReorder?.(dragIndex, i);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                // 键盘换位（2026-10-18）：拖拽此前是唯一的换位路径，键盘用户够不着「⋮⋮」。
                // 焦点在窗格头本身时 ⌥↑/⌥↓ 与拖拽同语义（共用 movePane）；方向键留给内部控件。
                tabIndex={props.onReorder !== undefined ? 0 : undefined}
                onKeyDown={(e) => {
                  if (props.onReorder === undefined || e.target !== e.currentTarget) return;
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  const to = reorderTarget(i, e.key, props.tabs.length);
                  if (to === null) return;
                  e.preventDefault();
                  props.onReorder(i, to);
                }}
                title={props.onReorder !== undefined ? "拖动换位（键盘：⌥↑ / ⌥↓）" : undefined}
              >
                {props.onReorder !== undefined && <span className="pc-grip" aria-hidden="true"><GripVertical size={12} /></span>}
                <span className="pc-label">{PANE_META[kind].label}</span>
                {props.onPopout !== undefined && (
                  <button
                    className="pt-x"
                    aria-label={`弹出${PANE_META[kind].label}窗格`}
                    title="弹出为独立窗口"
                    onClick={() => { props.onPopout?.(kind); }}
                  ><ExternalLink size={12} /></button>
                )}
                <button
                  className="pt-x"
                  aria-label={`关闭${PANE_META[kind].label}窗格`}
                  onClick={() => { closePane(kind); }}
                ><X size={11} /></button>
              </div>
              <div className="pane-chunk-body">
                {kind === "changes" && (
                  <ChangesPane
                    events={props.events}
                    {...(props.onReview !== undefined ? { onReview: props.onReview } : {})}
                    onPathMenu={openPathMenu}
                  />
                )}
                {kind === "plan" && <PlanPane events={props.events} />}
                {kind === "tasks" && <TasksPane events={props.events} />}
                {kind === "file" && <FilePane onPathMenu={openPathMenu} />}
                {kind === "terminal" && <TerminalPane />}
                {kind === "browser" && (
                  <BrowserPane
                    {...(props.browserUrl !== undefined ? { initialUrl: props.browserUrl } : {})}
                    {...(props.pickSignal !== undefined ? { pickSignal: props.pickSignal } : {})}
                    {...(props.onPickResult !== undefined ? { onPickResult: props.onPickResult } : {})}
                  />
                )}
                {kind === "sidechat" && <SidechatPane sessionId={props.sessionId ?? null} />}
                {kind === "plugins" && <PluginSurface />}
              </div>
            </section>
          </Cell>
        </Fragment>
      ))}
    </Grid>
    {pathMenu !== null && (
      <PathMenu
        x={pathMenu.x}
        y={pathMenu.y}
        relPath={pathMenu.rel}
        kind={pathMenu.kind}
        onClose={() => setPathMenu(null)}
        {...(props.onAttach !== undefined ? { onAttach: props.onAttach } : {})}
      />
    )}
    </div>
  );
}

