// macOS 打包必须带图标：缺失时 package.mjs 会在复制阶段失败，不能等到发版才发现。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const icon = fileURLToPath(new URL("../src/renderer/public/brand/cairn.icns", import.meta.url));
const png = fileURLToPath(new URL("../src/renderer/public/brand/cairn.png", import.meta.url));

describe("macOS 打包资产", () => {
  it("cairn.icns 是真实 ICNS，1024 源 PNG 在场", () => {
    const icns = readFileSync(icon);
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    const image = readFileSync(png);
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(image.readUInt32BE(16)).toBe(1024);
    expect(image.readUInt32BE(20)).toBe(1024);
  });

  it("打包脚本引用这份图标", () => {
    const source = readFileSync(fileURLToPath(new URL("../scripts/package.mjs", import.meta.url)), "utf8");
    expect(source).toContain("src/renderer/public/brand/cairn.icns");
  });
});
