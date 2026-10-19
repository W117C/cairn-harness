// P1-6 判卷：tooltip 审计（brief 第九节「图标钮必有 tooltip」；自查清单「所有可点元素都有
// tooltip / aria-label」的机器化）。面 = 重做批的四个组件收拢态真 HTML：
// Sidebar（顶栏/项目/会话行/页脚/添加项目）、NewProjectDialog、ProjectSettingsDialog、AddProjectMenu。
// 判据：每个 <button> 的起始标签里至少有 title= 或 aria-label=——缺一个就红，并打出那枚按钮。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar, ProjectSettingsDialog } from "../src/renderer/components/Sidebar";
import { NewProjectDialog } from "../src/renderer/components/NewProjectDialog";
import { AddProjectMenu } from "../src/renderer/components/AddProjectMenu";
import { templateCatalog } from "../../../src/main/project-templates";
import type { ProjectRecord } from "../../../src/main/ipc-protocol";

const PROJECT: ProjectRecord = {
  id: "p1",
  name: "工作区甲",
  path: "/tmp/ws",
  defaultLocation: "/tmp/ws",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function audit(html: string): void {
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) {
    expect(b.includes("title=") || b.includes("aria-label="), `按钮缺 tooltip/aria-label：${b}`).toBe(true);
  }
}

describe("tooltip 审计：重做面所有 <button> 都有 title 或 aria-label", () => {
  it("侧栏全量（顶栏 ＋ 新任务/搜索、项目行、会话行、页脚、添加项目）", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        projects={[PROJECT]}
        sessions={[{ id: "s1", title: "修左栏样式", mtimeMs: 1, lines: 3, workspace: "/tmp/ws", pinned: true }]}
        activeId="s1"
        activeWorkspace="/tmp/ws"
        running={new Set(["s1"])}
        waitingIds={new Set<string>()}
        outcomes={new Map([["s1", "ok"]])}
        providerOk={null}
        onOpen={() => undefined}
        onNewTask={() => undefined}
        onOpenPalette={() => undefined}
        onSwitchWorkspace={() => undefined}
        onAddProject={async () => undefined}
        onCloneProject={async () => undefined}
        onOpenNewProjectDialog={() => undefined}
        onUpdateProject={async () => undefined}
        onRemoveProject={async () => undefined}
        onRevealProject={() => undefined}
        onPickDirectory={() => Promise.resolve(null)}
        onOpenSettings={() => undefined}
      />,
    );
    audit(html);
  });

  it("新建项目 Dialog", () => {
    const html = renderToStaticMarkup(
      <NewProjectDialog
        templates={templateCatalog()}
        existingNames={[]}
        onClose={() => undefined}
        onPickDirectory={() => Promise.resolve(null)}
        onCreate={async () => undefined}
      />,
    );
    audit(html);
  });

  it("项目设置 Dialog", () => {
    const html = renderToStaticMarkup(
      <ProjectSettingsDialog
        project={PROJECT}
        onClose={() => undefined}
        onSave={async () => undefined}
        onPickDirectory={() => Promise.resolve(null)}
      />,
    );
    audit(html);
  });

  it("添加项目菜单（收拢态：触发钮）", () => {
    const html = renderToStaticMarkup(
      <AddProjectMenu
        onPickDirectory={() => Promise.resolve(null)}
        onAddProject={async () => undefined}
        onOpenNewProjectDialog={() => undefined}
        onCloneProject={async () => undefined}
        activePaths={[PROJECT.path]}
      />,
    );
    audit(html);
  });
});
