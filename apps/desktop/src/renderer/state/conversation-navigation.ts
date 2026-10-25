import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
import type { StreamRow } from "../projections";
import type { StickyScroll } from "../useStickyScroll";
import type { ViewMode } from "../view-mode";
// useConversationNavigation: extracted without changing event or callback behavior.
import { useCallback,useEffect,useRef } from "react";
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { foldAllButLast } from "../fold-rounds";
import { roundOfEvent } from "../projections";
import { scrollBehavior } from "../useStickyScroll";
import { nextViewMode,VIEW_LABEL } from "../view-mode";

interface ConversationNavigationDeps {
  viewRef: MutableRefObject<ViewMode>;
  hasThinking: boolean;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  setViewToast: Dispatch<SetStateAction<string | null>>;
  viewToastTimer: MutableRefObject<number | null>;
  foldedBySession: MutableRefObject<Map<string, ReadonlySet<number>>>;
  activeId: string | null;
  setFoldedRounds: Dispatch<SetStateAction<ReadonlySet<number>>>;
  outlineTurns: { round: number; text: string; }[];
  setFlashRound: Dispatch<SetStateAction<number | null>>;
  streamEl: HTMLDivElement | null;
  flashRound: number | null;
  events: AgentEvent[];
  activeIdRef: MutableRefObject<string | null>;
  stick: StickyScroll;
  setOutlineOpen: Dispatch<SetStateAction<boolean>>;
  setOutlineCurrent: Dispatch<SetStateAction<number | null>>;
  outlineOpen: boolean;
  streamRows: StreamRow[];
  foldedRounds: ReadonlySet<number>;
}

