// 第 1123 页：IdleTaskPane 的 tasks/active/history 按 snapshot/filter 记忆，表单输入不重跑筛选排序。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("IdleTaskPane 列表记忆", () => {
  it("tasks/active/history 都有 useMemo，依赖 snapshot/filter", () => {
    expect(src).toContain("const tasks = useMemo(() => snapshot?.tasks ?? [], [snapshot]);");
    expect(src).toContain("const active = useMemo(() => tasks.filter");
    expect(src).toContain("const history = useMemo(() => tasks.filter");
  });
});
