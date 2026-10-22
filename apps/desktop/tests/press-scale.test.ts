// 按压缩放判卷（2026-10-21，v3 `btn-press-sx/sy = .975`）：
// 主按钮与发送按钮统一走 --press-btn，不再各写 0.98 / 0.97。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", ...parts), "utf8");

describe("按压缩放", () => {
  it("令牌是 v3 的 .975", () => {
    expect(read("tokens.css")).toMatch(/--press-btn:\s*0\.975;/);
  });

  it("主按钮与发送按钮都消费令牌，且旧硬编码已绝迹", () => {
    const css = read("styles.css");
    expect(css).toContain(".btn:active { transform: scale(var(--press-btn)); }");
    expect(css).toContain(".send-btn:active { transform: scale(var(--press-btn)); }");
    expect(css).not.toContain(".btn:active { transform: scale(0.98); }");
    expect(css).not.toContain(".send-btn:active { transform: scale(0.97); }");
    expect(css).not.toContain(".send-btn:active { transform: scale(.97); }");
  });
});
