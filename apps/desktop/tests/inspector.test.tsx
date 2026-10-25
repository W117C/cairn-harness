// P3-2 检查器判卷（计划稿 Task P3-2）：判卷先红——本文件先于实现落盘。
//   ③ changedFilesOf：跨轮聚合去重（同文件取最新快照/轮次）+ 首现序。
//   ④ Inspector SSR：三 Tab（无数据 Tab 隐藏）/ 默认选第一个可用 / 撤销钮（有快照才显示）/
//     ＋菜单接七窗格 / 全空引导文案 / initialTab 判卷面。
//   ⑤ App 接线哨兵：右 Panel collapsible 默认收起 + ⌘⌥I 开合 + timeline 跳转锚 + snapshotRestore 接线。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { changedFilesOf } from "../src/renderer/components/panes";
import { Inspector } from "../src/renderer/components/Inspector";
import { readAppSurface } from "./helpers/app-surface";

const appSrc = readAppSurface();

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
  it("数据齐 ⇒ 概览 + 三 Tab（概览默认选中）+ ＋菜单在场；改动页按 initialTab 直开", () => {
    const html = renderToStaticMarkup(<Inspector
      events={events}
      onRestore={() => undefined}
      sessionTitle="改 a.ts"
      workspacePath="/w/proj"
      modelLabel="演示"
      modeLabel="默认"
      running
    />);
    for (const label of ["概览", "改动", "计划", "时间线"]) expect(html).toContain(label);
    expect(html).toMatch(/class="isp-tab active"[^>]*>概览</);
    expect(html).toContain('aria-label="打开窗格"');
    // 概览 = 会话事实 + 六格；不抢改动页的文件列表
    expect(html).toContain("改 a.ts");
    expect(html).toContain("proj");
    expect(html).toContain("运行中");
    expect(html).toContain("文件改动");
    expect(html).not.toContain("b.ts");
    // 显式直开改动页：三行文件名在场；有快照的行有撤销钮、无快照（c.ts）没有
    const changesHtml = renderToStaticMarkup(<Inspector events={events} onRestore={() => undefined} initialTab="changes" />);
    expect(changesHtml).toContain("b.ts");
    expect(changesHtml).toContain("c.ts");
    expect(changesHtml).toContain("a.ts");
    expect(changesHtml.match(/aria-label="撤销此文件改动"/g)?.length).toBe(2);
  });

  it("无数据 Tab 隐藏：无方案时计划钮不在（概览/改动/时间线照在场）", () => {
    const noPlan = events.filter((e) => (e as { type: string }).type !== "plan_proposed") as unknown as AgentEvent[];
    const html = renderToStaticMarkup(<Inspector events={noPlan} onRestore={() => undefined} />);
    expect(html).toContain("概览");
    expect(html).toContain("改动");
    expect(html).toContain("时间线");
    expect(html).not.toContain(">计划<");
  });

  it("无数据 Tab 隐藏：只剩时间线数据时，改动/计划钮都不在（概览+时间线）", () => {
    const onlyTimeline = [{ type: "user_message", content: "聊聊", ts: 1 }] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(<Inspector events={onlyTimeline} onRestore={() => undefined} />);
    expect(html).toContain("概览");
    expect(html).toContain("时间线");
    expect(html).not.toContain(">改动<");
    expect(html).not.toContain(">计划<");
  });

  it("全空会话 ⇒ 只有概览 Tab + 诚实引导 + ＋菜单仍在（不再整栏空白）", () => {
    const html = renderToStaticMarkup(<Inspector events={[]} onRestore={() => undefined} />);
    expect(html).toContain("概览");
    expect((html.match(/class="isp-tab[ "]/g) ?? []).length).toBe(1);
    expect(html).toContain("还没有活动");
    expect(html).toContain('aria-label="打开窗格"');
  });

  it("initialTab 判卷面：直开计划 / 时间线内容（goal 文本 / kind 词在场）", () => {
    const plan = renderToStaticMarkup(<Inspector events={events} initialTab="plan" />);
    expect(plan).toContain("把 a 改顺");
    const tl = renderToStaticMarkup(<Inspector events={events} initialTab="timeline" />);
    expect(tl).toContain('tl-kind user">你');
  });
});

describe("⑤b 关闭钮（2026-10-20 真机：「右边侧栏打开就没有关闭」）", () => {
  it("给了 onClose 才摆 × 钮；没给不摆（判卷/嵌用面没有右 Panel 可关）", () => {
    const withClose = renderToStaticMarkup(<Inspector events={events} onClose={() => undefined} />);
    expect(withClose).toContain('aria-label="关闭检查器"');
    expect(withClose).toContain("关闭检查器（⌘⌥I）"); // 键位写在 title 里，鼠标用户也能学会
    expect(withClose).toContain("lucide-x");
    const withoutClose = renderToStaticMarkup(<Inspector events={events} />);
    expect(withoutClose).not.toContain('aria-label="关闭检查器"');
  });

  it("App 把 × 接到 toggleInspector（开合 + 跨重启记忆同一出口，不另造一条关闭路径）", () => {
    expect(appSrc).toContain("onClose={toggleInspector}");
  });

  it("宽屏首次进会话自动展开概览；用户表过态就不抢", () => {
    expect(appSrc).toContain("const INSPECTOR_AUTO_OPEN_MIN = 1400;");
    expect(appSrc).toContain("inspectorPrefSet");
    expect(appSrc).toContain("if (inspectorPrefSetRef.current) return;");
    expect(appSrc).toContain("window.innerWidth < INSPECTOR_AUTO_OPEN_MIN");
    expect(appSrc).toContain("inspectorRef.current?.isCollapsed() ?? true) revealInspector()");
  });
});

