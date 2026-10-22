// 浮层圆角判卷（2026-10-21）：v3 `panel-radius = .625rem`（10px）。
// 菜单/浮层与设置卡统一 10px；只有用户气泡等独立面保留 14px。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", ...parts), "utf8");

describe("浮层圆角", () => {
  it("v3 面板令牌是 10px 档", () => {
    expect(read("tokens.css")).toMatch(/--radius-pop-v3:\s*calc\(0\.625rem \* var\(--size-scale\)\)/);
  });

  it("三类菜单浮层与设置卡都消费 10px", () => {
    const css = read("styles.css");
    for (const sel of [".pop", ".path-menu", ".pop-rd"]) {
      const start = css.indexOf(sel + " {");
      expect(start, sel).toBeGreaterThanOrEqual(0);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, sel).toContain("border-radius: var(--radius-pop-v3);");
    }
    const card = css.slice(css.indexOf(".ss-card"), css.indexOf("}", css.indexOf(".ss-card")));
    expect(card).toContain("border-radius: var(--radius-pop-v3);");
  });
});
