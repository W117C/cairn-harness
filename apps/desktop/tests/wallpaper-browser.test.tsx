// 应用内选择器（渲染面）判卷：列目录、目录可下钻、点文件回路径、空目录明说。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WallpaperBrowser } from "../src/renderer/components/settings/WallpaperBrowser";

describe("应用内选择器", () => {
  it("列出目录与文件；文件带 title=完整路径（点它才有路径可回）", () => {
    const html = renderToStaticMarkup(
      <WallpaperBrowser
        onPickPath={() => {}}
        initial={{
          dir: "/tmp/wp",
          parent: "/tmp",
          entries: [
            { name: "sub", path: "/tmp/wp/sub", kind: "dir" },
            { name: "a.png", path: "/tmp/wp/a.png", kind: "file" },
          ],
        }}
      />,
    );
    expect(html).toContain('data-wallpaper-browser="true"');
    expect(html).toContain("cw-browser-row dir");
    expect(html).toContain("cw-browser-row file");
    expect(html).toContain('title="/tmp/wp/a.png"');
    expect(html).toContain('data-dir="/tmp/wp"');
  });

  it("空目录明说，不留白", () => {
    const html = renderToStaticMarkup(
      <WallpaperBrowser onPickPath={() => {}} initial={{ dir: "/tmp/empty", parent: null, entries: [] }} />,
    );
    expect(html).toContain("没有可用的图片或视频");
  });
});
