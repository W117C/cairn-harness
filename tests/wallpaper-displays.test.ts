// 多显示器判卷：专属优先/回落全局/非法键丢弃/孤儿只报告不删。
import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_OVERRIDES, pruneDisplays, sanitizeDisplayMap, wallpaperForDisplay } from "../src/wallpaper/displays";

const a = { kind: "image" as const, path: "/a.png" };

describe("多显示器壁纸", () => {
  it("专属优先；没有则回落全局；都没有 ⇒ none", () => {
    const map = { "1": a };
    expect(wallpaperForDisplay(1, map, { kind: "video", path: "/v.mp4" })).toEqual({ source: "display", wallpaper: a });
    expect(wallpaperForDisplay(2, map, a)).toEqual({ source: "fallback", wallpaper: a });
    expect(wallpaperForDisplay(2, map, null)).toEqual({ source: "none", wallpaper: null });
  });

  it("非法键 / 非法值 / 超上限 ⇒ 丢弃并点名", () => {
    const { kept, dropped } = sanitizeDisplayMap({
      "1": a, abc: a, "2": { kind: "image", path: "" }, "3": { kind: "gif", path: "/x.gif" },
    });
    expect(Object.keys(kept)).toEqual(["1"]);
    expect(dropped.sort()).toEqual(["2", "3", "abc"]);

    const many = Object.fromEntries(Array.from({ length: MAX_DISPLAY_OVERRIDES + 3 }, (_, i) => [String(i), a]));
    expect(Object.keys(sanitizeDisplayMap(many).kept)).toHaveLength(MAX_DISPLAY_OVERRIDES);
  });

  it("孤儿只报告、不删", () => {
    const map = { "1": a, "9": a };
    expect(pruneDisplays(map, [1])).toEqual({ live: ["1"], orphans: ["9"] });
    expect(Object.keys(map)).toHaveLength(2); // 原对象没被改
  });
});
