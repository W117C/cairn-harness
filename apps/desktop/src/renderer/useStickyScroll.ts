// 粘底滚动（spec ③）：流式输出时用户"贴着最新内容"是聊天产品的默认体感。
// 规则（审查修订 ③）：
//   · .stream 有 scroll-behavior:smooth —— 程序化滚动一律 behavior:"instant"，
//     否则高频 scrollTop 写入会排队成动画（掉帧＋"近底"判定抖动）；
//   · 只有滚动位置真的离开底部（用户上滚/跳轮）才解除粘底，浮钮出现；
//   · 用户点浮钮回底用 smooth（人手点的动作允许动画）。
import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 48;

export interface StickyScroll {
  /** true = 视口贴底（此时不显示浮钮）。 */
  stuck: boolean;
  /** 回到底部；behavior 缺省 instant（人手点击请传 "smooth"）。 */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export function useStickyScroll(ref: React.RefObject<HTMLDivElement | null>): StickyScroll {
  const [stuck, setStuck] = useState(true);
  const pinned = useRef(true);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "instant") => {
    const el = ref.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setStuck(true);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      pinned.current = nearBottom;
      setStuck(nearBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);

  // 内容长高（流式新行、代码块展开）且仍粘底 ⇒ 跟到底。观察内容包裹层（.reading）。
  useEffect(() => {
    const el = ref.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const follow = () => {
      if (!pinned.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    };
    const ro = new ResizeObserver(follow);
    ro.observe(content);
    return () => ro.disconnect();
  }, [ref]);

  return { stuck, scrollToBottom };
}
