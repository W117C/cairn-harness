import { describe, expect, it } from "vitest";
import { WALLPAPER_MEDIA_URL, WALLPAPER_SCHEME } from "../src/main/wallpaper-protocol";

// 壁纸协议常量（2026-11-14 壁纸批）：主进程注册 scheme、渲染层拼 URL，两处必须同一份真值。
describe("壁纸协议常量", () => {
  it("媒体前缀就是 scheme://media/current（改一处不会让另一处漂）", () => {
    expect(WALLPAPER_SCHEME).toBe("cairn-wallpaper");
    expect(WALLPAPER_MEDIA_URL).toBe(WALLPAPER_SCHEME + "://media/current");
    expect(WALLPAPER_MEDIA_URL.startsWith(WALLPAPER_SCHEME + "://")).toBe(true);
  });
});
