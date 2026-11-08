// 浏览器窗格放大层的左边界（从 PaneDock 抽出：PaneDock 已顶到 1200 行帽）。
// 业主口径：只盖中间对话、保留左栏。左边界按中心对话列的真实矩形量，侧栏拖宽/收起/窗口缩放都重算。
import { useEffect, useState } from "react";

export function useMaximizedLeft(maximized: boolean): { maxLeft: number; sync: () => void } {
  const [maxLeft, setMaxLeft] = useState(0);
  const sync = (): void => {
    if (typeof document === "undefined") return;
    const main = document.querySelector<HTMLElement>('[data-dsh-claude-part="center-column"]');
    if (main !== null) setMaxLeft(Math.round(main.getBoundingClientRect().left));
  };
  useEffect(() => {
    if (!maximized) return;
    sync();
    const main = typeof document === "undefined" ? null : document.querySelector<HTMLElement>('[data-dsh-claude-part="center-column"]');
    const ro = typeof ResizeObserver === "undefined" || main === null ? null : new ResizeObserver(sync);
    ro?.observe(main!);
    window.addEventListener("resize", sync);
    return () => { ro?.disconnect(); window.removeEventListener("resize", sync); };
  }, [maximized]);
  return { maxLeft, sync };
}
