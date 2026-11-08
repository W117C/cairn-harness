// worker 改动预览的 patch 解析判卷（2026-10-23）。
import { describe, expect, it } from "vitest";
import { clipDiff, parseUnifiedPatch } from "../src/renderer/diff-patch";

describe("parseUnifiedPatch：git patch → DiffView hunks", () => {
  it("文件头跳过；+/-/空格三类行与两侧行号正确", () => {
    const hunks = parseUnifiedPatch([
      "diff --git a/a.txt b/a.txt",
      "index 111..222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+three",
      "",
    ].join("\n"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe("@@ -1,2 +1,2 @@");
    expect(hunks[0]!.lines).toEqual([
      { kind: "ctx", text: "one", oldNo: 1, newNo: 1 },
      { kind: "del", text: "two", oldNo: 2, newNo: null },
      { kind: "add", text: "three", oldNo: null, newNo: 2 },
    ]);
  });

  it("多 hunk 各自计数；\\ No newline 不进行", () => {
    const hunks = parseUnifiedPatch([
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "\\ No newline at end of file",
      "@@ -10,1 +10,1 @@",
      "-c",
      "+d",
    ].join("\n"));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.map((l) => l.kind)).toEqual(["del", "add"]);
    expect(hunks[1]!.lines[1]!.newNo).toBe(10);
  });

  it("解析不出来 ⇒ []（调用方回落原文，不把没解析说成没差异）", () => {
    expect(parseUnifiedPatch("not a diff\n")).toEqual([]);
    expect(parseUnifiedPatch("")).toEqual([]);
  });
});
describe("clipDiff：预览 UI 帽", () => {
  it("不超帽原样；超帽截到帽并标 truncated（不假装完整）", () => {
    expect(clipDiff("abc", 10)).toEqual({ text: "abc", truncated: false });
    const long = "x".repeat(11);
    expect(clipDiff(long, 10)).toEqual({ text: "x".repeat(10), truncated: true });
    expect(clipDiff("abc", 3)).toEqual({ text: "abc", truncated: false });
  });
});
