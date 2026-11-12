// 首页工具栏品牌补位（2026-11-07 第 1041 页）。
// 判据钉行为，不钉源码字符串：侧栏 brandline 可见时中栏必须留空；侧栏缺席
// （收起 / 专注 / 目的地页）时中栏补一枚 —— 同屏恰好一处品牌标。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderAppToolbar } from "../src/renderer/panes/AppToolbar";

type ToolbarDeps = Parameters<typeof renderAppToolbar>[0];

const deps: ToolbarDeps = {
  settingsOpen: false,
  sidebarBrandVisible: true,
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

const centerHtml = (sidebarBrandVisible: boolean): string =>
  renderToStaticMarkup(<>{renderAppToolbar({ ...deps, sidebarBrandVisible }).toolbarCenter}</>);

describe("首页工具栏中栏的品牌补位", () => {
  it("侧栏 brandline 可见 ⇒ 中栏留空（同屏不出现第二枚品牌标）", () => {
    expect(centerHtml(true)).not.toContain("tb-brand");
  });

  it("侧栏缺席 ⇒ 中栏补一枚品牌标（仍只一处）", () => {
    const html = centerHtml(false);
    expect((html.match(/class="tb-brand"/g) ?? []).length).toBe(1);
    expect(html).toContain(">Cairn</span>");
  });
});
