// 第 1168 页：非置顶行复用 EMPTY_ROW_ATTRS，不再每行造空对象。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("PinnedOrder 空属性复用", () => {
  it("EMPTY_ROW_ATTRS 常量与返回", () => {
    expect(src).toContain("const EMPTY_ROW_ATTRS: PinnedRowAttrs = {};");
    expect(src).toContain("return EMPTY_ROW_ATTRS;");
  });
});
