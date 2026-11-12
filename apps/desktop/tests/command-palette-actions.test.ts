// 第 1136 页：命令面板动作筛选按 sessionOpen 记忆，最近项查 OPS_BY_ID。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("CommandPalette 动作索引", () => {
  it("actions useMemo + OPS_BY_ID 查找", () => {
    expect(src).toContain("const OPS_BY_ID = new Map(OPS.map((op) => [op.id, op] as const));");
    expect(src).toContain("const actions = useMemo(() => OPS.filter((op) => op.sessionOnly !== true || sessionOpen), [sessionOpen]);");
    expect(src).toContain("const op = OPS_BY_ID.get(id);");
  });
});


// 第 1179 页：会话/技能/项目行按输入记忆，查询键击与 60s 时钟不重扫。
describe("CommandPalette 行表记忆", () => {
  it("visible / skillItems / paletteProjects 三处 useMemo 源锚", () => {
    expect(src).toContain("const visible = useMemo(() => props.sessions.filter((s) => s.archived !== true), [props.sessions]);");
    expect(src).toContain("const skillItems = useMemo(() => uniqueSkills(props.skills ?? []), [props.skills]);");
    expect(src).toContain("const paletteProjects = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name, path: p.path })), [projects]);");
    expect(src).toContain("projects={paletteProjects}");
    // 反钉：旧的无记忆形状不许回来。
    expect(src).not.toContain("const visible = props.sessions.filter((s) => s.archived !== true);");
    expect(src).not.toContain("const skillItems = uniqueSkills(props.skills ?? []);");
    expect(src).not.toContain("projects={projects.map((p) => ({ id: p.id, name: p.name, path: p.path }))}");
  });
});
