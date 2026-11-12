// 第 1138 页：AutomationPane rows 记忆后，list 的排序 memo 才真正命中。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("AutomationPane 行表记忆", () => {
  it("rows/selected useMemo 与 list 共用稳定 rows", () => {
    expect(src).toContain("const rows = useMemo(() => schedule.tasks");
    expect(src).toContain("const list = useMemo(() => (sortByName ? [...rows].sort((a, b) => a.name.localeCompare(b.name, \"zh\")) : rows), [rows, sortByName]);");
    expect(src).toContain("const selected = useMemo(() => sel === null ? null : schedule.tasks.find");
  });
});
