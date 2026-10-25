import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaneDock } from "../src/renderer/components/PaneDock";
import { SidebarRail } from "../src/renderer/components/SidebarRail";
const noop = () => undefined;
it("单窗格占满：两块常驻、只显示激活窗格，标签切换、＋开新窗格、关闭入口在标签对应的块头上", () => {
  const html = renderToStaticMarkup(<PaneDock tabs={["changes", "plan"]} events={[]} onClose={noop} onOpen={noop} />);
  expect(html).toContain('aria-label="面板导航"');
  // 两个标签都在导航条上；激活的是最新打开的 plan（新开即露出）
  expect(html).toContain('aria-label="切换到变更窗格"');
  expect(html).toContain('aria-label="切换到方案窗格"');
  expect(html).toContain('aria-label="面板导航"');
  expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  // 两块都挂载（切标签不卸载：终端/浏览器/文件树状态保留），只有 plan 是 active；
  // 堆叠网格与「恢复多面板布局」已整体撤下（2026-10-24 业主）。
  expect(html).toContain('data-pane="plan"');
  expect(html).toContain('data-pane="changes"');
  expect((html.match(/data-active="true"/g) ?? []).length).toBe(1);
  expect(html).toMatch(/data-pane="plan" data-active="true"/);
  expect(html).toContain('aria-label="关闭方案窗格"');
  expect(html).not.toContain('aria-label="关闭变更窗格"');
  expect(html).not.toContain("pane-grid");
  expect(html).not.toContain("恢复多面板布局");
  expect(html).toContain('aria-label="添加面板"');
});
it("收起侧栏仍可新建、搜索、打开文件和设置", () => {
  const html = renderToStaticMarkup(<SidebarRail onExpand={noop} onNewTask={noop} onSearch={noop} onFiles={noop} onTerminal={noop} onSettings={noop} />);
  for (const label of ["展开侧栏", "新建任务", "搜索会话与命令", "打开文件窗格", "打开终端窗格", "打开设置"]) {
    expect(html).toContain(`aria-label="${label}"`);
  }
});
