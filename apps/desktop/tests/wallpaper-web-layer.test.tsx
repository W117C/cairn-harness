// 网站壁纸的渲染面：iframe 有 src / sandbox / referrerPolicy，且不吃鼠标。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WallpaperLayer } from "../src/renderer/components/WallpaperLayer";
import { wallpaperViewOf } from "../src/renderer/state/wallpaper";
import { DEFAULT_SETTINGS } from "../../../src/main/settings";
import type { AppSettings } from "../../../src/main/ipc-protocol";

const settings = (url: string | null): AppSettings => ({
  ...DEFAULT_SETTINGS,
  wallpaper: { ...DEFAULT_SETTINGS.wallpaper, kind: url === null ? "none" : "web", path: null, url },
}) as AppSettings;

describe("网站壁纸层", () => {
  it("iframe 带 src、sandbox、no-referrer、data 属性", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={wallpaperViewOf(settings("https://example.com/live"))} />);
    expect(html).toContain('data-wallpaper-web="true"');
    expect(html).toContain('src="https://example.com/live"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
    expect(html.toLowerCase()).toContain("no-referrer");
    expect(html).toContain('data-kind="web"');
  });

  it("address 为空 ⇒ 不渲染任何层（不留空壳）", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={wallpaperViewOf(settings(null))} />);
    expect(html).toBe("");
  });

  it("图片壁纸不会被当成网站（两者互斥）", () => {
    const img = { ...settings(null), wallpaper: { ...DEFAULT_SETTINGS.wallpaper, kind: "image" as const, path: "/tmp/a.png", url: null, revision: 2 } } as AppSettings;
    const html = renderToStaticMarkup(<WallpaperLayer view={wallpaperViewOf(img)} />);
    expect(html).toContain("<img");
    expect(html).not.toContain("data-wallpaper-web");
  });
});
