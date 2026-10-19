// P3-2 检查器判卷（计划稿 Task P3-2）：判卷先红——本文件先于实现落盘。
//   ③ changedFilesOf：跨轮聚合去重（同文件取最新快照/轮次）+ 首现序。
//   ④ Inspector SSR：三 Tab（无数据 Tab 隐藏）/ 默认选第一个可用 / 撤销钮（有快照才显示）/
//     ＋菜单接七窗格 / 全空引导文案 / initialTab 判卷面。
//   ⑤ App 接线哨兵：右 Panel collapsible 默认收起 + ⌘⌥B 开合 + timeline 跳转锚 + snapshotRestore 接线。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { changedFilesOf } from "../src/renderer/components/panes";
import { Inspector } from "../src/renderer/components/Inspector";

const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

// 夹具：b.ts 新建（快照 s1）＋ c.ts 新建（无快照）；a.ts 两轮修改（快照 s2 → s3）；一轮 plan。
const events = [
  { type: "user_message", content: "改文件", ts: 1000 },
  { type: "plan_proposed", callId: "p1", plan: { goal: "把 a 改顺", files: [{ action: "edit", path: "a.ts", summary: "保持行为" }] }, ts: 1050 },
  { type: "tool_call", id: "t1", name: "write_file", args: { path: "b.ts" }, ts: 1100 },
  { type: "tool_result", callId: "t1", ok: true, change: "created", snapshotId: "s1", ts: 1200 },
  { type: "tool_call", id: "t2", name: "write_file", args: { path: "c.ts" }, ts: 1250 },
  { type: "tool_result", callId: "t2", ok: true, change: "created", ts: 1260 },
  { type: "tool_call", id: "t3", name: "edit_file", args: { path: "a.ts" }, ts: 1300 },
  { type: "tool_result", callId: "t3", ok: true, change: "modified", snapshotId: "s2", ts: 1400 },
  { type: "user_message", content: "再改", ts: 1450 },
  { type: "tool_call", id: "t4", name: "edit_file", args: { path: "a.ts" }, ts: 1500 },
  { type: "tool_result", callId: "t4", ok: true, change: "modified", snapshotId: "s3", ts: 1600 },
] as unknown as AgentEvent[];

describe("③ changedFilesOf（改动 Tab 数据面）", () => {
  it("跨轮去重：同文件取最新快照与轮次；首现序", () => {
    expect(changedFilesOf(events)).toEqual([
      { path: "b.ts", change: "created", snapshotId: "s1", round: 1 },
      { path: "c.ts", change: "created", round: 1 },
      { path: "a.ts", change: "modified", snapshotId: "s3", round: 2 },
    ]);
  });

  it("无写工具改动 → 空表（空态由 Inspector 引导，不摆假行）", () => {
    expect(changedFilesOf([{ type: "user_message", content: "聊聊", ts: 1 }] as unknown as AgentEvent[])).toEqual([]);
  });
});

describe("④ Inspector SSR", () => {
  it("数据齐 ⇒ 三 Tab 在场（改动默认选中）+ ＋菜单在场", () => {
    const html = renderToStaticMarkup(<Inspector events={events} onRestore={() => undefined} />);
    expect(html).toContain("改动");
    expect(html).toContain("计划");
    expect(html).toContain("时间线");
    expect(html).toContain('class="isp-tab active"');
    expect(html).toContain('aria-label="打开窗格"');
    // 默认改动 Tab 内容：三行文件名在场；有快照的行有撤销钮、无快照（c.ts）没有
    expect(html).toContain("b.ts");
    expect(html).toContain("c.ts");
    expect(html).toContain("a.ts");
    expect(html.match(/aria-label="撤销此文件改动"/g)?.length).toBe(2);
  });

  it("无数据 Tab 隐藏：无方案时计划钮不在（改动/时间线照在场）", () => {
    const noPlan = events.filter((e) => (e as { type: string }).type !== "plan_proposed") as unknown as AgentEvent[];
    const html = renderToStaticMarkup(<Inspector events={noPlan} onRestore={() => undefined} />);
    expect(html).toContain("改动");
    expect(html).toContain("时间线");
    expect(html).not.toContain(">计划<");
  });

  it("无数据 Tab 隐藏：只剩时间线数据时，改动/计划钮都不在（不放空壳）", () => {
    const onlyTimeline = [{ type: "user_message", content: "聊聊", ts: 1 }] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(<Inspector events={onlyTimeline} onRestore={() => undefined} />);
    expect(html).toContain("时间线");
    expect(html).not.toContain(">改动<");
    expect(html).not.toContain(">计划<");
  });

  it("全空会话 ⇒ 无 Tab + 引导文案 + ＋菜单仍在", () => {
    const html = renderToStaticMarkup(<Inspector events={[]} onRestore={() => undefined} />);
    expect((html.match(/class="isp-tab[ "]/g) ?? []).length).toBe(0);
    expect(html).toContain("还没有可检查的内容");
    expect(html).toContain('aria-label="打开窗格"');
  });

  it("initialTab 判卷面：直开计划 / 时间线内容（goal 文本 / kind 词在场）", () => {
    const plan = renderToStaticMarkup(<Inspector events={events} initialTab="plan" />);
    expect(plan).toContain("把 a 改顺");
    const tl = renderToStaticMarkup(<Inspector events={events} initialTab="timeline" />);
    expect(tl).toContain('tl-kind user">你');
  });
});

