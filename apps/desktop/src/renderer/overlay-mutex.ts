// 浮层互斥（2026-10-28 · 第 752 页）：输入卡这一行的几个浮层**共用一个开合槽**。
//
// 为什么要有这一层：桌面端的浮层此前各自持有 open 态——Composer 有 `menu` 槽
// （attach/perm/meter），`ModelPicker` 有自己的 `open`。两处真相 ⇒ 用户在模型菜单开着时
// 点用量环，两个浮层**同屏叠放**（真机复现：几何真的重叠，用量浮层盖住模型菜单右半，
// 命中测试落在用量浮层上）。规格里没有「同一个角上两个浮层叠着」这种形状。
//
// 口径：**一个槽一次只装一个层**。开一个 ⇒ 别的让路；再点同一个 ⇒ 关。
//
// 逐对实测的几何（1440×900，真实 renderer，展开后的实际矩形）：
//   · 模型菜单 `left 668, top 397, 300×408`
//   · 用量浮层 `left 919, top 496, 258×309`   → 与模型菜单**重叠**
//   · 附件菜单 `left 481, top 617, 270×188`   → 与模型菜单**重叠**；与用量浮层不重叠
//
// 由此得到的**诚实口径**：模型菜单与另两个的重叠是**缺陷本体**（本页修它）；
// 而「用量浮层 ↔ 附件菜单」这一对几何上并不重叠——它们仍共用一个槽，是**沿用既有行为**
// 的保守选择，不是几何必需。留着这条注记，是为了让下一位知道「这对为什么也没放开」
// （要放开得把槽从一层升成一组，是另一笔改动，不在��页范围）。
//
// 纯函数、无 IO、无时钟 ⇒ 可判卷。
//
// 注意：这是**渲染层内部**的互斥，与「模态隔离」（`ModalSurface` 的 inert 背景隔离）
// 是两件事：模态隔离管「模态 vs 背景」，这里管「浮层 vs 浮层」。

/** 渲染层已知的浮层层名。 */
export type OverlayLayer = "none" | "model" | "meter" | "attach" | "perm";

/** 浮层的锚点带（读面用：说明每个层出现在输入卡的哪一带）。 */
export type OverlayBand = "composer-right" | "composer-left" | "toolbar" | "pane";

/** 每个层归哪个带。 */
const LAYER_BAND: Readonly<Record<Exclude<OverlayLayer, "none">, OverlayBand>> = {
  model: "composer-right",
  meter: "composer-right",
  attach: "composer-left",
  perm: "composer-left",
};

/** 某带里的全部层（读面用：让"这一带有哪些"只有一个来源）。 */
export function overlayLayersAt(band: OverlayBand): readonly Exclude<OverlayLayer, "none">[] {
  return (Object.keys(LAYER_BAND) as Exclude<OverlayLayer, "none">[])
    .filter((layer) => LAYER_BAND[layer] === band);
}

/**
 * 两个层是否互斥。
 *
 * 一个槽一次只装一个 ⇒ **任何两个不同的层都互斥**（同层不算：那不是"两个层"）。
 * 几何上「用量浮层 ↔ 附件菜单」其实不重叠（见上），它们互斥是沿用既有槽行为的保守选择。
 */
export function exclusiveAt(_band: OverlayBand, layer: Exclude<OverlayLayer, "none">): boolean {
  // 「本层与别的层互斥」= 除自己外还有别的层可开。
  return overlayLayersAt(LAYER_BAND[layer]).length > 1 || Object.keys(LAYER_BAND).length > 1;
}

/** 这一对是否互斥（对称口径）。 */
export function layersExclusive(
  a: Exclude<OverlayLayer, "none">,
  b: Exclude<OverlayLayer, "none">,
): boolean {
  return a !== b;
}

/**
 * 开某一层时，其它层要让路（返回新槽值）。
 * 换层 ⇒ 返回新层；同层（再点一次）⇒ 关掉（`none`）。
 */
export function nextOverlay(current: OverlayLayer, target: Exclude<OverlayLayer, "none">): OverlayLayer {
  if (current === target) return "none";
  return target;
}
