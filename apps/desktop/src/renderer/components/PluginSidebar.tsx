// mod 侧栏（G1 布局挤窄版，2026-10-21）：右侧 280–420px，复用 PluginSurface。
// 拖动/方向键改宽并持久化；主栏被挤窄，不是覆盖层。
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { STR } from "../strings";
import { PluginSurface } from "./PluginSurface";

export function PluginSidebar(props: { width: number; onWidth: (width: number) => void; onClose: () => void; onInvoke: (invoke: string) => void }): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const clampWidth = (n: number): number => Math.max(280, Math.min(420, n));
  useEffect(() => { closeRef.current?.focus(); }, []);
  // 窄窗覆盖层：点侧栏以外的地方收起；宽窗是布局列，不抢点击。
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (window.innerWidth > 1120) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[aria-label="插件侧栏"]') !== null) return;
      props.onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); };
  }, [props.onClose]);
  return (
    <aside ref={rootRef} id="mod-sidebar" className="mod-sidebar" aria-label={STR.pluginSidebar.aria} style={{ width: props.width }}>
      <div
        className="mod-sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={STR.pluginSidebar.resize}
        aria-valuemin={280}
        aria-valuemax={420}
        aria-valuenow={Math.round(props.width)}
        tabIndex={0}
        title={STR.pluginSidebar.resize}
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, width: props.width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = dragRef.current;
          if (start === null) return;
          props.onWidth(clampWidth(start.width + (start.x - e.clientX)));
        }}
        onPointerUp={(e) => {
          dragRef.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onDoubleClick={() => { props.onWidth(340); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            props.onWidth(clampWidth(props.width + (e.key === "ArrowLeft" ? 10 : -10)));
          } else if (e.key === "Home") {
            e.preventDefault();
            props.onWidth(280);
          } else if (e.key === "End") {
            e.preventDefault();
            props.onWidth(420);
          }
        }}
      />
      <div className="mod-sidebar-head">
        <span className="mod-sidebar-title">{STR.pluginSidebar.title}</span>
        <button ref={closeRef} className="iconbtn sm" aria-label={STR.pluginSidebar.close} title={STR.pluginSidebar.close} onClick={props.onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="mod-sidebar-body"><PluginSurface className="mod-plugin-surface" onInvoke={props.onInvoke} /></div>
    </aside>
  );
}
