// 侧栏骨架微光判卷（2026-10-21，v3 skeleton-sheen）：
// ① 底条保留 breathe；② 扫光是一条独立伪元素；③ reduced-motion 明确停掉扫光。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");

describe("侧栏骨架微光", () => {
  it("底条仍是静态可读的 bg-300 + breathe", () => {
    expect(css).toMatch(/\.side-skeleton-row\s*\{[^}]*background:\s*hsl\(var\(--bg-300\)\)/s);
    expect(css).toMatch(/\.side-skeleton-row\s*\{[^}]*animation:\s*breathe 1\.6s/s);
  });

  it("扫光是独立伪元素，不换底", () => {
    expect(css).toMatch(/\.side-skeleton-row::after\s*\{[^}]*linear-gradient\(90deg/s);
    expect(css).toContain("@keyframes skeleton-sheen");
  });

  it("reduced-motion 明确停掉扫光", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.side-skeleton-row::after\s*\{\s*animation:\s*none;/);
  });
});
