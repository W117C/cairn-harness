// 项目「更改项目目录…」的渲染层接线判卷（2026-10-30 · 第 801 页）。
// 核心行为（保 id/name、defaultLocation 随迁、拒绝冲突）在 core `tests/project-registry.test.ts`；
// 这里钉的是**渲染层真的把这条路接上了**：菜单项、系统选择器、relocateProject 调用、当前工作区跟随。
// 读整张 app surface（不是单个文件）——代码搬家时不会空过。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

describe("项目重新定位接线", () => {
  it("菜单项与系统选择器都在：点「更改项目目录…」→ 选目录 → 调 relocateProject", () => {
    expect(app).toContain("STR.projectMenu.relocate");
    expect(app).toContain("props.onPickDirectory().then");
    expect(app).toContain("props.onRelocateProject(project, picked)");
    expect(app).toContain("window.agent.relocateProject(p.id, nextPath)");
  });

  it("成功后刷新项目与会话；正停在这个项目时工作区跟到新路径", () => {
    expect(app).toContain("const updated = await window.agent.relocateProject(p.id, nextPath);");
    expect(app).toContain("if (activeWorkspaceRef.current === p.path) {");
    expect(app).toContain("activeWorkspaceRef.current = updated.path;");
    expect(app).toContain("STR.toast.projectRelocated");
    expect(app).toContain("onRelocateProject: handleRelocateProject");
  });
});
