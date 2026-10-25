import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sidebar, type SidebarProps } from "../src/renderer/components/Sidebar";

const noop = (): void => undefined;
const projects = ["A", "B"].map((name) => ({
  id: name, name, path: `/tmp/${name}`, defaultLocation: `/tmp/${name}`,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
}));
const props: SidebarProps = {
  projects, sessions: projects.map((p) => ({ id: "same", title: p.name, workspace: p.path, mtimeMs: 0, lines: 1 })),
  activeId: "same", activeWorkspace: "/tmp/A", running: new Set(), waitingIds: new Set(), outcomes: new Map(),
  providerOk: null, theme: "system", onThemeChange: noop, usage: null,
  onOpen: noop, onNewTask: noop, onOpenPalette: noop, onSwitchWorkspace: noop,
  onAddProject: async () => undefined, onCloneProject: async () => undefined,
  onOpenNewProjectDialog: noop, onUpdateProject: async () => undefined,
  onRemoveProject: async () => undefined, onRevealProject: noop,
  onOpenSettings: noop, onPickDirectory: async () => null,
};
const rows = (activeWorkspace: string): string[] => [...renderToStaticMarkup(
  <Sidebar {...props} activeWorkspace={activeWorkspace} />,
).matchAll(/<div[^>]*class="session(?: active)?"[^>]*>/g)].map((m) => m[0]);

describe("同名会话的侧栏身份", () => {
  it("只有当前工作区同名行处于选中态", () => {
    const rendered = rows("/tmp/A");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain('aria-selected="true"');
    expect(rendered[1]).toContain('aria-selected="false"');
    expect(rendered[1]).not.toContain('class="session active"');
    const switched = rows("/tmp/B");
    expect(switched[0]).toContain('aria-selected="false"');
    expect(switched[1]).toContain('aria-selected="true"');
  });

  it("当前工作区会话未列在清单中，不借用其他项目的同名行", () => {
    const rendered = rows("/tmp/old-project");
    expect(rendered).toHaveLength(2);
    for (const row of rendered) {
      expect(row).toContain('aria-selected="false"');
      expect(row).not.toContain('class="session active"');
    }
  });
});
