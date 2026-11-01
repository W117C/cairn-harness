// 流底渐隐判卷（2026-10-21，v3 scroll-fade-size 28px）：
// ① 令牌存在且按 size-scale；② CSS 只在 data-on=true 时显形；③ App 用贴底状态驱动，不常亮。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", ...parts), "utf8");

describe("流底渐隐", () => {
  it("令牌是 28px 档，跟 size-scale", () => {
    const tokens = read("tokens.css");
    expect(tokens).toMatch(/--scroll-fade:\s*calc\(1\.75rem \* var\(--size-scale\)\)/);
  });

  it("CSS 默认透明，只在 data-on=true 显形，且不接鼠标", () => {
    const css = read("styles.css");
    expect(css).toContain(".stream-fade-bottom");
    expect(css).toContain("height: var(--scroll-fade)");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain('.stream-fade-bottom[data-on="true"] { opacity: 1; }');
  });

  it("App 用 !stick.stuck 驱动底边，贴底时不亮", () => {
    const app = readAppSurface();
    expect(app).toContain('className="stream-fade-bottom" data-on={!stick.stuck}');
  });

  it("顶部渐隐用 atTop 驱动，且 sticky 在 reading 顶部", () => {
    const app = readAppSurface();
    const css = read("styles.css");
    const hook = read("useStickyScroll.ts");
    expect(app).toContain('className="stream-fade-top" data-on={!stick.atTop}');
    expect(css).toContain(".stream-fade-top");
    expect(css).toContain("position: sticky; top: 0; z-index: 2;");
    expect(hook).toContain("atTop: boolean;");
    expect(hook).toContain("setAtTop(el.scrollTop <= AT_TOP_PX);");
    expect(hook).toContain("const AT_TOP_PX = 2;");
  });

  it("7 档非线性 alpha（2026-10-31）：底边/顶边各 8 个 stop，贴边不透明、向内容透明", () => {
    const css = read("styles.css");
    for (const edge of ["stream-fade-bottom", "stream-fade-top"]) {
      const block = css.match(new RegExp(`\\.${edge}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
      expect(block).toContain("hsl(var(--bg-100) / 1)");
      expect(block).toContain("hsl(var(--bg-100) / .85) 13%");
      expect(block).toContain("hsl(var(--bg-100) / .70) 25%");
      expect(block).toContain("hsl(var(--bg-100) / .50) 40%");
      expect(block).toContain("hsl(var(--bg-100) / .30) 55%");
      expect(block).toContain("hsl(var(--bg-100) / .15) 70%");
      expect(block).toContain("hsl(var(--bg-100) / .05) 85%");
      expect(block).toContain("hsl(var(--bg-100) / 0) 100%");
    }
  });
});
