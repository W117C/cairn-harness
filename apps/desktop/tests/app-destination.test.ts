import { describe, expect, it } from "vitest";
import {
  createPageFilters,
  pageFilterFor,
  withPageFilter,
} from "../src/renderer/state/app-destination";

describe("app destination state", () => {
  it("starts each durable page on its own real filter", () => {
    const filters = createPageFilters();
    // 2026-11-02：插件页的筛选栏只剩分类（视图归页内标签条），缺省是「全部能力」。
    expect(filters).toEqual({ plugins: "all", memory: "all", automation: "all" });
    expect(pageFilterFor("plugins", filters)).toBe("all");
    expect(pageFilterFor("memory", filters)).toBe("all");
    expect(pageFilterFor("chat", filters)).toBe("");
  });

  it("updates one page without changing another page's filter", () => {
    const initial = createPageFilters();
    const next = withPageFilter(initial, "memory", "global");

    expect(next).toEqual({ plugins: "all", memory: "global", automation: "all" });
    expect(next).not.toBe(initial);
  });
});
