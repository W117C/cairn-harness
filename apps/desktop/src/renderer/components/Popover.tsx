// 共享弹层基座（《全局 UI 视觉重构》brief 交付方式 2「通用组件先行」· 阶段 1）：
// ① <Popover> 展示件——从 Composer 内联 Pop + ModelPicker 自带容器收编而来，类族逐字节
//    同形（`pop {up|down} [show] [className]`），role / style / onKeyDown 等经 rest 透传；
//    视觉统一（surface + 描边 + 14 圆角 + 8px 内距 + 轻阴影）留到阶段 5 在本文件单点改。
// ② usePopoverDismiss——「外点关闭 + Esc 关闭」的单源实现（原 ModelPicker 内联逻辑上移，
//    行为不变：mousedown 冒泡相位、Esc 全局 keydown）。
// ③ useMenuKeyboard——自绘菜单的 WAI-ARIA 方向键导航（↑↓ 环形 / Home / End），
//    以及关闭后把焦点还给触发按钮（键盘用户 Esc 后不再掉到 body）。
// 纪律：弹层开合状态仍归各消费组件（受控）；这里只提供基座与关闭监听，不持有状态。
import { useCallback,type HTMLAttributes,type KeyboardEvent as ReactKeyboardEvent,type ReactNode,type RefObject } from "react";
import { menuNavIndex } from "./popover-keys";

export function Popover(props: {
  open: boolean;
  up?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const { open, up, className, children, ...rest } = props;
  return (
    <div
      className={`pop${up === true ? " up" : " down"}${open ? " show" : ""}${className !== undefined ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 外点 / Esc 关闭（open=false 时不挂监听；close 须稳定——用 useCallback 包）。
 *  Radix 门户豁免（P2-1）：触发源在 `[data-radix-popper-content-wrapper]`（Radix 弹层门户，
 *  挂在 body 上）里时不算「外点」——弹层内嵌的 Radix 子菜单（如空屏 chip 复用 AddProjectMenu）
 *  点选时 mousedown 落在门户里，若照判 contains 会把宿主弹层一起关掉、点选落空。
 *  关闭后焦点归还（2026-10-18）：Esc / 键盘选中让焦点离开被卸载的菜单时回到打开前的元素；
 *  外点关闭不抢焦点（用户点哪儿焦点就该在哪儿）。 */
export { usePopoverDismiss } from "../usePopoverDismiss";

/** 自绘菜单的方向键导航（菜单按钮 + 菜单同一容器上挂 onKeyDown）：
 *  - 关着时 ↓/↑ 打开菜单并聚焦首/末项（菜单项在关态仍挂 DOM，等开态渲染后下一帧再聚焦）；
 *  - 开着时 ↓/↑ 环形移动、Home/End 直达两端；不处理 Enter/Space（原生 button 自己触发）。
 *  Esc 仍由 usePopoverDismiss 负责，此处不重复。 */
export function useMenuKeyboard(
  open: boolean,
  setOpen: (open: boolean) => void,
  ref: RefObject<HTMLElement | null>,
): (e: ReactKeyboardEvent<HTMLElement>) => void {
  return useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const itemsOf = (): HTMLElement[] =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)") ?? []);
    if (!open) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      setOpen(true);
      const up = e.key === "ArrowUp";
      requestAnimationFrame(() => {
        const items = itemsOf();
        (up ? items[items.length - 1] : items[0])?.focus();
      });
      return;
    }
    const items = itemsOf();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = menuNavIndex(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  }, [open, setOpen, ref]);
}
