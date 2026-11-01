// 桌面打包文档判卷（2026-10-30 · 第 808 页）：
// README 里写的打包命令、产物清单必须和 scripts/package.mjs 的实际行为同源；
// `release-*` 是 500MB 级临时产物，必须被忽略，不能混进工作树。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");

describe("README 桌面打包说明", () => {
  it("给出可复制的打包命令与产物清单（build-info / packagedSmoke / ad-hoc）", () => {
    const readme = read("README.md");
    expect(readme).toContain("node apps/desktop/scripts/package.mjs --out");
    expect(readme).toContain("build-info.json");
    expect(readme).toContain("packagedSmoke: passed");
    expect(readme).toContain("ad-hoc");
    expect(readme).toContain("Cairn.dmg");
    expect(readme).toContain("Cairn-macOS.zip");
    expect(readme).toContain("Applications");
    expect(readme).toContain("scripts/update-manifest.ts");
    expect(readme).toContain("--version 0.2.0");
  });

  it("打包脚本仍坚持「冒烟不过不产出」；release-* 被忽略", () => {
    const pkg = read("apps/desktop/scripts/package.mjs");
    expect(pkg).toContain("packagedSmokePassed");
    expect(pkg).toContain("不生成已验证产物");
    expect(read(".gitignore")).toContain("apps/desktop/release-*/");
  });
});
