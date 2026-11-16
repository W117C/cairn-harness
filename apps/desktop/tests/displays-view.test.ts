// 多显示器视图：**两块屏**的输入也要判（真机只有一块屏，逻辑不能只有单屏证据）。
import { describe, expect, it } from "vitest";
import { resolveDisplays } from "../src/main/displays-view";
import type { WallpaperSettings } from "../../../src/main/settings";

const base = (patch: Partial<WallpaperSettings> = {}): WallpaperSettings => ({
  kind: "image", path: "/global.png", url: null, opacity: 1, scrim: 0.35, glassAlpha: 0.25, revision: 1,
  perDisplay: {}, rotation: { enabled: false, mode: "interval", weather: { kind: "clear", paths: {}, source: "manual", filePath: null, httpUrl: null }, latitude: 0, longitude: 0, dayPath: null, nightPath: null, everyMinutes: 60, paths: [], lastAt: 0 },
  ...patch,
});

const two = [
  { id: "1", width: 1920, height: 1080, scaleFactor: 1 },
  { id: "2", width: 2560, height: 1440, scaleFactor: 2 },
];

describe("多显示器视图（两块屏）", () => {
  it("1 号有专属、2 号回落全局；页面拿到的 path 各是各的", () => {
    const out = resolveDisplays(base({ perDisplay: { "1": { kind: "video", path: "/only-1.mp4" } } }), two);
    expect(out.displays.map((d) => [d.id, d.source, d.path])).toEqual([
      ["1", "display", "/only-1.mp4"],
      ["2", "fallback", "/global.png"],
    ]);
    expect(out.orphans).toEqual([]);
  });

  it("没设全局也没专属 ⇒ 两块屏都 none；拔掉的 9 号进 orphans（只报告）", () => {
    const out = resolveDisplays(base({ kind: "none", path: null, perDisplay: { "9": { kind: "image", path: "/gone.png" } } }), two);
    expect(out.displays.map((d) => d.source)).toEqual(["none", "none"]);
    expect(out.displays[0]!.path).toBeUndefined();
    expect(out.orphans).toEqual(["9"]);
  });
});
