// 首帧底色决策判卷（设计规格 §10 的 v1.1 项）。
//
// 为什么要有这一支：这段决策原先长在 `main/index.ts` 的装配函数里，属于「只在启动那一瞬有用、
// 跑起来就再也测不到」的代码。抽成纯函数之后，三条规则都能在 node 里断言：
//  ① 只有 image 走平均色；video / none 一律主题底色；
//  ② 读不出就回落主题底色（与今天逐字节一致）；
//  ③ 设置在进这条路径前就校验形状：相对路径按「没设壁纸」处理。
import { deflateSync } from "node:zlib";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NO_WALLPAPER,
  bootBackgroundForWallpaper,
  createTintMemo,
  parseBootWallpaper,
} from "../src/main/boot-background";
import type { TintSource } from "../src/main/wallpaper-tint";

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  return out;
}

/** 1×1 实色 PNG（颜色由参数给），与 `wallpaper-tint` 的读法同形。 */
function png(rgb: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = Buffer.concat([Buffer.from([0]), Buffer.from([...rgb])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const loadOf = (map: Record<string, Buffer | null>) => (path: string): TintSource | null => {
  const file = map[path];
  if (file === undefined || file === null) return null;
  return { toPNG: () => file, getSize: () => ({ width: 1, height: 1 }) };
};

describe("首帧底色决策", () => {
  it("设置形状：白名单 + 从属 + 绝对路径", () => {
    expect(parseBootWallpaper(undefined, isAbsolute)).toEqual(NO_WALLPAPER);
    expect(parseBootWallpaper({ kind: "image", path: "/a.png" }, isAbsolute)).toEqual({ kind: "image", path: "/a.png" });
    expect(parseBootWallpaper({ kind: "video", path: "/a.mp4" }, isAbsolute)).toEqual({ kind: "video", path: "/a.mp4" });
    // kind 不对 / 路径相对 / 路径缺失 ⇒ 一律当作没设壁纸
    expect(parseBootWallpaper({ kind: "gif", path: "/a.gif" }, isAbsolute)).toEqual(NO_WALLPAPER);
    expect(parseBootWallpaper({ kind: "image", path: "a.png" }, isAbsolute)).toEqual(NO_WALLPAPER);
    expect(parseBootWallpaper({ kind: "image" }, isAbsolute)).toEqual(NO_WALLPAPER);
    expect(parseBootWallpaper({ kind: "image", path: "" }, isAbsolute)).toEqual(NO_WALLPAPER);
  });

  it("图片壁纸取平均色；视频与读不出的一律主题底色", () => {
    const load = loadOf({ "/wall.png": png([0x10, 0x20, 0x30]) });
    expect(bootBackgroundForWallpaper({
      themeBackground: "#1b1b1b",
      wallpaper: { kind: "image", path: "/wall.png" },
      load,
    })).toBe("#102030");
    expect(bootBackgroundForWallpaper({
      themeBackground: "#1b1b1b",
      wallpaper: { kind: "video", path: "/wall.mp4" },
      load,
    })).toBe("#1b1b1b");
    expect(bootBackgroundForWallpaper({
      themeBackground: "#fcfcfb",
      wallpaper: { kind: "image", path: "/gone.png" },
      load,
    })).toBe("#fcfcfb");
    expect(bootBackgroundForWallpaper({
      themeBackground: "#1b1b1b",
      wallpaper: NO_WALLPAPER,
      load,
    })).toBe("#1b1b1b");
  });

  it("失败也走主题底色（不是抛错、不是白底）", () => {
    const boom = (): TintSource => { throw new Error("decode failed"); };
    expect(bootBackgroundForWallpaper({
      themeBackground: "#1b1b1b",
      wallpaper: { kind: "image", path: "/x.png" },
      load: boom,
    })).toBe("#1b1b1b");
  });

  it("启动期缓存：同一路径只解码一次，换路径重算", () => {
    let calls = 0;
    const memo = createTintMemo();
    const compute = (value: string) => () => { calls += 1; return value; };
    expect(memo("/a.png", compute("#111111"))).toBe("#111111");
    expect(memo("/a.png", compute("#222222"))).toBe("#111111"); // 同键 ⇒ 不重算
    expect(calls).toBe(1);
    expect(memo("/b.png", compute("#333333"))).toBe("#333333"); // 换键 ⇒ 重算
    expect(calls).toBe(2);
  });
});
