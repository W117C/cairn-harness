import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchTools, type WorkbenchToolsProps } from "../src/renderer/components/WorkbenchTools";

const props: WorkbenchToolsProps = {
  hasSession: true, paneTabs: [], fileCount: 3, inspectorOpen: false,
  pluginSidebarOpen: false, focusMode: false,
  onOpenPane: () => undefined, onToggleInspector: () => undefined,
  onTogglePluginSidebar: () => undefined, onToggleFocusMode: () => undefined,
};

describe("工作台工具入口", () => {
  it("有会话时两个带文字的入口，数量明确指本会话文件", () => {
    const html = renderToStaticMarkup(<WorkbenchTools {...props} />);
    expect(html).toContain('aria-label="查看本会话改动（3 个文件）"');
    expect(html).toContain(">改动<");
    expect(html).toContain(">工具<");
    expect(html).toContain('aria-label="工作台工具"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("tb-quick");
  });

  it("零改动仍能打开审查空态，不留下禁用入口", () => {
    const html = renderToStaticMarkup(<WorkbenchTools {...props} fileCount={0} />);
    expect(html).toContain('aria-label="查看本会话改动（0 个文件）"');
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("tb-action-count");
  });

  it("首页只保留窗口级工具入口", () => {
    const html = renderToStaticMarkup(<WorkbenchTools {...props} hasSession={false} />);
    expect(html).toContain('aria-label="工作台工具"');
    expect(html).not.toContain("查看本会话改动");
    expect(html).not.toContain("tb-action-count");
  });
});
