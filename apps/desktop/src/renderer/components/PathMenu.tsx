// 文件路径右键菜单（§2.3）：复制路径（绝对）/ 在 Finder 中显示 / 用默认应用打开 / 附为上下文。
// 渲染层自绘菜单（不走原生 Menu——与设计体系同皮；动作面走 v7 workspacePathAction 通道，
// 路径越界在 main 侧会被 resolveEntry 拒绝）。Esc/点外关闭；data-state="open" 参与全局「浮层优先」判据。
import { useEffect, useRef, useState } from "react";

export function PathMenu(props: {
  x: number;
  y: number;
  relPath: string;
  kind: "file" | "directory";
  onClose: () => void;
  /** 附为上下文（App 解析成绝对路径后塞进 composer 附件）；缺省 = 不显示该行。 */
  onAttach?: (rel: string, kind: "file" | "directory") => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    first.current?.focus();
    const onDoc = (e: MouseEvent): void => {
      if (ref.current !== null && e.target instanceof Node && ref.current.contains(e.target)) return;
      props.onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.stopPropagation(); props.onClose(); }
    };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [props]);

  const act = (action: "abs" | "reveal" | "open"): void => {
    void window.agent.workspacePathAction(props.relPath, action).then((r) => {
      if (!r.ok) { setNotice(r.error ?? "操作失败"); return; }
      if (action === "abs") {
        void navigator.clipboard.writeText(r.path ?? "").then(() => props.onClose(), (err: unknown) => {
          setNotice(`复制失败：${err instanceof Error ? err.message : String(err)}`);
        });
        return;
      }
      props.onClose();
    }, (err: unknown) => {
      setNotice(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const x = Math.min(props.x, Math.max(8, window.innerWidth - 232));
  const y = Math.min(props.y, Math.max(8, window.innerHeight - 176));
  return (
    <div className="path-menu" role="menu" data-state="open" aria-label="路径操作" ref={ref} style={{ left: x, top: y }}>
      <div className="pm-head" title={props.relPath}>{props.relPath}</div>
      <button ref={first} className="menu-item" role="menuitem" onClick={() => { act("abs"); }}>复制路径（绝对）</button>
      <button className="menu-item" role="menuitem" onClick={() => { act("reveal"); }}>在 Finder 中显示</button>
      <button className="menu-item" role="menuitem" onClick={() => { act("open"); }}>用默认应用打开</button>
      {props.onAttach !== undefined && (
        <button className="menu-item" role="menuitem" onClick={() => { props.onAttach?.(props.relPath, props.kind); props.onClose(); }}>附为上下文</button>
      )}
      {notice !== null && <div className="pm-note" role="alert">{notice}</div>}
    </div>
  );
}
