// 第 1160 页：PluginInstalled 的已安装/未托管行按 rows 记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("PluginInstalled 行表记忆", () => {
  it("installed/unmanaged useMemo", () => {
    expect(src).toContain("const installed = useMemo(() => props.rows.filter((row) => row.installed !== null), [props.rows]);");
    expect(src).toContain("const unmanaged = useMemo(() => props.rows.filter((row) => row.installed === null && row.runtime !== null), [props.rows]);");
  });
});
