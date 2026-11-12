// 第 1167 页：设置导航三组一次分好，不随局部状态重跑 filter。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("设置导航分组记忆", () => {
  it("navGroups useMemo 与 map", () => {
    expect(src).toContain("const navGroups = useMemo(() => ([\"settings\", \"workspace\", \"system\"] as const).map((group) => ({");
    expect(src).toContain("{navGroups.map(({ group, ids: groupIds }) => {");
  });
});
