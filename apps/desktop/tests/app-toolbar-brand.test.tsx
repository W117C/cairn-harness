// 首页工具栏品牌标（2026-11-07 第 1041 页；2026-11-20 ADR 0019 P3 首刀换钉）。
// 判据钉行为，不钉源码字符串：ADR 0019 1:1 单栏化（官方首屏真机对照 2026-11-19）把侧栏
// brandline 随头部行下架——品牌标只在标题栏，工作区无会话时中栏恒补一枚，同屏恰好一处。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderAppToolbar } from "../src/renderer/panes/AppToolbar";

type ToolbarDeps = Parameters<typeof renderAppToolbar>[0];

const deps: ToolbarDeps = {
  settingsOpen: false,
  activeId: null,
  activeWorkspace: null,
  activeProjectLabel: null,
  barRenaming: null,
  setBarRenaming: () => undefined,
  sessions: [],
  renameSessionById: async () => undefined,
  sessionTitle: "",
  goalTrace: null,
  dismissedGoals: new Map<string, number>(),
  goalAct: () => undefined,
  activeIdRef: { current: null },
  activeWorkspaceRef: { current: null },
  setDismissedGoals: () => undefined,
  outlineTurns: [],
  outlineOpen: false,
  setOutlineOpen: () => undefined,
  paneTabs: [],
  onOpenPane: () => undefined,
  inspectorOpen: false,
  onToggleInspector: () => undefined,
  fileCount: 0,
  pluginSidebarOpen: false,
  togglePluginSidebar: () => undefined,
  focusMode: false,
  toggleFocusMode: () => undefined,
};

describe("首页工具栏中栏的品牌标", () => {
  it("工作区无会话 ⇒ 中栏恒印一枚品牌标（侧栏不再有 brandline，同屏唯一）", () => {
    const html = renderToStaticMarkup(<>{renderAppToolbar(deps).toolbarCenter}</>);
    expect((html.match(/class="tb-brand"/g) ?? []).length).toBe(1);
    expect(html).toContain(">Cairn</span>");
  });

  it("会话内 ⇒ 中栏是会话名，不再印品牌", () => {
    const html = renderToStaticMarkup(
      <>{renderAppToolbar({ ...deps, activeId: "s1", activeWorkspace: "/w", activeProjectLabel: "W", sessionTitle: "修左栏" }).toolbarCenter}</>,
    );
    expect(html).not.toContain("tb-brand");
  });
});
