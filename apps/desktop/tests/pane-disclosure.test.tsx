import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PaneDock } from "../src/renderer/components/PaneDock";
import { AppRail } from "../src/renderer/components/AppRail";
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
it("收起侧栏仍可新建、搜索、打开文件和设置，且同一入口只出现一次", () => {
  // 2026-10-31 业主截图：收起态两栏各有一枚滑杆「设置」、标题栏与侧栏各有一枚「展开」。
  // 2026-11-03 起设置入口固定在全局轨底部的头像菜单：不再有第二枚滑杆。
  const html = renderToStaticMarkup(
    <>
      <AppRail destination="chat" onOpen={noop} account={{ onOpenSettings: noop }} />
      <SidebarRail onNewTask={noop} onSearch={noop} onFiles={noop} onTerminal={noop} />
    </>,
  );
  for (const label of ["新建任务", "搜索会话与命令", "打开文件窗格", "打开终端窗格", "设置、外观与用量"]) {
    expect(html).toContain(`aria-label="${label}"`);
  }
  expect((html.match(/aria-label="设置、外观与用量"/g) ?? []).length).toBe(1);
  expect(html).not.toContain('aria-label="展开侧栏"');
});

it("账户菜单固定在轨底部：任意目的地/收起/专注态都只有这一道门", () => {
  // 2026-11-03 业主：「设置和偏好挪到左边底下……底部图标是用户头像」。
  // 旧规则（页脚在场就撤掉轨上的设置）已作废：全局轨始终给唯一入口，侧栏不再有页脚。
  for (const destination of ["chat", "plugins", "memory", "automation"] as const) {
    const html = renderToStaticMarkup(<AppRail destination={destination} onOpen={noop} account={{ onOpenSettings: noop }} />);
    expect((html.match(/aria-label="设置、外观与用量"/g) ?? []).length, destination).toBe(1);
    expect(html).not.toContain('aria-label="设置"');
  }
  const src = readFileSync(fileURLToPath(new URL("../src/renderer/panes/WorkbenchSidebar.tsx", import.meta.url)), "utf8");
  expect(src).not.toContain("footerMenuVisible");
  expect(src).toContain("account={props.account ?? { onOpenSettings: props.onSettings }}");
});

it("关掉最后一个窗格：焦点回到工具栏入口，不掉到 document.body", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");
  const close = src.slice(src.indexOf("const closePane = (kind: PaneKind)"), src.indexOf("useEffect(() => {", src.indexOf("const closePane")));
  expect(close).toContain("const last = props.tabs.length === 1;");
  expect(close).toContain('document.querySelector<HTMLElement>(\'[data-workbench-changes="true"]\')');
  expect(close).toContain('document.querySelector<HTMLElement>(\'[aria-label="工作台工具"]\')');
  expect(close).toContain("opener?.focus();");
  expect(close).toContain("if (last)");
});

it("退出语义（2026-11-03 业主）：为窗格借出的右栏，关掉最后一个窗格就整栏收回", () => {
  // 看完代码改动 → 点退出，右栏应当整个关上，而不是落回检查器内容。
  // 判据钉 chrome.ts 的三条关窗路径（closePane / closeLastPane / togglePane 关闭分支）
  // 都接同一个收回答器；「右栏本来开着」时关窗格仍回检查器（借没借，分开算）。
  const src = readFileSync(fileURLToPath(new URL("../src/renderer/state/chrome.ts", import.meta.url)), "utf8");
  expect(src).toContain("const inspectorRevealedForPanes = useRef(false);");
  expect(src).toContain("const collapseInspectorIfForPanes = useCallback");
  // 借出登记两条路都要记：togglePane 开启分支 + openPane（顶栏「改动」/交付卡跳转走的是它）
  expect((src.match(/inspectorRevealedForPanes\.current = \(inspectorRef\.current\?\.isCollapsed\(\) \?\? false\) \|\| inspectorRevealedForPanes\.current;/g) ?? []).length).toBe(2);
  expect((src.match(/collapseInspectorIfForPanes\(\)/g) ?? []).length, "三条关窗路径都要接").toBeGreaterThanOrEqual(3);
  // 收回 = collapse + 落开合记忆（与手动关检查器同一出口，不另造一条关闭路径）
  const helper = src.slice(src.indexOf("const collapseInspectorIfForPanes = useCallback"), src.indexOf("const notePaneOpened"));
  expect(helper).toContain("inspectorRef.current?.collapse()");
  expect(helper).toContain('window.localStorage.setItem("cairn.inspector.open.v1", "0")');
});
