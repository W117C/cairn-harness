// 产品文档对齐判卷（2026-10-30 · 第 833 页）：
// README 不能在桌面端已交付 0.2.0 后还说「交付面只做 CLI」；PRODUCT.md 不能把桌面壳写成 web。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");

describe("产品文档对齐", () => {
  it("README 不再声称只交付 CLI，并指向桌面端 0.2.0", () => {
    const readme = read("README.md");
    expect(readme).not.toContain("交付面只做 CLI");
    expect(readme).toContain("桌面应用在 `apps/desktop/`");
  });

  it("PRODUCT.md 的 Platform 是 macOS desktop，不是 web", () => {
    const product = read("apps/desktop/PRODUCT.md");
    expect(product).toContain("macOS desktop（Electron + React");
    expect(product).not.toContain("## Platform\n\nweb\n");
  });
});
