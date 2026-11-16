// 网站壁纸：只收 https（http/data/blob 一律拒）；kind=web 时 path 归零；关掉 url 自动回落 none。
import { describe, expect, it } from "vitest";
import { validateSettings } from "../src/main/settings";

const wp = (patch: Record<string, unknown>) => validateSettings({ wallpaper: patch }).wallpaper;

describe("网站壁纸（设置校验）", () => {
  it("https 地址保留；kind=web 时 path 必须归零", () => {
    const w = wp({ kind: "web", url: "https://example.com/live", path: "/tmp/a.png" });
    expect(w.kind).toBe("web");
    expect(w.url).toBe("https://example.com/live");
    expect(w.path).toBeNull();
  });

  it("http / data: / blob: / 空 一律拒，kind 回落 none", () => {
    for (const url of ["http://example.com", "data:text/html,<b>x</b>", "blob:https://x/y", ""]) {
      const w = wp({ kind: "web", url });
      expect(w.kind, url).toBe("none");
      expect(w.url, url).toBeNull();
    }
  });

  it("非 web 的 kind 不保留 url（防止残值把页面偷偷带回来）", () => {
    const w = wp({ kind: "image", path: "/tmp/a.png", url: "https://example.com" });
    expect(w.url).toBeNull();
    expect(w.kind).toBe("image");
  });
});
