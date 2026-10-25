// 粘底滚动（spec ③）：流式输出时用户"贴着最新内容"是聊天产品的默认体感。
// 规则（审查修订 ③）：
//   · .stream 有 scroll-behavior:smooth —— 程序化滚动一律 behavior:"instant"，
//     否则高频 scrollTop 写入会排队成动画（掉帧＋"近底"判定抖动）；
//   · 只有滚动位置真的离开底部（用户上滚/跳轮）才解除粘底，浮钮出现；
//   · 用户点浮钮回底用 smooth（人手点的动作允许动画）。
// 2026-10-16（阶段 2 · 回底钮真机复检抓到的挂载竞态）：旧签名收 RefObject，空态启动时 .stream
//   未挂载 ⇒ effect 以 ref.current=null 跑完一次，依赖 [ref] 不变便永不再跑 ⇒ 滚动监听恒未接上、
//   回底钮永不出现（真机实证：scrollTop=120 后 DOM 里没有 .jump-latest）。修复 = 改收**元素本身**
//   （App 以 callback ref 把元素放进 state）：元素一出现 effect 即重跑，监听即接。
// 2026-10-16（P3-1 滚动记忆真机竞态）：新增 restoreTo(记忆位)——会话切回的实例落点：instant 落位
//   后按真实位置重判 pinned/stuck（不在底部即解除粘底），跟底观察器（RO）不再把回场视口拽回底部。
import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 48;

/** 视口是否贴底（纯函数，判卷锚）。 */
export function isNearBottom(m: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= NEAR_BOTTOM_PX;
}

export interface StickyScroll {
  /** true = 视口贴底（此时不显示浮钮）。 */
  stuck: boolean;
  /** true = 视口在顶部（滚离顶部后顶栏渐隐显形）。 */
  atTop: boolean;
  /** 回到底部；behavior 缺省 instant（人手点击请传 "smooth"）。 */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** 回到顶部（⌘↑）；脱离贴底（浮钮随之出现）。 */
  scrollToTop: (behavior?: ScrollBehavior) => void;
  /** 落到任意记忆位（会话切换回场用）：按落点真实位置重判贴底——不在底部即解除粘底，
   *  跟底观察器（RO）不会再把视口拽回底部。 */
  restoreTo: (top: number, behavior?: ScrollBehavior) => void;
}

/** 减少动态时把显式 smooth 降级为 auto（2026-10-18）：CSS 的 scroll-behavior 管不到
 *  `scrollTo({behavior:"smooth"})` 这类 JS 显式请求——入场动效让路了，滚动也得让。
 *  非浏览器/无 matchMedia（判卷 node 环境）→ 原样返回。 */
export function scrollBehavior(wanted: ScrollBehavior): ScrollBehavior {
  if (wanted !== "smooth") return wanted;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  } catch {
    return wanted;
  }
}

export function useStickyScroll(el: HTMLDivElement | null): StickyScroll {
  const [stuck, setStuck] = useState(true);
  const [atTop, setAtTop] = useState(true);
  const pinned = useRef(true);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "instant") => {
    if (el === null) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior(behavior) });
    setStuck(true);
    setAtTop(el.scrollTop <= 1);
  }, [el]);
  const scrollToTop = useCallback((behavior: ScrollBehavior = "instant") => {
    if (el === null) return;
    pinned.current = false;
    el.scrollTo({ top: 0, behavior: scrollBehavior(behavior) });
    // 内容不足一屏时顶部即底部——按真实位置判，不盲目离开贴底。
    setStuck(isNearBottom(el));
    setAtTop(true);
  }, [el]);
  const restoreTo = useCallback((top: number, behavior: ScrollBehavior = "instant") => {
    if (el === null) return;
    el.scrollTo({ top, behavior: scrollBehavior(behavior) });
    // instant 落位后 scrollTop 已同步——按真实落点判贴底（clamp 到上限时即贴底，正确）。
    pinned.current = isNearBottom(el);
    setStuck(pinned.current);
    setAtTop(el.scrollTop <= 1);
  }, [el]);

  useEffect(() => {
    if (el === null) return;
    const onScroll = (): void => {
      pinned.current = isNearBottom(el);
      setStuck(pinned.current);
      setAtTop(el.scrollTop <= 1);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [el]);

  // 内容长高（流式新行、代码块展开）且仍粘底 ⇒ 跟到底。观察内容包裹层（.reading）。
  useEffect(() => {
    if (el === null) return;
    const content = el.firstElementChild;
    if (!content) return;
    const follow = () => {
      if (!pinned.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    };
    const ro = new ResizeObserver(follow);
    ro.observe(content);
    return () => ro.disconnect();
  }, [el]);

  return { stuck, atTop, scrollToBottom, scrollToTop, restoreTo };
}
