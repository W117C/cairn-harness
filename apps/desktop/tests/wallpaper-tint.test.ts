// 壁纸首帧底色判卷（设计规格 §10「启动首帧」/§11 表 3 的 v1.1 项）：
// 1×1 PNG 解色（RGB / RGBA 两种 color type）、形状不认识即回落、
// 只对图片生效、主题底色兜底。
//
// 判据要点：**读不出就回落**，不猜一个颜色；也**不按平台假设通道顺序**——
// 所以判卷从 PNG 走，而不是从裸位图走（裸位图在 macOS 是 BGRA、Linux 是 RGBA）。
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  averageColorHexOfPng,
  bootBackgroundWithTint,
  wallpaperTintFor,
  type TintSource,
} from "../src/main/wallpaper-tint";

/** 造 PNG 块：长度 + 类型 + 数据 + CRC。解析侧不校验 CRC（这里只喂解析，不喂解码器）。 */
function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  return out;
}

/** 造一张 1×1 PNG。`colorType` 6 = RGBA、2 = RGB（与真编码器同形状）。 */
function pngOf(
  pixel: readonly number[],
  over: { width?: number; height?: number; bitDepth?: number; colorType?: 2 | 6; interlaced?: number; filter?: number } = {},
): Buffer {
  const width = over.width ?? 1;
  const height = over.height ?? 1;
  const bitDepth = over.bitDepth ?? 8;
  const colorType = over.colorType ?? 6;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = over.interlaced ?? 0;
  const filter = Buffer.from([over.filter ?? 0]);
  const scanline = Buffer.concat([filter, Buffer.from(pixel)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanline)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 把 PNG 包成注入面（`toPNG` + `getSize`，与 NativeImage 的两个方法同形）。 */
function source(png: Buffer, size = { width: 1, height: 1 }): TintSource {
  return { toPNG: () => png, getSize: () => size };
}

describe("壁纸首帧底色", () => {
  it("1×1 解色：RGBA 与 RGB 两种 color type 都按真彩读，不假设通道顺序", () => {
    expect(averageColorHexOfPng(pngOf([255, 0, 0, 255]))).toBe("#ff0000");
    expect(averageColorHexOfPng(pngOf([0, 255, 0, 255]))).toBe("#00ff00");
    expect(averageColorHexOfPng(pngOf([0, 0, 255, 255]))).toBe("#0000ff");
    // 主题暗色 #1b1b1b 也要原样还原（这条防的是「颜色被通道互换算成 #1b1b1b 之外的怪值」）
    expect(averageColorHexOfPng(pngOf([0x1b, 0x1b, 0x1b, 255]))).toBe("#1b1b1b");
    expect(averageColorHexOfPng(pngOf([0xff, 0xff, 0xff], { colorType: 2 }))).toBe("#ffffff");
  });

  it("首像素上任何过滤器都退化成原值（0–4 全收）", () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      expect(averageColorHexOfPng(pngOf([9, 8, 7, 255], { filter }))).toBe("#090807");
    }
  });

  it("几乎全透明 ⇒ 不出色（画布本来就会透上来）", () => {
    expect(averageColorHexOfPng(pngOf([255, 255, 255, 0]))).toBeNull();
    expect(averageColorHexOfPng(pngOf([255, 255, 255, 8]))).toBeNull();
  });

  it("形状不认识或数据坏了 ⇒ null，不猜", () => {
    // 签名不对
    expect(averageColorHexOfPng(Buffer.from("not a png at all"))).toBeNull();
    // 多于一个像素（我们只喂 1×1；更大的图不该走这条路径）
    expect(averageColorHexOfPng(pngOf([1, 2, 3, 255], { width: 2 }))).toBeNull();
    // 位深 / 隔行 / 未知 color type
    expect(averageColorHexOfPng(pngOf([1, 2, 3, 255], { bitDepth: 16 }))).toBeNull();
    expect(averageColorHexOfPng(pngOf([1, 2, 3, 255], { interlaced: 1 }))).toBeNull();
    // 截断的 IDAT（inflate 会抛）
    const full = pngOf([1, 2, 3, 255]);
    expect(averageColorHexOfPng(full.subarray(0, full.length - 20))).toBeNull();
    // 没有 IDAT
    const noIdat = Buffer.concat([full.subarray(0, 33), chunk("IEND", Buffer.alloc(0))]);
    expect(averageColorHexOfPng(noIdat)).toBeNull();
  });

  it("只对图片生效：none / video 不加载图片，也不出色", () => {
    let loaded = 0;
    const load = (): TintSource => {
      loaded += 1;
      return source(pngOf([0, 0, 0, 255]));
    };
    expect(wallpaperTintFor({ kind: "none", path: "/a.png" }, load)).toBeNull();
    expect(wallpaperTintFor({ kind: "video", path: "/a.mp4" }, load)).toBeNull();
    expect(wallpaperTintFor({ kind: "image", path: null }, load)).toBeNull();
    expect(loaded).toBe(0);
  });

  it("图片路径给得出颜色；文件不在 / 编码抛错 ⇒ null", () => {
    const ok = wallpaperTintFor({ kind: "image", path: "/a.png" }, () => source(pngOf([9, 9, 9, 255])));
    expect(ok).toBe("#090909");
    expect(wallpaperTintFor({ kind: "image", path: "/gone.png" }, () => null)).toBeNull();
    expect(wallpaperTintFor({ kind: "image", path: "/bad.png" }, () => { throw new Error("ENOENT"); })).toBeNull();
    const broken: TintSource = { toPNG: () => { throw new Error("encode failed"); }, getSize: () => ({ width: 1, height: 1 }) };
    expect(wallpaperTintFor({ kind: "image", path: "/x.png" }, () => broken)).toBeNull();
  });

  it("兜底：没有平均色就仍是主题底色（与今天逐字节一致）", () => {
    expect(bootBackgroundWithTint("#1b1b1b", null)).toBe("#1b1b1b");
    expect(bootBackgroundWithTint("#fcfcfb", null)).toBe("#fcfcfb");
    expect(bootBackgroundWithTint("#1b1b1b", "#336699")).toBe("#336699");
  });
});
