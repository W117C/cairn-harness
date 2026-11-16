// 壁纸设置字段判卷（2026-11-14 · 设计规格 §3.4）：
// kind 白名单、path 与 kind 的从属、三个 0..1 滑杆、revision 单调整数。
// 坏值一律回默认、不落库——与既有偏好校验同形。
import { describe, expect, it } from "vitest";
import { PREFERENCE_KEYS, pickPreferences } from "../src/main/preferences";
import { DEFAULT_SETTINGS, validateSettings } from "../src/main/settings";

describe("壁纸设置", () => {
  it("缺省是关的：kind=none、path=null", () => {
    expect(DEFAULT_SETTINGS.wallpaper.kind).toBe("none");
    expect(DEFAULT_SETTINGS.wallpaper.path).toBeNull();
    expect(validateSettings({}).wallpaper.kind).toBe("none");
    expect(validateSettings({}).wallpaper.path).toBeNull();
  });

  it("kind 白名单外回 none", () => {
    expect(validateSettings({ wallpaper: { kind: "scene" } }).wallpaper.kind).toBe("none");
    expect(validateSettings({ wallpaper: { kind: 7 } }).wallpaper.kind).toBe("none");
  });

  it("opacity / scrim 越界或非数回默认", () => {
    const bad = validateSettings({ wallpaper: { opacity: 1.5, scrim: -1 } }).wallpaper;
    expect(bad.opacity).toBe(DEFAULT_SETTINGS.wallpaper.opacity);
    expect(bad.scrim).toBe(DEFAULT_SETTINGS.wallpaper.scrim);
    const nan = validateSettings({ wallpaper: { opacity: Number.NaN } }).wallpaper;
    expect(nan.opacity).toBe(DEFAULT_SETTINGS.wallpaper.opacity);
  });

  it("kind=none 时路径归零（单一事实：有路径才有壁纸）", () => {
    expect(validateSettings({ wallpaper: { kind: "none", path: "/tmp/x.png" } }).wallpaper.path).toBeNull();
  });

  it("合法的图/视频原样保留", () => {
    const v = validateSettings({
      wallpaper: { kind: "video", path: "/tmp/a.mp4", opacity: 0.5, scrim: 0.2, glassAlpha: 0.3, revision: 3 },
    }).wallpaper;
    expect(v).toEqual({
      kind: "video",
      path: "/tmp/a.mp4",
      opacity: 0.5,
      scrim: 0.2,
      glassAlpha: 0.3,
      revision: 3,
      // 2026-11-16：定时轮换随壁纸设置一起校验（缺省 = 关 / 60 分钟 / 空候选）
      rotation: {
        enabled: false, mode: "interval", weather: { kind: "clear", paths: {} },
        latitude: 39.9042, longitude: 116.4074,
        dayPath: null, nightPath: null, everyMinutes: 60, paths: [], lastAt: 0,
      },
      perDisplay: {},
    });
  });

  it("revision 只认非负整数", () => {
    expect(validateSettings({ wallpaper: { revision: 1.5 } }).wallpaper.revision).toBe(0);
    expect(validateSettings({ wallpaper: { revision: -1 } }).wallpaper.revision).toBe(0);
    expect(validateSettings({ wallpaper: { revision: 7 } }).wallpaper.revision).toBe(7);
  });

  it("glassAlpha 上限 0.6（玻璃透明度不许超过这个档）", () => {
    expect(validateSettings({ wallpaper: { glassAlpha: 0.9 } }).wallpaper.glassAlpha).toBe(0.6);
    expect(validateSettings({ wallpaper: { glassAlpha: 0.3 } }).wallpaper.glassAlpha).toBe(0.3);
    expect(validateSettings({ wallpaper: { glassAlpha: -1 } }).wallpaper.glassAlpha).toBe(
      DEFAULT_SETTINGS.wallpaper.glassAlpha,
    );
  });

  it("不进偏好导出：路径是机器本地的，跨机搬运只会指向不存在的文件", () => {
    expect((PREFERENCE_KEYS as readonly string[]).includes("wallpaper")).toBe(false);
    expect(Object.keys(pickPreferences(DEFAULT_SETTINGS))).not.toContain("wallpaper");
  });
});
