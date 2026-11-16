// 壁纸首帧底色（设计规格 §10「启动首帧」的 v1.1 项，规格 §11 表 3 的默认裁决）。
//
// 问题：图片壁纸开着重启时，窗口先铺一块主题画布色（`bootBackgroundFor`），壁纸层要等
// renderer 挂载才画出来 ⇒ 中间那几帧是「画布色闪一下」。
//
// 修法（规格写的）：图片壁纸时主进程用 `nativeImage` 取 1×1 平均色当
// `BrowserWindow.backgroundColor`。视频壁纸没有这条捷径（首帧像素要解码才能拿到，
// 代价大于收益）⇒ 维持画布色。
//
// **取色走 PNG，不走裸位图**。理由是一条真机事实：这个 Electron 的 `getBitmap()` 在
// `electron.d.ts` 里是 `void`（旧别名），而 `toBitmap()` 的注释明写「像素格式随平台而定」——
// macOS 上是 BGRA、Linux 上是 RGBA。按某一个平台写死通道顺序，另一平台的红蓝会互换。
// 所以这里把 1×1 图编码成 PNG（格式由 PNG 规范钉死：8bit RGB/RGBA 不带通道歧义），
// 再用 `node:zlib` 解一条扫描线。代价是几十字节的 inflate，换来的是零平台假设。
//
// 本模块**不 import electron**：`nativeImage` 由调用方注入（`main/index.ts` 的 `nativeImageOf`），
// 判卷能在纯 node 里跑，不把 Electron 单例带进测试（与 `boot-theme.ts` 同一条纪律）。
//
// 边界（如实写）：平均色只是把「闪画布色」降级成「闪壁纸的平均色调」，不是逐像素还原；
// 平均色读不出（文件没了 / 解码失败 / 几乎全透明 / PNG 形状不认识）⇒ 回落主题底色，与今天一致。

import { inflateSync } from "node:zlib";

/** `nativeImage` 里本模块用到的两个方法（注入面，测试给假的）。 */
export interface TintSource {
  /** PNG 编码后的字节；1×1 时就是一个像素。 */
  toPNG(): Buffer;
  getSize(): { width: number; height: number };
}

type PngPixel = { r: number; g: number; b: number; a: number };

/**
 * 解一张 8bit 真彩色 PNG 的平均色（只支持本模块自己会喂进来的形状：
 * 非隔行、bit depth 8、color type 2(RGB)/6(RGBA)）。认出别的形状 ⇒ null，不猜。
 */
export function averageColorHexOfPng(png: Buffer): string | null {
  const pixel = readOnlyPixel(png);
  if (pixel === null) return null;
  // 1×1 的图只有一个像素；α 太低说明画面本来就让画布色透上来，取它只会更像错。
  if (pixel.a < 16) return null;
  const h = (v: number): string => v.toString(16).padStart(2, "0");
  return `#${h(pixel.r)}${h(pixel.g)}${h(pixel.b)}`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readOnlyPixel(png: Buffer): PngPixel | null {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlaced = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) return null;
    if (type === "IHDR") {
      if (length < 13) return null;
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? -1;
      interlaced = body[12] ?? 1;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length; // 长度(4) + 类型(4) + 数据 + CRC(4)
  }
  // 只认「单像素」：多于一个像素时这条路径没有意义（我们喂的就是 1×1）。
  if (width !== 1 || height !== 1) return null;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlaced !== 0) return null;
  if (idat.length === 0) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const channels = colorType === 6 ? 4 : 3;
  // 扫描线 = 1 字节过滤器 + 通道字节。首像素上除 filter 0 外其余过滤器都退化成原值
  // （左边/上边/左上都是 0），所以这里只要把过滤字节读掉。
  const filter = raw[0];
  if (filter === undefined || filter > 4) return null;
  if (raw.length < 1 + channels) return null;
  const r = raw[1] ?? 0;
  const g = raw[2] ?? 0;
  const b = raw[3] ?? 0;
  const a = channels === 4 ? (raw[4] ?? 0) : 255;
  return { r, g, b, a };
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
  try {
    return averageColorHexOfPng(image.toPNG());
  } catch {
    return null;
  }
}

/** 首帧底色：有壁纸平均色就用它，否则主题底色。 */
export function bootBackgroundWithTint(themeBackground: string, tint: string | null): string {
  return tint ?? themeBackground;
}
