// 第 1158 页：主题子菜单标签查 THEME_BY_ID，不再每次 find 三项表。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("AccountMenu 主题索引", () => {
  it("THEME_BY_ID 一次建表", () => {
    expect(src).toContain("const THEME_BY_ID = new Map(THEME_CHOICES.map((t) => [t.id, t] as const));");
    expect(src).toContain("THEME_BY_ID.get(theme)?.label");
  });
});
