// 生产 CSP（2026-10-17）：build-only 注入。dev 不能注入——@vitejs/plugin-react 会往
// index.html 插内联 preamble，静态 'self' 会把 pnpm dev 一起打死。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cfg = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
const html = readFileSync(fileURLToPath(new URL("../src/renderer/index.html", import.meta.url)), "utf8");

describe("生产 CSP 注入", () => {
  it('只在 build 生效（apply: "build"），index.html 本体不写死 CSP', () => {
    expect(cfg).toContain('apply: "build"');
    expect(html).not.toContain("Content-Security-Policy");
  });

  it("关键指令在场：无 eval、无 object、base/form 锁死", () => {
    expect(cfg).toContain("script-src 'self'");
    expect(cfg).not.toContain("'unsafe-eval'");
    expect(cfg).toContain("object-src 'none'");
    expect(cfg).toContain("base-uri 'none'");
    expect(cfg).toContain("form-action 'none'");
  });
});
