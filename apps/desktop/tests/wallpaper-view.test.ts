// 壁纸视图投影判卷（2026-11-14 · 设计规格 §3.5）：
// 设置 → 视图是纯函数；kind=none ⇒ 无 URL；revision 进 URL 破缓存。
import { describe, expect, it } from "vitest";
import { shouldPauseMedia, wallpaperUrl, wallpaperViewOf } from "../src/renderer/state/wallpaper";
import { DEFAULT_SETTINGS, type AppSettings } from "../../../src/main/settings";

function settingsWith(wallpaper: Partial<AppSettings["wallpaper"]>): AppSettings {
  return { ...DEFAULT_SETTINGS, wallpaper: { ...DEFAULT_SETTINGS.wallpaper, ...wallpaper } };
}

describe("壁纸视图投影", () => {
  it("无壁纸 ⇒ kind=none、无 URL", () => {
    const v = wallpaperViewOf(settingsWith({ kind: "none" }));
    expect(v.kind).toBe("none");
    expect(v.url).toBeNull();
  });

  it("图/视频 ⇒ URL 带 revision", () => {
    const v = wallpaperViewOf(settingsWith({ kind: "image", path: "/tmp/a.png", revision: 4 }));
    expect(v.kind).toBe("image");
    expect(v.url).toBe("cairn-wallpaper://media/current?v=4");
    expect(wallpaperUrl(0)).toBe("cairn-wallpaper://media/current?v=0");
  });

  it("kind 非 none 但没有 path ⇒ 视作无壁纸", () => {
    const v = wallpaperViewOf(settingsWith({ kind: "video", path: null }));
    expect(v.kind).toBe("none");
    expect(v.url).toBeNull();
  });

  it("暂停判据：失焦或不可见即停", () => {
    expect(shouldPauseMedia(true, true)).toBe(false);
    expect(shouldPauseMedia(false, true)).toBe(true);
    expect(shouldPauseMedia(true, false)).toBe(true);
    expect(shouldPauseMedia(false, false)).toBe(true);
  });
});
