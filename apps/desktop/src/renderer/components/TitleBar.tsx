// 顶栏（Claude 蓝本 v1）：窗口 chrome——红绿灯避让位 + 侧栏开关 + 会话名（对中栏居中）+ 右端操作槽 + 拖拽区。
// hiddenInset 已定（main/index.ts），红绿灯由系统绘制，76px 避让位，不画假灯。
// 设计规范 §3.11：聊天顶栏内容行 = 会话名 13px（26px 行）——本组件即那条行 + 拖拽与开关；
// 右端操作槽承接「Changes / ⋮」等窗格入口（蓝本 §3.4 会话标题栏入口）。
import { useEffect, useRef, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";

export function TitleBar(props: {
  title: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** 右端操作槽（窗格入口按钮等；no-drag）。 */
  right?: ReactNode;
}) {
  const titleRef = useRef<HTMLDivElement | null>(null);
  // 标题对齐中栏居中：观察 .main 的几何，同步 left/width（侧栏开合与窗口变化即时跟上）。
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const main = el.closest(".app")?.querySelector(".main");
    if (!main) return;
    const sync = () => {
      const r = main.getBoundingClientRect();
      const host = el.parentElement?.getBoundingClientRect();
      if (host) {
        el.style.left = `${String(r.left - host.left)}px`;
        el.style.width = `${String(r.width)}px`;
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="titlebar">
      {/* hiddenInset：红绿灯由系统绘制，这里只留 76px 避让位 */}
      <div className="traffic" aria-hidden="true"></div>
      <button
        className="iconbtn sm"
        title={props.sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
        aria-label={props.sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft size={14} />
      </button>
      <div className="tb-title" ref={titleRef} title={props.title}>{props.title}</div>
      <div className="tb-right">{props.right}</div>
    </header>
  );
}
