// 第 1105 页：插件目录 shelf 的 entryIds 不再逐 id 扫 props.rows；一次 Map 建索引。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("PluginDiscover 行索引", () => {
  it("rowById 一次建好，shelf 渲染 O(entries)", () => {
    expect(src).toContain("const rowById = useMemo(() => new Map(props.rows.map((row) => [row.id, row] as const)), [props.rows]);");
    expect(src).toContain(".map((id) => rowById.get(id))");
    expect(src).not.toContain(".map((id) => props.rows.find((row) => row.id === id))");
  });
});