describe("⑤ App 接线哨兵（右 Panel / ⌘⌥B / 跳转锚 / 快照撤销）", () => {
  it("右 Panel 换检查器：collapsible + collapsedSize 0 + 360/320/420 + 初始收起", () => {
    expect(appSrc).toContain("panelRef={inspectorRef}");
    expect(appSrc).toContain("collapsible");
    expect(appSrc).toContain("collapsedSize={0}");
    // 2026-10-18：宽度可持久化，默认值来自 inspectorDefault（读到 320–420 则用它，否则 360）。
    expect(appSrc).toContain("defaultSize={inspectorDefault}");
    expect(appSrc).toContain("minSize={320}");
    expect(appSrc).toContain("maxSize={420}");
    expect(appSrc).toContain("inspectorRef.current?.collapse()");
    expect(appSrc).toContain("<Inspector");
  });

  it("⌘⌥B 开合（toggleInspector）+ 打开窗格时自动展开", () => {
    expect(appSrc).toContain("const toggleInspector = useCallback");
    expect(appSrc).toContain("h.toggleInspector()");
    expect(appSrc).toContain("revealInspector()");
  });

  it("检查器收起时整列 inert：屏外控件不进入 Tab 与无障碍树", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(appSrc).toContain("const [inspectorCollapsed, setInspectorCollapsed] = useState(true)");
    expect(appSrc).toContain("setInspectorCollapsed(panelSize.inPixels <= 0)");
    // 2026-10-18 从 hidden 改为 inert：hidden={…} → display:none 会把 react-resizable-panels
    // 正在做的宽度收起动画一刀砍掉（⌘⌥B 开合退化成硬切）。inert 同样把内部控件移出
    // Tab 序与无障碍树，但保留布局、过渡照常播完。诉求不变（屏外不劫持键盘/不被读屏念到），
    // 实现换成不打断动画的那一个。
    expect(appSrc).toContain("<div className=\"inspector-col\" ref={inspectorColRef}>");
    expect(appSrc).toContain('el.setAttribute("inert", "")');
    expect(appSrc).toContain('el.removeAttribute("inert")');
    // 反向：不许回退到 hidden（那正是硬切的根因）
    expect(appSrc).not.toContain('className="inspector-col" hidden');
    expect(css).not.toContain(".inspector-col[hidden] { display: none; }");
  });

  it("窄窗开检查器先让侧栏避让；侧栏收起后主区铺满整行", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(appSrc).toContain("const INSPECTOR_SIDEBAR_COLLAPSE_BELOW = 744");
    expect(appSrc).toContain("mainGroupRef.current.getBoundingClientRect().width");
    expect(appSrc).toContain("setSidebarCollapsed(true)");
    expect((appSrc.match(/window\.requestAnimationFrame\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(appSrc).toContain("window.requestAnimationFrame(() => { inspectorRef.current?.expand(); })");
    expect(appSrc).toContain("sidebarAutoCollapsedRef.current = true");
    expect(appSrc).toContain("setSidebarCollapsed(false)");
    expect(appSrc).toContain("onToggleSidebar={toggleSidebar}");
    // 2026-10-18：收起不再改 grid / display:none（瞬切），改成宽度过渡 + 延迟 visibility；
    // 主区由 auto 列随宽度收回，仍是同一个“让出空间”的结果。
    expect(css).toContain('.app[data-sidebar="collapsed"] .side-wrap {');
    expect(css).toContain('width: 0 !important;');
    expect(css).toMatch(/\.app\[data-sidebar="collapsed"\] \.side-wrap\s*{[^}]*visibility: hidden/s);
    expect(css).toMatch(/\.app\[data-sidebar="collapsed"\] \.side-wrap\s*{[^}]*transition: width var\(--t-fast\)/s);
  });

  it("检查器分隔条是 Tab 可达的 separator，必须有可访问名称", () => {
    expect(appSrc).toContain('<Separator className="pane-handle" aria-label="调整检查器宽度" />');
  });

  it("timeline 跳转锚（data-event-id → scrollIntoView）与快照撤销接线", () => {
    expect(appSrc).toContain("const jumpToEvent = useCallback");
    expect(appSrc).toContain('querySelector(`[data-event-id="${String(eventId)}"]`)');
    expect(appSrc).toContain("window.agent.snapshotRestore({ path, snapshotId })");
  });
});
