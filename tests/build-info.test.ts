// 包内构建信息判卷（2026-10-30 · 第 820 页）：
// 关于页只认包内 build-info.json；七个字段缺一/非字符串 → null，绝不用半份数据冒充构建凭据。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBuildInfo, readBuildInfoSync } from "../src/main/build-info";

const dirs: string[] = [];
const fileWith = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "cairn-build-info-"));
  dirs.push(dir);
  const file = join(dir, "build-info.json");
  writeFileSync(file, content, "utf8");
  return file;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const good = {
  version: "0.1.0", platform: "darwin", arch: "arm64",
  sourceLockSha256: "abc", packagedSmoke: "passed", signature: "ad-hoc",
  createdAt: "2026-10-30T07:47:07.229Z",
};

describe("parseBuildInfo", () => {
  it("七个字符串字段齐全才接受", () => {
    expect(parseBuildInfo(good)).toEqual(good);
    for (const key of Object.keys(good)) {
      expect(parseBuildInfo({ ...good, [key]: 42 }), key).toBeNull();
    }
    expect(parseBuildInfo(null)).toBeNull();
    expect(parseBuildInfo([])).toBeNull();
  });
});

describe("readBuildInfoSync", () => {
  it("好文件读得出；坏 JSON / 缺文件 = null（开发态不编造）", () => {
    expect(readBuildInfoSync(fileWith(JSON.stringify(good)))).toEqual(good);
    expect(readBuildInfoSync(fileWith("{bad"))).toBeNull();
    expect(readBuildInfoSync(join(tmpdir(), "cairn-no-such-build-info.json"))).toBeNull();
  });
});
