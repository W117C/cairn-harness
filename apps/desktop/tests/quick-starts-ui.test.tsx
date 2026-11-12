// P2-1 空屏判卷：① QuickStarts SSR（建议行在场、顺序、副标题条件）；② App 源文哨兵
//（hero 三件 / data-empty 居中枢位 / FLIP 下沉 / 注入不发送 / 旧文案清退）。
// 本仓无 jsdom：渲染面（SSR）+ 源文哨兵 双钉，行为面靠真机 CDP（阶段链）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuickStarts } from "../src/renderer/components/QuickStarts";
import { STR } from "../src/renderer/strings";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const appSrc = readAppSurface();
const css = read("../src/renderer/styles.css");

describe("QuickStarts（空屏建议行 SSR）", () => {
  it("建议在场、按序、保持无编号行", () => {
    const items = ["继续上次：修登录页", "帮我看看这 3 个没提交的改动", "跑一遍测试，把失败修到绿"];
    const h = renderToStaticMarkup(<QuickStarts items={items} firstRunSub={null} onPick={() => undefined} />);
    expect(h).toContain('class="empty-below"');
    expect((h.match(/class="start"/g) ?? []).length).toBe(3);
    const qs = [...h.matchAll(/class="start-q">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(qs).toEqual(items);
    expect(h).not.toContain('class="start-n"');
    expect(h).not.toMatch(/>0[1-9]</);
    expect(h).not.toContain('class="pill"');
  });

  it("快捷动作是行列表（无通栏分隔线，2026-11-01 业主裁决）：图标是扫描锚点，整行热区，hover 才露箭头", () => {
    const h = renderToStaticMarkup(<QuickStarts items={["理解项目", "运行项目", "制定计划"]} firstRunSub={null} onPick={() => undefined} />);
    expect((h.match(/class="start-icon"/g) ?? []).length).toBe(3);
    // 2026-10-28 第 735 页：建议是**一条阅读序列**，不是三张等权卡片；2 列网格会留出第四格空洞。
    expect(css).toMatch(/\.starts\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.starts\s*{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.start\s*{[^}]*grid-template-columns:\s*22px minmax\(0, 1fr\) 16px/s);
    // 2026-11-01：通栏 hairline 分隔撤下（横线跨满列宽像表格）；悬停底纹给圆角。
    expect(css).not.toMatch(/\.starts\s*{[^}]*border-top/s);
    expect(css).not.toMatch(/\.start\s*{[^}]*border-bottom/s);
    expect(css).toMatch(/\.start\s*{[^}]*border-radius:\s*var\(--radius-sm\)/s);
    expect(css).toContain(".start:hover .start-go");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("@keyframes rise-in");
    // 2026-11-07 第 1041 页：窄窗气沟改由 .main 的 --reading-pad-x 一处驱动（不在起手行单写 16px）。
    expect(css).toContain(".empty-below { padding-left: var(--reading-pad-x); padding-right: var(--reading-pad-x); }");
    expect(css).toContain(".main { --reading-pad-x: 16px; }");
    expect(css).toMatch(/\.empty h1\.empty-greet\s*{[^}]*animation:\s*rise-in/s);
    expect(css).not.toContain(".pill {");
  });

  it("副标题条件：null 不渲染；给了就渲染（仅首启由 App 传）", () => {
    const none = renderToStaticMarkup(<QuickStarts items={["a"]} firstRunSub={null} onPick={() => undefined} />);
    expect(none).not.toContain("empty-sub");
    const withSub = renderToStaticMarkup(<QuickStarts items={["a"]} firstRunSub={STR.empty.firstRunSub} onPick={() => undefined} />);
    expect(withSub).toContain('class="empty-sub"');
    expect(withSub).toContain(STR.empty.firstRunSub);
  });
});

describe("空屏（App 源文哨兵 · P2-1）", () => {
  it("hero：珊瑚星标 + 按时段问候同一行 + 项目 chip（含分支位）", () => {
    expect(appSrc).toContain('className="empty-greet"');
    expect(appSrc).toContain('className="empty-greet-mark"');
    expect(appSrc).not.toContain("empty-brand");
    expect(appSrc).toContain("greetingFor(new Date().getHours())");
    expect(appSrc).toContain("STR.empty.greetingAsk");
    expect(appSrc).toContain("empty-chip");
    expect(appSrc).toContain("GitBranch");
  });

  it("工作区上下文只出现一处（会话内住工具栏左翼；输入区不再有 ctx-chip）", () => {
    // 2026-10-21 设计重做：原先会话内 composer 上方有一枚 `cairn-... 本地` chip，
    // 与侧栏/项目名重复；现在工作区标记收进唯一一条工具栏的左翼，输入区只剩写作面。
    expect(appSrc).not.toContain("workspaceLabel={");
    expect(appSrc).not.toContain('className="ctx-chip"');
    expect(appSrc).toContain('className="tb-workspace"');
    expect(appSrc).toContain('className="empty-chip"');
  });

  it("会话名只出现在工具栏中栏一处（会话条已并入顶栏，不重复两处）", () => {
    // 2026-10-20 批 129：会话条并入统一工具栏 ⇒ 会话名落在 .tb-title（工具栏中栏）。
    // 2026-11-07 第 1041 页：首页中栏的品牌标改为**侧栏缺席时的补位**——侧栏展开时
    // brandline 已是同屏唯一品牌标，中栏再放一枚就是同屏同词（业主「让布局说话」）。
    // 不变量仍是「会话名只此一处」＋「旧的第二条栏不存在」，另加品牌补位条件单源。
    expect(appSrc).toContain('className="tb-title"');
    expect((appSrc.match(/className="tb-title"/g) ?? []).length).toBe(1);
    expect(appSrc).toContain('sidebarBrandVisible ? null : <span className="tb-brand">');
    // 判据只在 WorkbenchView 里写一次：侧栏 side-wrap 与工具栏品牌补位同读 chatSidebarVisible。
    expect(appSrc).toContain('const chatSidebarVisible = destination === "chat" && !sidebarCollapsed && !focusMode;');
    expect(appSrc).toContain("sidebarBrandVisible: chatSidebarVisible");
    expect(appSrc).toContain('className="side-brand"');
    expect(appSrc).not.toContain('className="chat-bar"');
    expect(appSrc).not.toContain('title={activeId !== null ? sessionTitle : "Cairn"}');
  });

  it("项目 chip 弹层：搜索 + 最近清单 + 复用 AddProjectMenu + 空态提示", () => {
    expect(appSrc).toContain("chip-search");
    expect(appSrc).toContain("STR.empty.searchProjects");
    expect(appSrc).toContain("listProjects({ includeRemoved: true, recentFirst: true })");
    expect(appSrc).toContain("<AddProjectMenu");
    expect(appSrc).toContain("STR.empty.dropHint");
    // 未注册的最近项点击 = 重加；注册项 = 切过去。
    expect(appSrc).toContain("handleAddProject(p.path)");
    // 最近项目的 name 可能是空串/undefined：不能渲染成一行空白，回落路径 basename。
    expect(appSrc).toContain('p.name || p.path.slice(p.path.lastIndexOf("/") + 1)');
    expect(appSrc).toContain('className="mi-check"');
    // 项目弹层也走同一套菜单键盘：↑↓ / Home / End 在输入框与项目行之间移动焦点。
    expect(appSrc).toContain("menuNavIndex(e.key, current, items.length)");
    expect(appSrc).toContain(".chip-list .menu-item:not(:disabled)");
    expect(appSrc).toContain('current < 0 && e.key !== "ArrowDown"');
  });

  it("居中枢位：main 挂 data-empty；hero 底对齐 + .empty-tail 弹性空带（flex 2.5）", () => {
    expect(appSrc).toContain('data-empty={showEmpty ? "true" : "false"}');
    expect(appSrc).toContain("empty-tail");
    expect(css).toContain('.main[data-empty="true"] .empty');
    expect(css).toContain(".empty-tail");
    expect(css).toMatch(/\.empty-tail\s*\{[^}]*flex:\s*2\.5/);
  });

  it("下沉动画：FLIP（animate + 200ms + reduced-motion 直落）", () => {
    expect(appSrc).toContain("composerZoneRef");
    expect(appSrc).toContain("prevEmptyRect");
    expect(appSrc).toContain("if (appMotionReduced()) return;");
    expect(appSrc).toContain("duration: 200");
    expect(appSrc).toContain("el.animate(");
  });

  it("建议点击=填入不发送：onPick 注入 injectedText，不是 send", () => {
    // 2026-10-19：走 injectText（带 seq），同一段建议连点两次也能重新填入。
    expect(appSrc).toContain("onPick={(t) => { injectText(t); }}");
    const at = appSrc.indexOf("onPick={(t) =>");
    expect(at).toBeGreaterThan(-1);
    expect(appSrc.slice(at, at + 120)).not.toContain("send(");
  });

  it("建议装配：并发三查 + 按项目路径缓存 + 失败项按 null", () => {
    expect(appSrc).toContain("gitStatus(ws)");
    expect(appSrc).toContain('workspaceListDir("")');
    expect(appSrc).toContain('workspaceReadText("package.json")');
    expect(appSrc).toContain("emptyCache.current.set(ws, surface)");
    expect(appSrc).toContain("sessionsLoaded");
  });

  it("旧文案清退：「⌘N 任何时候回到这个页面」与写死 pill 不再出现", () => {
    expect(appSrc).not.toContain("⌘N 任何时候回到这个页面");
    expect(appSrc).not.toContain("给 src/main/settings.ts 补上缺失的判卷");
    expect(appSrc).not.toContain("今天要修点什么");
  });
});

// 2026-10-17 真机目验：项目选择弹层原向下开，正好盖住 composer（选项目时看不见自己要发的字）。
describe("项目选择弹层方向", () => {
  it("chip 弹层向上开", () => {
    expect(appSrc).toMatch(/<Popover\s+open=\{chipOpen\}\s+up\s+className="chip-pop"/);
  });

  // 2026-10-24 业主截图：上开弹层压到 hero 问候线（10-18 大字 hero 正好悬在弹层路径上）。
  // 焦点礼让：弹层向上盖到问候线时才淡出（向下开时不淡，2026-10-24 第二版）。
  it("弹层向上盖到问候线时才淡出（data-picking → 子元素 opacity）", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(appSrc).toContain('{...(chipOpen ? { "data-picking": "true" } : {})}');
    expect(css).toMatch(/\.empty\[data-picking\]:has\(\.chip-pop\.up\.show:not\(\.down\)\) \.empty-greet > \* \{ opacity: \.15; \}/);
    // 淡出必须打在子元素上：h1 自身被 rise-in(fill both) 锁 opacity，动画级联压过普通声明。
    expect(css).not.toMatch(/\.empty\[data-picking\] \.empty-greet \{/);
  });
});


// 2026-10-17：空屏项目 chip 与侧栏命名一致——已登记项目显示显示名，未登记才回落文件夹名。
describe("项目 chip 命名一致性", () => {
  it("优先项目显示名（projects.find → name），再回落 basename", () => {
    expect(appSrc).toContain("projects.find((p) => p.path === activeWorkspace)?.name");
    expect(appSrc).toContain('activeWorkspace.slice(activeWorkspace.lastIndexOf("/") + 1)');
  });
});


// 2026-10-17 设计复盘：空屏「小字标 + 大问候」的层级（旧字标 22px 比问候语还大）。
describe("空屏字级层级", () => {
  it("衬线大字 + 珊瑚星标（对照 Claude 桌面端 hero）", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.empty h1\.empty-greet\s*{[^}]*font-family:[^}]*Songti SC/s);
    // 第 870 页（业主「让布局说话」）：问候不再用 vw 流体大字（真机 1440 实测 44.2px，
    // 而输入框正文 14px ⇒ 屏幕上最大的一块字既不能点也不能输入）。现在走标题档上界 22px。
    expect(css).toMatch(/\.empty h1\.empty-greet\s*{[^}]*font-size:\s*var\(--fs-title-lg\)/s);
    expect(css).not.toMatch(/\.empty h1\.empty-greet\s*{[^}]*font-size:\s*clamp/s);
    expect(css).toMatch(/\.empty-greet-mark\s*{[^}]*color:\s*hsl\(var\(--accent-brand\)\)/s);
    expect(appSrc).toContain('className="empty-greet-mark"');
  });

  it("620px 以下星标对齐首行，中文问候均衡换行而不是留下短尾", () => {
    const narrow = css.match(/@media \(max-width: 620px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(narrow).toMatch(/\.empty h1\.empty-greet\s*{[^}]*align-items:\s*flex-start/s);
    // 窄窗不再反向上调字号（原来 clamp(1.75rem,7vw,2rem) 比基准还大一档）。
    expect(narrow).not.toMatch(/\.empty h1\.empty-greet\s*{[^}]*font-size/s);
    expect(narrow).toMatch(/\.empty-greet-mark\s*{[^}]*margin-top:\s*0\.22em/s);
    expect(narrow).toMatch(/\.empty-greet > span\s*{[^}]*text-wrap:\s*balance/s);
    expect(narrow).toMatch(/\.empty-greet-period\s*{[^}]*white-space:\s*nowrap/s);
    expect(appSrc).toContain('className="empty-greet-period"');
  });
});
