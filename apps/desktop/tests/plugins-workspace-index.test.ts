// 第 1140 页：PluginsWorkspace 的 visibleRows/discoverRows/selected 按输入记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("PluginsWorkspace 行表记忆", () => {
  it("visibleRows/discoverRows/selected useMemo", () => {
    expect(src).toContain("const visibleRows = useMemo(() => filterPluginRows(state.rows, state.query, effectiveCategory)");
    expect(src).toContain("const discoverRows = useMemo(() => visibleRows.filter((row) => row.catalogEntry !== null), [visibleRows]);");
    expect(src).toContain("const selected = useMemo(() => state.selectedId === null");
  });
});
