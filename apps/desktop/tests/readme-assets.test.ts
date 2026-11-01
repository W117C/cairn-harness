// README 截图引用判卷（2026-10-30 · 第 821 页）：
// 文档里引用的本地图片必须真的存在且非空；不允许出现指向不存在路径的「产品截图」。
import { statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
const links = [...readme.matchAll(/!\[[^\]]*\]\((assets\/readme\/[^)\s]+)\)/g)].map((m) => m[1]!);

describe("README 本地截图", () => {
  it("至少有两张桌面截图，且每张都存在、非空", () => {
    expect(new Set(links).size).toBeGreaterThanOrEqual(2);
    for (const rel of new Set(links)) {
      const info = statSync(root + rel);
      expect(info.isFile(), rel).toBe(true);
      expect(info.size, rel).toBeGreaterThan(10_000);
    }
  });
});
