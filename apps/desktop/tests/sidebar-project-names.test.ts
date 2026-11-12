// 第 1103 页：Sidebar 每行项目名不再线性 projectLabelFor 扫项目表；options 与 name Map 按 props 缓存。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("Sidebar 项目名索引", () => {
  it("projectOptions/projectNameById 一次建好，行内 O(1) 查", () => {
    expect(src).toContain("const projectOptions = useMemo(() => props.projects.map((p) => ({ id: p.id, name: p.name })), [props.projects]);");
    expect(src).toContain("const projectNameById = useMemo(() => new Map(projectOptions.map((p) => [p.id, p.name] as const)), [projectOptions]);");
    expect(src).toContain("return projectNameById.get(id) ?? id;");
    expect(src).not.toContain("projectLabelFor(s, projectOptions)");
  });
});
