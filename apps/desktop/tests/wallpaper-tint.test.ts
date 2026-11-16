// 壁纸首帧底色判卷（设计规格 §10「启动首帧」/§11 表 3 的 v1.1 项）：
// 平均色换算（BGRA → #rrggbb）、透明/损坏位图回落、只对图片生效、主题底色兜底。
//
// 判据要点：**读不出就回落**，不是猜一个颜色；视频不走这条路（规格明写无捷径）。
import { describe, expect, it } from "vitest";
import {
  averageColorHex,
  bootBackgroundWithTint,
  wallpaperTintFor,
  type TintSource,
} from "../src/main/wallpaper-tint";

/** 造一个 BGRA 位图（Chromium 的顺序：B, G, R, A）。 */
function bgra(pixels: readonly [number, number, number, number][]): TintSource {
  const buf = Buffer.alloc(pixels.length * 4);
  pixels.forEach((px, i) => {
    buf[i * 4] = px[0];
    buf[i * 4 + 1] = px[1];
    buf[i * 4 + 2] = px[2];
    buf[i * 4 + 3] = px[3];
  });
  return { getBitmap: () => buf, getSize: () => ({ width: pixels.length, height: 1 }) };
}

describe("壁纸首帧底色", () => {
  it("1×1 平均色：白/黑/主题暗色都按 BGRA 顺序读", () => {
    expect(averageColorHex(bgra([[255, 255, 255, 255]]))).toBe("#ffffff");
    expect(averageColorHex(bgra([[0, 0, 0, 255]]))).toBe("#000000");
    // #1b1b1b 的 BGRA = 27,27,27,255
    expect(averageColorHex(bgra([[0x1b, 0x1b, 0x1b, 255]]))).toBe("#1b1b1b");
  });

  it("多像素取算术平均（含逐通道舍入）", () => {
    // 两像素：B=10/20、G=0/255、R=255/0 ⇒ 平均 B=15(0x0f)、G=127.5→0x80、R=127.5→0x80
    const img = bgra([[10, 0, 255, 255], [20, 255, 0, 255]]);
    expect(averageColorHex(img)).toBe("#80800f");
  });

  it("几乎全透明 ⇒ 不出色（画布本来就会透上来）", () => {
    expect(averageColorHex(bgra([[255, 255, 255, 0]]))).toBeNull();
    expect(averageColorHex(bgra([[255, 255, 255, 8]]))).toBeNull();
  });

  it("位图字节数不够 / 尺寸非法 / 读取抛错 ⇒ null，不猜", () => {
    const short: TintSource = { getBitmap: () => Buffer.alloc(3), getSize: () => ({ width: 1, height: 1 }) };
    expect(averageColorHex(short)).toBeNull();
    const zero: TintSource = { getBitmap: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) };
    expect(averageColorHex(zero)).toBeNull();
    const boom: TintSource = {
      getBitmap: () => { throw new Error("decode failed"); },
      getSize: () => ({ width: 1, height: 1 }),
    };
    expect(averageColorHex(boom)).toBeNull();
  });

  it("只对图片生效：none / video 不加载图片，也不出色", () => {
    let loaded = 0;
    const load = (): TintSource => {
      loaded += 1;
      return bgra([[0, 0, 0, 255]]);
    };
    expect(wallpaperTintFor({ kind: "none", path: "/a.png" }, load)).toBeNull();
    expect(wallpaperTintFor({ kind: "video", path: "/a.mp4" }, load)).toBeNull();
    expect(wallpaperTintFor({ kind: "image", path: null }, load)).toBeNull();
    expect(loaded).toBe(0);
  });

  it("图片路径给得出颜色；文件不在（loader 返 null）或 loader 抛错 ⇒ null", () => {
    const ok = wallpaperTintFor({ kind: "image", path: "/a.png" }, () => bgra([[9, 9, 9, 255]]));
    expect(ok).toBe("#090909");
    expect(wallpaperTintFor({ kind: "image", path: "/gone.png" }, () => null)).toBeNull();
    expect(wallpaperTintFor({ kind: "image", path: "/bad.png" }, () => { throw new Error("ENOENT"); })).toBeNull();
  });

  it("兜底：没有平均色就仍是主题底色（与今天逐字节一致）", () => {
    expect(bootBackgroundWithTint("#1b1b1b", null)).toBe("#1b1b1b");
    expect(bootBackgroundWithTint("#fcfcfb", null)).toBe("#fcfcfb");
    expect(bootBackgroundWithTint("#1b1b1b", "#336699")).toBe("#336699");
  });
});
