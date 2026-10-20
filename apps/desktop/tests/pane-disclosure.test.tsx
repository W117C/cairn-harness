import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaneDock } from "../src/renderer/components/PaneDock";
import { SidebarRail } from "../src/renderer/components/SidebarRail";
const noop = () => undefined;
it("多面板提供聚焦、恢复和添加入口，原布局与关闭入口保留", () => {
  const html = renderToStaticMarkup(<PaneDock tabs={["changes", "plan"]} events={[]} onClose={noop} onOpen={noop} />);
  expect(html).toContain('aria-label="面板导航"');
  expect(html).toContain('aria-label="聚焦变更窗格"');
  expect(html).toContain('aria-label="恢复多面板布局"');
  expect(html).toContain('aria-label="添加面板"');
  expect(html).toContain('aria-label="关闭变更窗格"');
  expect(html).toContain("pane-grid");
});
it("收起侧栏仍可新建、搜索、打开文件和设置", () => {
  const html = renderToStaticMarkup(<SidebarRail onExpand={noop} onNewTask={noop} onSearch={noop} onFiles={noop} onTerminal={noop} onSettings={noop} />);
  for (const label of ["展开侧栏", "新建任务", "搜索会话与命令", "打开文件窗格", "打开终端窗格", "打开设置"]) {
    expect(html).toContain(`aria-label="${label}"`);
  }
});
