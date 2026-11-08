// 输入卡浮层槽（2026-10-28 · 第 752 页）：Composer 的四个浮层族（模型菜单 / 用量环 /
// ＋附件 / 权限菜单）**共用一个开合真相**。
//
// 为什么单独成文件：① `Composer.tsx` 已近 1200 行帽（`renderer-layer-check` 的 I4），
// 浮层槽的逻辑该有自己的家；② 这段逻辑有**自己的**行为契约（互斥、派生旧语义、
// 受控接线），独立成模块才能被纯函数判卷钉住，而不靠"读 Composer 源码有没有这句"。
//
// 缺陷本体（真机复现）：模型菜单此前自己一份 open 态，与 Composer 的 `menu` 槽互不知情
// ⇒ 模型菜单开着时点用量环，两个浮层同屏叠放（几何真的重叠，命中测试落在用量浮层上）。
// 现在开合真相在此一处，模型菜单是受控件。
import { useCallback, useState } from "react";
import { nextOverlay, type OverlayLayer } from "./overlay-mutex";

/** 旧 `menu` 语义的成员（attach/perm/meter）——既有代码读它，不必全改。 */
export type ComposerMenu = "none" | "perm" | "meter" | "attach";

export interface ComposerOverlaySlot {
  /** 当前层（唯一真相）。 */
  layer: OverlayLayer;
  /** 旧语义的派生值：模型菜单在场时为 `none`（旧代码不认识它）。 */
  menu: ComposerMenu;
  /** 旧语义的写入口（既有用法不改）。 */
  setMenu: (next: ComposerMenu) => void;
  /** 模型菜单的受控出口：开 ⇒ 别的层让路；关 ⇒ 只关它自己。 */
  setModelOpen: (next: boolean) => void;
  /** 附件菜单的开合出口。 */
  setAttachOpen: (next: boolean) => void;
  /** 权限菜单的开合出口。 */
  setPermOpen: (next: boolean) => void;
  /** 用量环的开合出口。 */
  setMeterOpen: (next: boolean) => void;
}

/** Composer 的浮层槽：一次只开一个层。 */
export function useComposerOverlaySlot(): ComposerOverlaySlot {
  const [layer, setLayer] = useState<OverlayLayer>("none");
  const menu: ComposerMenu =
    layer === "attach" || layer === "perm" || layer === "meter" ? layer : "none";
  const setMenu = useCallback((next: ComposerMenu): void => {
    setLayer(next === "none" ? "none" : next);
  }, []);
  // 开某层 ⇒ 目标接管（别的层让路）；关某层 ⇒ 只关它自己（不误伤当前层之外的态）。
  const openExclusive = useCallback((target: Exclude<OverlayLayer, "none">, next: boolean): void => {
    setLayer((cur) => {
      if (next) return nextOverlay(cur, target);
      return cur === target ? "none" : cur;
    });
  }, []);
  const setModelOpen = useCallback((next: boolean) => { openExclusive("model", next); }, [openExclusive]);
  const setAttachOpen = useCallback((next: boolean) => { openExclusive("attach", next); }, [openExclusive]);
  const setPermOpen = useCallback((next: boolean) => { openExclusive("perm", next); }, [openExclusive]);
  const setMeterOpen = useCallback((next: boolean) => { openExclusive("meter", next); }, [openExclusive]);
  return { layer, menu, setMenu, setModelOpen, setAttachOpen, setPermOpen, setMeterOpen };
}
