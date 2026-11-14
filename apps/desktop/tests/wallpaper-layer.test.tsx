// 壁纸层组件判卷（2026-11-14 · 设计规格 §3.5）：
// 无壁纸不渲染；有图出 img、有视频出 muted/loop 的 video；src 走协议。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WallpaperLayer } from "../src/renderer/components/WallpaperLayer";

describe("壁纸层", () => {
  it("无壁纸不渲染任何东西", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={{ kind: "none", url: null }} />);
    expect(html).toBe("");
  });

  it("图片壁纸出 img，src 走协议", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={{ kind: "image", url: "cairn-wallpaper://media/current?v=1" }} />);
    expect(html).toContain("cairn-wallpaper://media/current?v=1");
    expect(html).toContain("<img");
    expect(html).toContain("cw-scrim");
  });

  it("视频壁纸出 muted loop 的 video", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={{ kind: "video", url: "cairn-wallpaper://media/current?v=2" }} />);
    expect(html).toContain("<video");
    expect(html).toContain("muted");
    expect(html).toContain("loop");
  });
});
