// 统一工具栏（2026-10-20 批 129 · Apple 统一工具栏 + Claude/Codex「顶栏＝上下文锚点」）：
// 原先是**两条**顶栏——38px 窗口 chrome（居中「Cairn」）+ 26px 会话条（会话名 + 窗格按钮）。
// 规范 §9 批 120/121 在这上面翻过车：批 120 把会话名放进顶栏，批 121 又因「标题出现两次」撤回——
// 真因是两条栏都在；合并成一条，标题任何时刻只出现一次，争点自然消解。
//
// 本组件只管**几何与壳**；内容（重命名态、GoalChip、窗格按钮）由 App 传进来。
//
// 几何（会话名对中栏居中，且永不与右组按钮重叠）：
//   c  = 中栏中心（相对 .app）              ← 标题恒对中栏，标题所在的「带」绕 c 对称
//   带宽 = 2 · min(c − 左界, 右界 − c)      ← 左右各自能借到的空间取小者 ⇒ 长名收窄而不是滑到按钮下
//   左界 = max(左组右沿, 中栏左沿)；右界 = min(中栏右沿, 右组左沿 − 气沟)
// 侧栏收起时中栏左沿自动为 0，公式照样成立。观测 .main / .tb-left / .tb-right 三者：
//   .main 抓窗口缩放、侧栏开合（140ms 过渡 ⇒ 逐帧重算，标题跟着侧栏滑）、检查器开合、专注模式；
//   .tb-right 抓窗格簇的出现/消失、目录按钮的出现、变更徽标数字变宽。
//
// 红绿灯由系统绘制（main/index.ts 的 hiddenInset），这里只留 76px 避让位，不画假灯。
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";

/** 中栏带与右组之间的气沟（px）：标题带右沿不让到按钮贴脸。 */
const GUTTER = 8;

export function TitleBar(props: {
  /** 中栏主体：会话名（可重命名）或主页品牌名。 */
  center: ReactNode;
  /** 紧随标题右侧的附属件（目标芯片）。 */
  aside?: ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** 右端操作槽（窗格入口、专注模式等；no-drag）。 */
  right?: ReactNode;
}) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const band = bandRef.current;
    const host = band?.closest(".app");
    if (!band || !host) return;
    const sync = (): void => {
      const main = host.querySelector(".main");
      if (!main) return;
      const hostRect = host.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const leftRect = leftRef.current?.getBoundingClientRect();
      const rightRect = rightRef.current?.getBoundingClientRect();
      const L = mainRect.left - hostRect.left;
      const M = mainRect.width;
      const c = L + M / 2;
      const leftLimit = Math.max(
        leftRect ? leftRect.right - hostRect.left : L,
        L,
      );
      const rightLimit = Math.min(
        L + M,
        rightRect && rightRect.width > 0 ? rightRect.left - hostRect.left - GUTTER : L + M,
      );
      const half = Math.max(0, Math.min(c - leftLimit, rightLimit - c));
      const width = Math.min(M, half * 2);
      band.style.left = `${String(c - width / 2)}px`;
      band.style.width = `${String(width)}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(host.querySelector(".main") ?? host);
    if (leftRef.current) ro.observe(leftRef.current);
    if (rightRef.current) ro.observe(rightRef.current);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);
  return (
    <header className="titlebar">
      {/* hiddenInset：红绿灯由系统绘制，这里只留 76px 避让位 */}
      <div className="tb-left" ref={leftRef}>
        <div className="traffic" aria-hidden="true"></div>
        <button
          className="iconbtn sm"
          title={props.sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
          aria-label={props.sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
          onClick={props.onToggleSidebar}
        >
          <PanelLeft size={14} />
        </button>
      </div>
      {/* 中栏带：只作定位与居中。本体不接管指针 ⇒ 工具栏的拖拽区照旧覆盖中栏；
          可交互子元素（重命名按钮/输入框、目标芯片）各自 pointer-events:auto + no-drag。 */}
      <div className="tb-center" ref={bandRef}>
        {/* 左右两翼等宽（1fr auto 1fr）⇒ 标题槽恒在带的正中，
            目标芯片在右翼（贴标题右侧）不会把标题挤偏。 */}
        <div className="tb-lead" aria-hidden="true"></div>
        <div className="tb-title-slot">{props.center}</div>
        <div className="tb-trail">{props.aside}</div>
      </div>
      <div className="tb-right" ref={rightRef}>{props.right}</div>
    </header>
  );
}
