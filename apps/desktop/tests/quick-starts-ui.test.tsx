// P2-1 空屏判卷：① QuickStarts SSR（建议行在场、顺序、副标题条件）；② App 源文哨兵
//（hero 三件 / data-empty 居中枢位 / FLIP 下沉 / 注入不发送 / 旧文案清退）。
// 本仓无 jsdom：渲染面（SSR）+ 源文哨兵 双钉，行为面靠真机 CDP（阶段链）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuickStarts } from "../src/renderer/components/QuickStarts";
import { STR } from "../src/renderer/strings";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const appSrc = read("../src/renderer/App.tsx");
const css = read("../src/renderer/styles.css");

describe("QuickStarts（空屏建议行 SSR）", () => {
  it("建议在场、按序、都是 pill 钮", () => {
    const items = ["继续上次：修登录页", "帮我看看这 3 个没提交的改动", "跑一遍测试，把失败修到绿"];
    const h = renderToStaticMarkup(<QuickStarts items={items} firstRunSub={null} onPick={() => undefined} />);
    expect(h).toContain('class="empty-below"');
    const pills = [...h.matchAll(/<button class="pill">([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(pills).toEqual(items);
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

  it("项目 chip 弹层：搜索 + 最近清单 + 复用 AddProjectMenu + 空态提示", () => {
    expect(appSrc).toContain("chip-search");
    expect(appSrc).toContain("STR.empty.searchProjects");
    expect(appSrc).toContain("listProjects({ includeRemoved: true, recentFirst: true })");
    expect(appSrc).toContain("<AddProjectMenu");
    expect(appSrc).toContain("STR.empty.dropHint");
    // 未注册的最近项点击 = 重加；注册项 = 切过去。
    expect(appSrc).toContain("handleAddProject(p.path)");
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
    expect(appSrc).toContain("prefers-reduced-motion: reduce");
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
    expect(appSrc).toMatch(/<Popover open=\{chipOpen\} up className="chip-pop"/);
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
    expect(css).toMatch(/\.empty h1\.empty-greet\s*{[^}]*font-size:\s*2\.25rem/s);
    expect(css).toMatch(/\.empty-greet-mark\s*{[^}]*color:\s*hsl\(var\(--accent-brand\)\)/s);
    expect(appSrc).toContain('className="empty-greet-mark"');
  });
});
