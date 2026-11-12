// 第 1150 页：MigrationSection 的 imported/skipped 索引按 result 记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("迁移结果索引", () => {
  it("imported/skipped useMemo", () => {
    expect(src).toContain("const imported = useMemo(() => new Set(result?.imported), [result]);");
    expect(src).toContain("const skipped = useMemo(() => new Map(result?.skipped.map(({ id, detail }) => [id, detail])), [result]);");
  });
});
