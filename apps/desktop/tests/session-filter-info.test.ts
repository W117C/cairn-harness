// 第 1157 页：筛选元数据从静态 find 改为一次建表，Sidebar 与筛选菜单共用。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("sessionFilterInfo", () => {
  it("Sidebar/菜单都走同一查询", () => {
    expect(src).toContain("const SESSION_FILTER_BY_ID = new Map(SESSION_FILTERS.map((f) => [f.id, f] as const));");
    expect(src).toContain("const filterInfo = sessionFilterInfo(filter);");
    expect(src).toContain("const info = sessionFilterInfo(props.filter);");
  });
});
