// 轮换字段的校验：间隔夹在 1..1440、候选上限 32、时间戳非负、缺省不崩。
import { describe, expect, it } from "vitest";
import { ROTATION_MAX_MINUTES, ROTATION_MAX_PATHS, validateSettings } from "../src/main/settings";

const withWallpaper = (rotation: unknown) => validateSettings({ wallpaper: { kind: "image", path: "/a.png", rotation } });

describe("轮换字段校验", () => {
  it("缺省 ⇒ 关、60 分钟、空候选", () => {
    const r = withWallpaper(undefined).wallpaper.rotation;
    expect(r).toEqual({ enabled: false, everyMinutes: 60, paths: [], lastAt: 0 });
  });

  it("间隔夹到 1..1440；时间戳非负", () => {
    expect(withWallpaper({ everyMinutes: 0 }).wallpaper.rotation.everyMinutes).toBe(1);
    expect(withWallpaper({ everyMinutes: 99999 }).wallpaper.rotation.everyMinutes).toBe(ROTATION_MAX_MINUTES);
    expect(withWallpaper({ everyMinutes: 90 }).wallpaper.rotation.everyMinutes).toBe(90);
    expect(withWallpaper({ lastAt: -5 }).wallpaper.rotation.lastAt).toBe(0);
    expect(withWallpaper({ lastAt: 1234 }).wallpaper.rotation.lastAt).toBe(1234);
  });

  it("候选：去空、上限 32、非字符串丢掉", () => {
    const many = Array.from({ length: 40 }, (_, i) => `/p${i}.png`);
    const r = withWallpaper({ paths: [...many, "", 123] }).wallpaper.rotation.paths;
    expect(r).toHaveLength(ROTATION_MAX_PATHS);
    expect(r[0]).toBe("/p0.png");
  });

  it("enabled 只认 true", () => {
    expect(withWallpaper({ enabled: "yes" }).wallpaper.rotation.enabled).toBe(false);
    expect(withWallpaper({ enabled: true }).wallpaper.rotation.enabled).toBe(true);
  });
});
