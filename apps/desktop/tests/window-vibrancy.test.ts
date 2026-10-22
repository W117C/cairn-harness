// 窗口材质实验开关（2026-10-21）：只在 macOS + 显式环境变量下返回选项；
// 默认路径不得改变，原型不能当 Claude 对齐证据。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { windowVibrancyOptions } from "../src/main/window-vibrancy";

const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");
const main = readFileSync(join(__dirname, "..", "src", "main", "index.ts"), "utf8");
const preload = readFileSync(join(__dirname, "..", "src", "preload", "index.ts"), "utf8");

describe("WindowVibrancy 实验开关", () => {
  it("非 macOS 或未显式开启时返回 null", () => {
    expect(windowVibrancyOptions("linux", { CAIRN_WINDOW_VIBRANCY: "sidebar" })).toBeNull();
    expect(windowVibrancyOptions("darwin", {})).toBeNull();
    expect(windowVibrancyOptions("darwin", { CAIRN_WINDOW_VIBRANCY: "0" })).toBeNull();
  });

  it("macOS + sidebar/1 返回透明材质参数", () => {
    for (const value of ["sidebar", "1"]) {
      expect(windowVibrancyOptions("darwin", { CAIRN_WINDOW_VIBRANCY: value })).toEqual({
        vibrancy: "sidebar",
        visualEffectState: "active",
        backgroundColor: "#00000000",
        transparent: true,
      });
    }
    expect(windowVibrancyOptions("darwin", {}, true)).toEqual({
      vibrancy: "sidebar",
      visualEffectState: "active",
      backgroundColor: "#00000000",
      transparent: true,
    });
  });

  it("主进程/预加载/CSS 都只在开关开启时走材质路径", () => {
    expect(main).toContain("windowVibrancyOptions(process.platform, process.env, readWindowVibrancyPreference())");
    expect(main).toContain('raw.windowVibrancy === true');
    expect(main).toContain('mainWindow.setVibrancy(vibrancy ? "sidebar" : null)');
    expect(main).toContain('mainWindow.setBackgroundColor(vibrancy ? "#00000000" : bootBackground())');
    expect(main).toContain("vibrancy === null ? { backgroundColor: bootBackground() } : vibrancy");
    expect(preload).toContain('process.argv.includes("--cairn-vibrancy")');
    expect(css).toContain('html[data-vibrancy="sidebar"] .side-wrap');
    expect(css).toContain('hsl(var(--bg-000) / .75)');
    expect(css).toContain('html[data-vibrancy="sidebar"] .main');
  });
});
