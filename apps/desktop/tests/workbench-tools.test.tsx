import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("菜单精简为两段六项（2026-11-04 业主「容纳的东西太多了」），内容包 Portal", () => {
    // SSR 渲染不出关闭态的 Radix 菜单体 ⇒ 内容面走源码锚（与 ⑤b 同款）。
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/WorkbenchTools.tsx", import.meta.url)), "utf8");
    // 显示缺陷修法：内容必须 Portal（工具栏 overflow:hidden 会把内联弹层裁成一条灰边）
    expect(src).toContain("<DropdownMenu.Portal>");
    // 窗格组只留三件常用工具；方案/任务/旁路走右栏「＋」与快捷键，不再在顶栏复述
    expect(src).toContain('const TOOL_PANES: readonly PaneKind[] = ["file", "terminal", "browser"];');
    for (const gone of ["WORKBENCH_PANES", '"plan"', '"tasks"', '"sidechat"']) {
      expect(src, `工具菜单不该再有这一项：${gone}`).not.toContain(gone);
    }
    // 视图组三项照旧（右侧面板/插件/专注）
    expect(src).toContain("显示右侧面板");
    expect(src).toContain("已加载插件");
    expect(src).toContain("进入专注模式");
  });
});
