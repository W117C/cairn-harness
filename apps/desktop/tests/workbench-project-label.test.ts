// 第 1144 页：工作区显示名单源；ADR 0019 项目卡落地后，工具栏继续复用 activeProjectLabel，
// 首页项目卡则消费真实 ProjectRecord 并在组件内按同一规则回落 basename。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("工作区显示名单源", () => {
  it("工具栏与项目卡共用真实工作区数据，名称回落规则不漂移", () => {
    expect(src).toContain("const activeProjectLabel = useMemo(() => activeWorkspace === null ? null");
    expect(src).toContain("projects={visibleLauncherProjects}");
    expect(src).toContain("activeWorkspace={activeWorkspace}");
    expect(src).toContain("project.name || project.path.slice(project.path.lastIndexOf(\"/\") + 1)");
  });
});
