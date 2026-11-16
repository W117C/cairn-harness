// 壁纸首帧底色（设计规格 §10「启动首帧」的 v1.1 项，规格 §11 表 3 的默认裁决）。
//
// 问题：图片壁纸开着重启时，窗口先铺一块主题画布色（`bootBackgroundFor`），壁纸层要等
// renderer 挂载才画出来 ⇒ 中间那几帧是「画布色闪一下」。
//
// 修法（规格写的）：图片壁纸时主进程用 `nativeImage` 取 1×1 平均色（`resize({width:1,height:1})`
// 的首像素即平均色）当 `BrowserWindow.backgroundColor`。视频壁纸没有这条捷径（首帧像素要解码
// 才能拿到，代价大于收益）⇒ 维持画布色。
//
// 本模块**不 import electron**：`nativeImage` 由调用方注入（`main/index.ts` 的 `nativeImageOf`），
// 所以判卷能在纯 node 里跑，不把 Electron 单例带进测试（与 `boot-theme.ts` 同一条纪律）。
//
// 边界（如实写）：平均色只是把「闪画布色」降级成「闪壁纸的平均色调」，不是逐像素还原；
// 平均色读不出（文件没了 / 解码失败 / 几乎全透明）⇒ 回落主题底色，与今天行为一致。

/** `nativeImage` 里本模块用到的两个方法（注入面，测试给假的）。 */
export interface TintSource {
  /** BGRA 顺序、每像素 4 字节。Chromium 的 `NativeImage.getBitmap()` 就是这个顺序。 */
  getBitmap(): Buffer;
  getSize(): { width: number; height: number };
}

/** BGRA 位图 → 平均色 `#rrggbb`；空位图或尺寸对不上 ⇒ null（调用方回落主题底色）。 */
export function averageColorHex(image: TintSource): string | null {
  let size: { width: number; height: number };
  let bitmap: Buffer;
  try {
    size = image.getSize();
    bitmap = image.getBitmap();
  } catch {
    return null;
  }
  const pixels = size.width * size.height;
  // 1×1 传进来也对（resize 失败时的退化形态）；尺寸非法或字节数不够 ⇒ 读不出。
  if (!Number.isInteger(pixels) || pixels <= 0) return null;
  if (bitmap.length < pixels * 4) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < pixels; i++) {
    const at = i * 4;
    b += bitmap[at] ?? 0;
    g += bitmap[at + 1] ?? 0;
    r += bitmap[at + 2] ?? 0;
    a += bitmap[at + 3] ?? 0;
  }
  // 平均 alpha 很低 ⇒ 画面本来就让画布色透上来，取这张图的颜色只会比主题底色更不像。
  if (a / pixels < 16) return null;
  const hex = (n: number): string => {
    const v = Math.max(0, Math.min(255, Math.round(n / pixels)));
    return v.toString(16).padStart(2, "0");
  };
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * 图片壁纸的首帧底色。`load` 返回 null（文件不在 / 不是图片 / 解码失败）⇒ null，
 * 调用方按主题底色处理。**只对 image 生效**——视频按规格维持画布色。
 */
export function wallpaperTintFor(
  wallpaper: { kind: "none" | "image" | "video"; path: string | null },
  load: (path: string) => TintSource | null,
): string | null {
  if (wallpaper.kind !== "image" || wallpaper.path === null) return null;
  let image: TintSource | null;
  try {
    image = load(wallpaper.path);
  } catch {
    return null;
  }
  if (image === null) return null;
  return averageColorHex(image);
}

/** 首帧底色：有壁纸平均色就用它，否则主题底色。 */
export function bootBackgroundWithTint(themeBackground: string, tint: string | null): string {
  return tint ?? themeBackground;
}
