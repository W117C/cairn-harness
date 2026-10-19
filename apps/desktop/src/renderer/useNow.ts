// 「N 分钟前」的活时钟（2026-10-18）：页面停留时相对时间不再冻结。
// 共用一条 interval + 订阅集合——每个相对时间标签各自开一条 setInterval 会变成 N 条定时器；
// 这里 N 个订阅者只共享一条，最后一个订阅者卸载时清掉。
// 60s 一档足够：文案最细粒度就是分钟（<60s 才显示「刚刚」）。
import { useEffect, useState } from "react";

type Listener = (nowMs: number) => void;
const listeners = new Set<Listener>();
let timer: number | null = null;

function tick(): void {
  const now = Date.now();
  for (const l of listeners) l(now);
}

/** 订阅共享时钟；返回当前毫秒。组件真正用到它才会重渲染（60s 一次，成本可忽略）。 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const listener: Listener = (n) => setNow(n);
    listeners.add(listener);
    if (timer === null) {
      timer = window.setInterval(tick, intervalMs);
      // 回到前台立即对一次表：后台标签被系统节流时，回来不该还显示「刚刚」。
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [intervalMs]);
  return now;
}

function onVisible(): void {
  if (!document.hidden) tick();
}
