import { describe, expect, it } from "vitest";
import {
  createPageFilters,
  pageFilterFor,
  withPageFilter,
} from "../src/renderer/state/app-destination";

describe("app destination state", () => {
  it("starts each durable page on its own real filter", () => {
    const filters = createPageFilters();
    expect(filters).toEqual({ plugins: "discover", memory: "all", automation: "all" });
    expect(pageFilterFor("plugins", filters)).toBe("discover");
    expect(pageFilterFor("memory", filters)).toBe("all");
    expect(pageFilterFor("chat", filters)).toBe("");
  });

  it("updates one page without changing another page's filter", () => {
    const initial = createPageFilters();
    const next = withPageFilter(initial, "memory", "global");

    expect(next).toEqual({ plugins: "discover", memory: "global", automation: "all" });
    expect(next).not.toBe(initial);
  });
});