export function useConversationNavigation(deps: ConversationNavigationDeps) {
  const { viewRef, hasThinking, setViewMode, setViewToast, viewToastTimer, foldedBySession, activeId, setFoldedRounds, outlineTurns, setFlashRound, streamEl, flashRound, events, activeIdRef, stick, setOutlineOpen, setOutlineCurrent, outlineOpen, streamRows, foldedRounds } = deps;
  // Ctrl+O 循环视图三档（§3.4）：toast 一闪即走，不留常驻态。
  const cycleView = useCallback(() => {
    const next = nextViewMode(viewRef.current, hasThinking);
    setViewMode(next);
    setViewToast(VIEW_LABEL[next]);
    if (viewToastTimer.current !== null) window.clearTimeout(viewToastTimer.current);
    viewToastTimer.current = window.setTimeout(() => { setViewToast(null); viewToastTimer.current = null; }, 1600);
  }, [hasThinking]);
  // ── 长对话导航（v7.2）：折叠开合 / 目录跳转 / 折叠全部。折叠按会话记忆（切回还是原样）。──
  const rememberFolds = useCallback((next: ReadonlySet<number>) => {
    foldedBySession.current.set(activeId ?? "", next);
    setFoldedRounds(next);
  }, [activeId]);
  const toggleFoldRound = useCallback((round: number) => {
    setFoldedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round); else next.add(round);
      foldedBySession.current.set(activeId ?? "", next);
      return next;
    });
  }, [activeId]);
  const foldAllTurns = useCallback(() => {
    rememberFolds(foldAllButLast(outlineTurns.map((t) => t.round)));
  }, [outlineTurns, rememberFolds]);
  const unfoldAllTurns = useCallback(() => { rememberFolds(new Set<number>()); }, [rememberFolds]);
  // 目录跳转：目标轮若折叠先展开（DOM 里要有落点），两帧后滚过去 + 该轮用户行闪一下。
  const jumpToRound = useCallback((round: number) => {
    setFoldedRounds((prev) => {
      if (!prev.has(round)) return prev;
      const next = new Set(prev);
      next.delete(round);
      foldedBySession.current.set(activeId ?? "", next);
      return next;
    });
    setFlashRound(round);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = streamEl?.querySelector(`[data-round-anchor="${String(round)}"]`);
      (el instanceof HTMLElement ? (el.closest(".row") ?? el) : null)?.scrollIntoView({ behavior: scrollBehavior("smooth"), block: "start" });
    }));
  }, [activeId, streamEl]);
  // 闪光一跳一闪即走（不留常驻高亮）。
  useEffect(() => {
    if (flashRound === null) return;
    const t = window.setTimeout(() => setFlashRound(null), 1300);
    return () => window.clearTimeout(t);
  }, [flashRound]);
  /** P3-2 时间线跳转：事件 id → 对话中的落点（data-event-id 锚；折叠轮先展开；该轮闪一下定位）。
   *  事件 id 口径 = 事件全序 1-based 行号（Stream 行锚 / roundOfEvent 同一份）。 */
  const jumpToEvent = useCallback((eventId: number) => {
    const round = roundOfEvent(events, eventId);
    if (round !== null) {
      setFoldedRounds((prev) => {
        if (!prev.has(round)) return prev;
        const next = new Set(prev);
        next.delete(round);
        foldedBySession.current.set(activeIdRef.current ?? "", next);
        return next;
      });
      setFlashRound(round);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = streamEl?.querySelector(`[data-event-id="${String(eventId)}"]`);
      // 工具组也可能收起；时间线跳转先沿既有披露入口展开，再定位。
      const toggle = el?.closest(".toolcluster")?.querySelector<HTMLButtonElement>('.tool-group-toggle[aria-expanded="false"]');
      toggle?.click();
      requestAnimationFrame(() => {
        (el instanceof HTMLElement ? el : null)?.scrollIntoView({ behavior: scrollBehavior("smooth"), block: "center" });
      });
    }));
  }, [events, streamEl]);
  // ── P3-1 滚动记忆：Map(sessionId → scrollTop) 存 App 内存——切走存、切回取；回底钮逻辑不动。──
  const scrollMemory = useRef(new Map<string, number>());
  const lastScrollTop = useRef(0);
  const lastScrollOwner = useRef<string | null>(null);
  const lastScrollSession = useRef<string | null>(null);
  const restoreTo = stick.restoreTo;
  useEffect(() => {
    if (streamEl === null) return;
    const onScroll = (): void => {
      lastScrollTop.current = streamEl.scrollTop;
      lastScrollOwner.current = activeIdRef.current;
    };
    streamEl.addEventListener("scroll", onScroll, { passive: true });
    return () => streamEl.removeEventListener("scroll", onScroll);
  }, [streamEl]);
  useEffect(() => {
    // 离场存：读的是上一会话在 DOM 换内容前由 scroll 监听持续刷新的最后位置（本 effect 先于
    // 浏览器对换内容后的 clamp scroll 事件跑，读数不被污染）；owner 守卫——没滚动过的会话
    // 不落盘（lastScrollTop 还揣着上个会话的数，直接存会把别人的位置记到它头上）。
    if (
      lastScrollSession.current !== null &&
      lastScrollSession.current !== activeId &&
      lastScrollOwner.current === lastScrollSession.current
    ) {
      scrollMemory.current.set(lastScrollSession.current, lastScrollTop.current);
    }
    lastScrollSession.current = activeId;
    // 回场取：会话内容异步载入——目标位「可达」（scrollHeight 容纳得下）前逐帧等，早落会被空流
    // clamp 成 0（P3 真机抓到的竞态）；至多 30 帧仍不可达则贴可达上限。instant——不排 smooth
    // 动画队列（与粘底口径一致）；restoreTo 按落点重判贴底，跟底观察器不把回场视口拽回底部。
    const restore = activeId === null ? undefined : scrollMemory.current.get(activeId);
    if (restore === undefined || streamEl === null) return;
    let frames = 0;
    let raf = requestAnimationFrame(function step() {
      if (streamEl.scrollHeight - streamEl.clientHeight >= restore || frames >= 30) {
        restoreTo(restore);
        return;
      }
      frames += 1;
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, streamEl, restoreTo]);
  // 切会话：折叠记忆随会话换（读回该会话的折叠集）；目录/高亮/闪光复位。
  useEffect(() => {
    setFoldedRounds(foldedBySession.current.get(activeId ?? "") ?? new Set<number>());
    setOutlineOpen(false);
    setOutlineCurrent(null);
    setFlashRound(null);
  }, [activeId]);
  // scrollspy（目录开着才算）：随滚动算"当前读到第几轮"（rAF 节流）。
  useEffect(() => {
    if (!outlineOpen) return;
    const el = streamEl;
    if (el === null) return;
    let raf = 0;
    const compute = (): void => {
      let cur: number | null = null;
      const boxTop = el.getBoundingClientRect().top;
      for (const a of el.querySelectorAll<HTMLElement>("[data-round-anchor]")) {
        if (a.getBoundingClientRect().top - boxTop <= 24) cur = Number(a.getAttribute("data-round-anchor"));
        else break;
      }
      setOutlineCurrent(cur);
    };
    const onScroll = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    el.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [outlineOpen, streamRows, foldedRounds, streamEl]);

  return { cycleView, toggleFoldRound, foldAllTurns, unfoldAllTurns, jumpToRound, jumpToEvent };
}
