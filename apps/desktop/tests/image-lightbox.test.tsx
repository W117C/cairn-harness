// 图片灯箱判卷（2026-10-31）：参考库 `MediaLightboxViewer` 的移植面。
// 本仓无 jsdom：缩放/平移数学走纯函数，接线走 SSR + 源码哨兵，样式走 CSS 源码钉。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/renderer/markdown";
import { anchoredOffset, clampLightboxOffset, clampLightboxScale, galleryStep } from "../src/renderer/components/ImageLightbox";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("图片灯箱：缩放/平移纯函数", () => {
  it("缩放钳制在 1–4x，非有限值回到 1", () => {
    expect(clampLightboxScale(0.2)).toBe(1);
    expect(clampLightboxScale(2.5)).toBe(2.5);
    expect(clampLightboxScale(9)).toBe(4);
    expect(clampLightboxScale(Number.NaN)).toBe(1);
    expect(clampLightboxScale(Number.POSITIVE_INFINITY)).toBe(4);
  });

  it("光标锚定：指针下的像素在缩放前后保持不动", () => {
    // 指针在中心右侧 100px，从 1x 放到 2x：平移量必须是 -100，视觉上该点不动。
    expect(anchoredOffset(100, 0, 1, 2)).toBe(-100);
    // 反向缩回 1x：从 -100 回到 0。
    expect(anchoredOffset(100, -100, 2, 1)).toBe(0);
    // fromScale 非法时原样返回，不制造 NaN。
    expect(anchoredOffset(100, 20, 0, 2)).toBe(20);
  });

  it("平移钳制：放大后可拖到边缘，但不拖飞", () => {
    // 视口 800、内容 1000、2x：最大溢出 = (2000 - 800) / 2 = 600。
    expect(clampLightboxOffset(500, 800, 1000, 2)).toBe(500);
    expect(clampLightboxOffset(900, 800, 1000, 2)).toBe(600);
    expect(clampLightboxOffset(-900, 800, 1000, 2)).toBe(-600);
    // 1x 不许平移。
    expect(clampLightboxOffset(300, 400, 200, 1)).toBe(0);
  });
});

describe("图片灯箱：SSR 接线", () => {
  it("data:image 直接渲染可点开的缩略图按钮，灯箱初始不挂载", () => {
    const html = renderToStaticMarkup(<Markdown text={"![示例](data:image/png;base64,AAAA)"} />);
    expect(html).toContain('class="md-img-open"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="预览图片"');
    expect(html).toContain("<img");
    expect(html).not.toContain("img-lightbox");
  });

  it("https 图仍先给门闩，未点击不出现 img / 灯箱", () => {
    const remote = renderToStaticMarkup(<Markdown text={"![示例](https://example.com/a.png)"} />);
    expect(remote).toContain("md-img-gate");
    expect(remote).not.toContain("<img");
    expect(remote).not.toContain("md-img-open");
  });
});

describe("图片灯箱：来源与判卷锚", () => {
  const lightbox = read("../src/renderer/components/ImageLightbox.tsx");
  const markdown = read("../src/renderer/markdown.tsx");
  const css = read("../src/renderer/styles.css");

  it("使用 ModalSurface + body portal + 非被动滚轮 + 指针捕获", () => {
    expect(lightbox).toContain("createPortal");
    expect(lightbox).toContain("<ModalSurface");
    expect(lightbox).toContain('addEventListener("wheel", onWheel, { passive: false })');
    expect(lightbox).toContain('data-cds="MediaLightboxViewer"');
    expect(lightbox).toContain("setPointerCapture");
  });

  it("markdown 只在点击缩略图后挂灯箱，并把焦点还给触发按钮", () => {
    expect(markdown).toContain("ImageLightbox");
    expect(markdown).toContain("md-img-open");
    expect(markdown).toContain("returnFocusRef={openerRef}");
  });

  it("样式含深色遮罩、缩放光标、满幅视口与触摸语义", () => {
    expect(css).toContain(".img-lightbox");
    expect(css).toContain('.il-viewport[data-zoomed="true"]');
    expect(css).toContain(".il-img");
    expect(css).toContain("touch-action: none");
  });

  it("上游出处、commit 与 MIT 许可在 vendor 里", () => {
    const upstream = JSON.parse(read("../src/renderer/vendor/open-claude-ui/UPSTREAM.json")) as {
      commit?: string;
      license?: string;
      reference?: unknown[];
    };
    expect(upstream.commit).toBe("c1f923ae0051a871941b98a0e2e3183a545e6a85");
    expect(upstream.license).toBe("MIT");
    expect(upstream.reference?.length).toBe(2);
    expect(read("../src/renderer/vendor/open-claude-ui/LICENSE")).toContain("MIT License");
  });
});

describe("图片灯箱：多图画廊", () => {
  it("索引首尾环绕；单图恒 0", () => {
    expect(galleryStep(0, 3, -1)).toBe(2);
    expect(galleryStep(2, 3, 1)).toBe(0);
    expect(galleryStep(1, 3, 1)).toBe(2);
    expect(galleryStep(0, 1, 1)).toBe(0);
  });
  it("组件从同会话缩略图收集画廊，渲染计数与上/下一张，并接 ←/→", () => {
    const src = read("../src/renderer/components/ImageLightbox.tsx");
    expect(src).toContain('root.querySelectorAll<HTMLImageElement>(".md-img-open img")');
    expect(src).toContain('opener?.closest(".md-body")');
    expect(src).toContain('role="status" aria-live="polite"');
    expect(src).toContain("STR.markdown.imagePrev");
    expect(src).toContain("STR.markdown.imageNext");
    expect(src).toContain('if (e.key === "ArrowLeft")');
    expect(src).toContain('if (e.key === "ArrowRight")');
    expect(src).toContain('className="il-count"');
    const css = read("../src/renderer/styles.css");
    expect(css).toContain(".il-count");
  });
  it("遮罩足够不透明：底层会话图不能透出来冒充第二张", () => {
    const tokens = read("../src/renderer/tokens.css");
    expect(tokens).toContain("--lightbox-scrim: rgb(10 10 9);");
    expect(read("../src/renderer/styles.css")).toContain("background: var(--lightbox-scrim)");
  });
});