describe("⑤ App 接线哨兵（右 Panel / ⌘⌥I / 跳转锚 / 快照撤销）", () => {
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

  it("⌘⌥I 开合（toggleInspector）+ 打开窗格时自动展开", () => {
    expect(appSrc).toContain("const toggleInspector = useCallback");
    expect(appSrc).toContain("h.toggleInspector()");
    expect(appSrc).toContain("revealInspector()");
  });

  it("检查器收起时整列 inert：屏外控件不进入 Tab 与无障碍树", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(appSrc).toContain("const [inspectorCollapsed, setInspectorCollapsed] = useState(true)");
    expect(appSrc).toContain("setInspectorCollapsed(panelSize.inPixels <= 0)");
    // 2026-10-18 从 hidden 改为 inert：hidden={…} → display:none 会把 react-resizable-panels
    // 正在做的宽度收起动画一刀砍掉（⌘⌥I 开合退化成硬切）。inert 同样把内部控件移出
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
    // 2026-10-20：expand 改到侧栏 240ms 收起过渡之后（旧两个 rAF 会抢跑被夹回 0，真机
    // 窄窗 ⌘⌥I 第一次只写 storage 不展开）。判据跟着实现走，不保留旧针脚。
    expect(appSrc).toContain('const expandDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;');
    expect(appSrc).toContain("window.setTimeout(() => { inspectorRef.current?.expand(); setInspectorCollapsed(false); }, expandDelay);");
    expect(appSrc).not.toContain("window.requestAnimationFrame(() => { inspectorRef.current?.expand(); })");
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

  it("检查器开合状态与 imperative collapse 同步（inert 不靠 Panel onResize）", () => {
    // 2026-10-20 真机：带窗格重载后 Panel 实际宽 ~293，但 inspectorCollapsed 初值 true ⇒
    // inert 挂在可见面板上；开合状态必须与布局同一个事实源。
    expect(appSrc).toContain("setInspectorCollapsed(false);");
    expect(appSrc).toContain("setInspectorCollapsed(true);");
    const layoutStart = appSrc.indexOf("// 初始收起（brief 七「默认收起」）");
    expect(layoutStart).toBeGreaterThan(-1);
    const layout = appSrc.slice(layoutStart, layoutStart + 900);
    expect(layout).toContain("setInspectorCollapsed(false);");
    expect(layout).toContain("setInspectorCollapsed(true);");
    const toggle = appSrc.slice(appSrc.indexOf("const toggleInspector = useCallback"), appSrc.indexOf("const toggleFocusMode = useCallback"));
    expect(toggle).toContain("setInspectorCollapsed(true);");
  });

  it("减少动态偏好下不再白等 240/260ms", () => {
    expect(appSrc).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260');
    expect(appSrc).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240');
  });

  it("timeline 跳转锚（data-event-id → scrollIntoView）与快照撤销接线", () => {
    expect(appSrc).toContain("const jumpToEvent = useCallback");
    expect(appSrc).toContain('querySelector(`[data-event-id="${String(eventId)}"]`)');
    // 还原要带上 sessionId（2026-10-19）：主进程据此往**这个会话**的事件流落 file_restored，
    //  否则改动面（改动 Tab / 变更窗格 / Changes 徽标 / 交付卡的「改动已验证」）还当文件没撤。
    // 这一条比旧的"只认 `{ path, snapshotId }`"更严：少了 sessionId 就不许过。
    expect(appSrc).toContain("window.agent.snapshotRestore({");
    expect(appSrc).toContain("path, snapshotId,");
    expect(appSrc).toContain("...(sid !== null ? { sessionId: sid } : {}),");
    // 2026-10-20：主进程直接 append file_restored、不推给渲染层 ⇒ 还原成功后必须本地补一条，
    // 否则 Inspector 仍摆着撤销钮、徽标仍数着这个文件，直到切走再开（真机复现）。
    expect(appSrc).toContain('setEvents((prev) => [...prev, { type: "file_restored", path, snapshotId } as AgentEvent]);');
    expect(appSrc).toContain("if (sid !== null && activeIdRef.current === sid)");
  });
});

describe("检查器响应式 effect（评审修）", () => {
  it("冷启动/窗口 resize 才判；侧栏状态用 ref 读，不让 effect 随状态变化重跑", () => {
    expect(appSrc).toContain("const [inspectorPrefSet] = useState<boolean>");
    expect(appSrc).not.toContain("const inspectorPrefSet = useRef<boolean>((() =>");
    expect(appSrc).toContain("const sidebarCollapsedRef = useRef(sidebarCollapsed);");
    const i = appSrc.indexOf("const sidebarCollapsedRef = useRef(sidebarCollapsed);");
    const fn = appSrc.slice(i, i + 1200);
    expect(fn).toContain("if (sidebarCollapsedRef.current) return;");
    expect(fn).toContain("}, []);");
  });
});
