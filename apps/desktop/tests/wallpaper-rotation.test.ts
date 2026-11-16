// 定时轮换执行层判卷：到点才写、跳过读不到的、出错不静默、不重入。
import { describe, expect, it, vi } from "vitest";
import { installWallpaperRotation } from "../src/main/wallpaper-rotation";
import type { WallpaperSettings } from "../../../src/main/settings";

const wp = (patch: Partial<WallpaperSettings["rotation"]> & { path?: string | null } = {}): WallpaperSettings => ({
  kind: "image", path: patch.path === undefined ? "/a.png" : patch.path,
  opacity: 1, scrim: 0.35, glassAlpha: 0.25, revision: 1,
  rotation: {
    enabled: true, mode: "interval", latitude: 39.9042, longitude: 116.4074, dayPath: null, nightPath: null,
    everyMinutes: 60, paths: ["/a.png", "/b.png"], lastAt: 0, ...patch,
  },
});

describe("定时轮换（执行层）", () => {
  it("到点 ⇒ 写设置并报 applied；没开 ⇒ 不写", async () => {
    const apply = vi.fn(async () => {});
    const handle = installWallpaperRotation({
      intervalMs: 1_000_000, now: () => 10_000_000,
      read: async () => wp(), apply, exists: () => true,
    });
    const out = await handle.tick();
    handle.stop();
    expect(out).toMatchObject({ rotate: true, path: "/b.png", applied: true });
    expect(apply).toHaveBeenCalledWith({ kind: "image", path: "/b.png" });

    const apply2 = vi.fn(async () => {});
    const off = installWallpaperRotation({
      intervalMs: 1_000_000, now: () => 10_000_000,
      read: async () => wp({ enabled: false }), apply: apply2, exists: () => true,
    });
    expect((await off.tick()).applied).toBe(false);
    off.stop();
    expect(apply2).not.toHaveBeenCalled();
  });

  it("读不到候选 ⇒ 跳过并点名（不静默）", async () => {
    const apply = vi.fn(async () => {});
    const handle = installWallpaperRotation({
      intervalMs: 1_000_000, now: () => 10_000_000,
      read: async () => wp({ paths: ["/a.png", "/b.png", "/c.png"] }),
      apply, exists: (p) => p !== "/b.png",
    });
    const out = await handle.tick();
    handle.stop();
    expect(out).toMatchObject({ rotate: true, path: "/c.png", missing: ["/b.png"] });
  });

  it("写设置抛错 ⇒ 走 onError，返回不假装成功", async () => {
    const onError = vi.fn();
    const handle = installWallpaperRotation({
      intervalMs: 1_000_000, now: () => 10_000_000,
      read: async () => wp(), apply: async () => { throw new Error("写盘失败"); }, exists: () => true, onError,
    });
    const out = await handle.tick();
    handle.stop();
    expect(onError).toHaveBeenCalled();
    expect(out.applied).toBe(false);
  });

  it("候选不是图片/视频 ⇒ 不写，理由能读", async () => {
    const apply = vi.fn(async () => {});
    const handle = installWallpaperRotation({
      intervalMs: 1_000_000, now: () => 10_000_000,
      read: async () => wp({ paths: ["/a.png", "/notes.txt"] }), apply, exists: () => true,
    });
    const out = await handle.tick();
    handle.stop();
    expect(out).toMatchObject({ applied: false, reason: "下一个候选不是图片/视频" });
    expect(apply).not.toHaveBeenCalled();
  });
});
