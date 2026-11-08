// Composer 圆角判卷（2026-10-21，2026-10-28 第 734 页修订）：
// v3 把 composer 从 14px 收到 12px；用户气泡的基础档仍是 --radius-composer 14（回退），
// 但 CDS 组件层已把**有效值**对齐官方：radius = --radius + .25rem = 12px。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", ...parts), "utf8");

describe("Composer 圆角", () => {
  it("独立令牌是 12px 档", () => {
    expect(read("tokens.css")).toMatch(/--radius-composer-card:\s*calc\(0\.75rem \* var\(--size-scale\)\)/);
  });

  it("composer-card 消费新令牌；用户气泡基础档保留 14px 回退，CDS 层覆盖为官方 12px", () => {
    const css = read("styles.css");
    expect(css).toMatch(/\.composer-card\s*\{[^}]*border-radius:\s*var\(--radius-composer-card\)/s);
    expect(css).toMatch(/\.row\.user \.t\s*\{[^}]*border-radius:\s*var\(--radius-composer\)/s);
    const layer = read("cds-components.css");
    expect(layer).toMatch(/\.row\.user\[data-cds="UserMessage"\] \.t\s*\{[^}]*border-radius:\s*var\(--cds-message-bubble-radius\)/s);
  });

  it("vendored 皮肤的 18px 被覆盖层压回令牌", () => {
    const skin = read("dsh-claude-style.css");
    expect(skin).toContain("body[data-dsh-claude-style] [data-composer-card]::after");
    expect(skin).toMatch(/border-radius:\s*var\(--radius-composer-card\)/);
  });
});
