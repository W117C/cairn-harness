// C-02 TitleBar（v2.6）：40px 全宽拖拽 chrome——侧栏开关 / 会话标题（对中栏居中）/ 右栏开关。
// hiddenInset 已定（main/index.ts），红绿灯由系统绘制；76px 避让位与原型一致。
import { useEffect, useRef } from "react";
import { Ic } from "./icons";

export function TitleBar(props: {
  title: string;
  sidebarCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleRight: () => void;
}) {
  const titleRef = useRef<HTMLDivElement | null>(null);
  // 标题对齐中栏居中（v2.6）：观察 .main 的几何，同步 left/width（侧栏/右栏开合与窗口变化即时跟上）。
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
      {/* hiddenInset：红绿灯由系统绘制，这里只留 76px 避让位，不画假灯（否则会与系统灯重复） */}
      <div className="traffic" aria-hidden="true"></div>
      <button className="iconbtn" title="折叠侧栏" aria-label="折叠侧栏" onClick={props.onToggleSidebar}>
        <Ic.sidebarLeft size={14} />
      </button>
      <div className="tb-title" ref={titleRef}>{props.title}</div>
      <div className="tb-right">
        <button className="iconbtn" title="折叠/展开右栏" aria-label="切换右侧面板" onClick={props.onToggleRight}>
          <Ic.panelRight size={14} />
        </button>
      </div>
    </header>
  );
}
