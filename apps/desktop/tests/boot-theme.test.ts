// 首帧主题纯函数判卷（2026-10-21）：
// settings.json 的 theme 优先于系统深浅；非法值回 system；背景色只有 v3 surface-1 两档。
import { describe, expect, it } from "vitest";
import { bootBackgroundFor, normalizeThemePreference, resolveBootTheme } from "../src/main/boot-theme";

describe("首帧主题", () => {
  it("显式 light / dark 压过系统", () => {
    expect(resolveBootTheme("light", true)).toBe("light");
    expect(resolveBootTheme("dark", false)).toBe("dark");
  });

  it("system 才跟随系统", () => {
    expect(resolveBootTheme("system", true)).toBe("dark");
    expect(resolveBootTheme("system", false)).toBe("light");
  });

  it("非法/缺失的持久化值回 system", () => {
    expect(normalizeThemePreference("auto")).toBe("system");
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference(null)).toBe("system");
    expect(normalizeThemePreference("dark")).toBe("dark");
  });

  it("背景色取 v3 surface-1：亮 #fcfcfb / 暗 #151515", () => {
    expect(bootBackgroundFor("light")).toBe("#fcfcfb");
    expect(bootBackgroundFor("dark")).toBe("#151515");
  });
});
