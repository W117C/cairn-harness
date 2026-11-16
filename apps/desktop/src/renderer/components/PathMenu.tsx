// 文件路径右键菜单（§2.3）：复制路径（绝对）/ 在 Finder 中显示 / 用默认应用打开 / 附为上下文。
// 渲染层自绘菜单（不走原生 Menu——与设计体系同皮；动作面走 v7 workspacePathAction 通道，
// 路径越界在 main 侧会被 resolveEntry 拒绝）。Esc/点外关闭；data-state="open" 参与全局「浮层优先」判据。
// 键盘契约与项目右键菜单一致：↑↓ 循环、Home/End 到首尾、Tab 关闭（焦点已落在首项）。
import { useEffect, useRef, useState } from "react";
import { menuNavIndex } from "./popover-keys";

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

  // 首项聚焦与焦点归还都只随挂载/卸载跑一次：此前与监听器同放一个 effect、依赖整包 props
  // （每渲染都是新对象），「操作失败 ⇒ setNotice 重渲染」会把焦点从用户按键的位置拽回首项。
  // 关闭时菜单项随卸载消失、焦点掉回 body（第 1260 页）：只在焦点确实丢了时交还右键那一刻的
  // 控件（行按钮）；点了别处 / 焦点已有去处时不抢。
  const returnRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    first.current?.focus();
    return () => {
      const cur = document.activeElement;
      if (cur !== null && cur !== document.body) return;
      const back = returnRef.current;
      if (back !== null && back.isConnected && back !== document.body) back.focus();
    };
  }, []);

  useEffect(() => {
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
  }, [props.onClose]);

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
    <div
      className="path-menu"
      role="menu"
      data-state="open"
      aria-label="路径操作"
      ref={ref}
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        if (e.key === "Tab") { props.onClose(); return; }
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];
        const next = menuNavIndex(e.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        items[next]?.focus();
      }}
    >
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
