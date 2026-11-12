import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../src/renderer/components/Sidebar";

const noop = () => undefined;
function html(overrides: Partial<ComponentProps<typeof Sidebar>>) {
  return renderToStaticMarkup(<Sidebar
    projects={[]} sessions={[]} activeId={null} activeWorkspace={null}
    running={new Set()} waitingIds={new Set()} outcomes={new Map()}
    onOpen={noop} onNewTask={noop} onOpenPalette={noop}
    onSwitchWorkspace={noop} onAddProject={async () => undefined} onCloneProject={async () => undefined}
    onOpenNewProjectDialog={noop} onUpdateProject={async () => undefined} onRelocateProject={async () => undefined}
    onRemoveProject={async () => undefined} onRevealProject={noop}
    onPickDirectory={async () => null} {...overrides}
  />);
}

describe("侧栏会话列表恢复", () => {
  it("后台刷新失败仍呈现已有会话，并说明这是更新失败", () => {
    const rendered = html({ sessions: [{ id: "saved", title: "保留的会话", mtimeMs: 1, lines: 1, workspace: "/tmp/ws" }], loadError: true });
    expect(rendered).toContain("保留的会话");
    expect(rendered).toContain("更新失败，仍显示上次列表");
    expect(rendered).not.toContain("还没有任务");
  });
  it("错误原因可按需展开，原文转义且保留完整路径", () => {
    const rendered = html({ loadError: true, loadErrorDetail: "EACCES /tmp/<project>/sessions", onRetryLoad: noop });
    expect(rendered).toContain("<summary");
    expect(rendered).toContain("查看原因");
    expect(rendered).toContain("EACCES /tmp/&lt;project&gt;/sessions");
    expect(rendered).not.toContain("<project>");
  });
  it("重试中标为忙碌，防重复点击，不拿骨架盖住缓存列表", () => {
    const rendered = html({ loadError: true, refreshing: true, onRetryLoad: noop });
    expect(rendered).toContain('aria-busy="true"');
    expect(rendered).toMatch(/<button[^>]*disabled=""[^>]*>读取中…<\/button>/);
    expect(rendered).not.toContain('class="side-skeleton"');
  });
});
