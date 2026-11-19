import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PaneDock } from "../src/renderer/components/PaneDock";
import { AppRail } from "../src/renderer/components/AppRail";
import { WorkbenchSidebar } from "../src/renderer/panes/WorkbenchSidebar";
import { Sidebar } from "../src/renderer/components/Sidebar";
import type { ComponentProps } from "react";
import { keysOf } from "../src/renderer/shortcuts";
import { readAppSurface } from "./helpers/app-surface";
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
it("单栏行族承担新建与搜索（ADR 0019 1:1 换钉）：六行、键位同源、收起态快捷入口随轨消失", () => {
  // 2026-11-20 ADR 0019 P3 首刀（官方首屏真机对照 2026-11-19）：窄图标轨下架，
  // 收起态快捷入口（SidebarRail）随轨消失——收起即整列隐藏（TitleBar ⌘B 承担展开），
  // 新建/搜索由顶部行族承担，文件/终端窗格由工具栏「工具」菜单承担（WorkbenchTools）。
  const html = renderToStaticMarkup(
    <AppRail destination="chat" onOpen={noop} onNewTask={noop} onSettings={noop} />,
  );
  for (const label of ["新任务", "搜索", "定时任务", "技能", "记忆", "自定义"]) {
    expect(html).toContain(`>${label}</span>`);
  }
  // tooltip 键位与 SHORTCUTS 表同源：表里改键，行族跟着改。
  // 2026-11-16 抓到漂移：这里曾手抄「（⌘N）」，表改了不会跟，判卷只读 strings.ts 也看不见。
  expect(html).toContain(`title="新任务（${keysOf("new-session")}）"`);
  // 快捷入口不再有第二条路径：SidebarRail 文件已删、rail-context/sidebar-rail 的 DOM 与
  // CSS 都不许回潮（历史注释里出现名字不算回潮，钉类名与样式规则）。
  expect(existsSync(fileURLToPath(new URL("../src/renderer/components/SidebarRail.tsx", import.meta.url))), "SidebarRail 已删").toBe(false);
  expect(readAppSurface()).not.toContain('className="rail-context"');
  expect(readAppSurface()).not.toContain('className="sidebar-rail"');
  const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
  expect(styles).not.toContain(".rail-context");
  expect(styles).not.toContain(".sidebar-rail");
});

it("账户菜单固定在单栏底部：任意目的地/收起态都只有这一道门（ADR 0019 1:1 换钉）", () => {
  // 2026-11-03 业主：「设置和偏好挪到左边底下……底部图标是用户头像」。
  // 2026-11-20 ADR 0019 P3 首刀（官方首屏真机对照 2026-11-19）：窄轨下架后账户入口
  // 钉在**单栏底部**（官方轮廓：顶部行族 → 项目分组列表 → 底部账户）。收起 = 整列
  // CSS 隐藏（列保持挂载），入口随列退场、仍在文档里；专注模式整列卸载（官方一致：
  // 专注没有左栏），TitleBar ⌘B/专注切换承担回来。
  const CHAT_SIDEBAR = {
    projects: [],
    sessions: [],
    activeId: null,
    activeWorkspace: null,
    running: new Set<string>(),
    waitingIds: new Set<string>(),
    outcomes: new Map(),
  } as unknown as ComponentProps<typeof Sidebar>;
  const renderColumn = (destination: "chat" | "plugins", focus = false): string =>
    renderToStaticMarkup(
      <WorkbenchSidebar
        destination={destination}
        sidebarCollapsed={false}
        focusMode={focus}
        sidebarWidth={304}
        chatSidebar={CHAT_SIDEBAR}
        pageItems={[{ id: "all", label: "全部" }]}
        activeFilter="all"
        onFilter={noop}
        onOpenDestination={noop}
        onSettings={noop}
        onNewTask={noop}
        onStartResize={noop}
        onPersistWidth={noop}
        onKeyResize={noop}
      />,
    );
  for (const destination of ["chat", "plugins"] as const) {
    const html = renderColumn(destination);
    expect((html.match(/aria-label="设置、外观与用量"/g) ?? []).length, destination).toBe(1);
    expect(html, destination).toContain('class="app-rail-user"');
  }
  // 收起态列保持挂载（收/开有宽度过渡）：入口仍在文档里，只是不可见。
  const collapsed = renderToStaticMarkup(
    <WorkbenchSidebar
      destination="chat"
      sidebarCollapsed
      focusMode={false}
      sidebarWidth={304}
      chatSidebar={CHAT_SIDEBAR}
      pageItems={[]}
      activeFilter="all"
      onFilter={noop}
      onOpenDestination={noop}
      onSettings={noop}
      onNewTask={noop}
      onStartResize={noop}
      onPersistWidth={noop}
      onKeyResize={noop}
    />,
  );
  expect((collapsed.match(/aria-label="设置、外观与用量"/g) ?? []).length).toBe(1);
  // 专注模式整列卸载：入口不在场（列回来了入口就在，语义位不漂）。
  expect(renderColumn("chat", true)).not.toContain('aria-label="设置、外观与用量"');
  expect(readAppSurface()).not.toContain("footerMenuVisible");
  const sidebarHost = readFileSync(fileURLToPath(new URL("../src/renderer/panes/WorkbenchSidebar.tsx", import.meta.url)), "utf8");
  expect(sidebarHost).toContain("<AccountMenu {...(props.account ?? { onOpenSettings: props.onSettings })} />");
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
