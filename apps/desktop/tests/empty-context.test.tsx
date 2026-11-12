// 空屏下半区承接 · 判卷（2026-11-08 第 1048 页）
//
// 一手依据：issues.md #1「给下半屏一个轻量『最近工作 / 当前项目状态』承接，
// 保持 focus-first，不再堆卡片」；项目裁决「不放假数据」（#9 明写）。
// 本批把用户选的「空态承接」落成一条真实最近会话行，并把三条纪律钉进机器判卷。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyContext } from "../src/renderer/components/EmptyContext";
import { pickRecentSessions } from "../src/renderer/derived/recent-sessions";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const view = readFileSync(fileURLToPath(new URL("../src/renderer/panes/WorkbenchView.tsx", import.meta.url)), "utf8");
const strings = readFileSync(fileURLToPath(new URL("../src/renderer/strings.ts", import.meta.url)), "utf8");

const ITEMS = [
  { id: "s1", title: "修复输出闪烁", workspace: "/tmp/demo-ws" },
  { id: "s2", title: "整理设置分区", workspace: "/tmp/demo-ws" },
  { id: "s3", title: "思考体边缘渐隐", workspace: "/tmp/demo-ws" },
];

describe("EmptyContext：真实数据、无壳、不堆卡片", () => {
  it("有会话：一行 caption + N 条文本按钮，标题来自 props", () => {
    const html = renderToStaticMarkup(<EmptyContext items={ITEMS} label="最近会话" onOpen={() => {}} />);
    expect(html).toContain('class="empty-context"');
    expect(html).toContain('class="empty-context-label"');
    expect(html).toContain("最近会话");
    expect((html.match(/class="empty-context-item"/g) ?? []).length).toBe(3);
    for (const it of ITEMS) expect(html).toContain(it.title);
  });

  it("无会话：整块不渲染（不放假数据、不摆空壳）", () => {
    expect(renderToStaticMarkup(<EmptyContext items={[]} label="最近会话" onOpen={() => {}} />)).toBe("");
  });

  it("不堆卡片：无 card/gate 类名，按钮不带图标之外的装饰", () => {
    const html = renderToStaticMarkup(<EmptyContext items={ITEMS} label="最近会话" onOpen={() => {}} />);
    expect(html).not.toContain('class="card"');
    expect(html).not.toContain("card-head");
  });
});

describe("接线：数据来自 sessions，点击回到那段对话", () => {
  it("文案进 STR.empty，组件零裸中文", () => {
    expect(strings).toContain('recentSessions: "最近会话"');
    expect(view).toContain("STR.empty.recentSessions");
  });

  it("WorkbenchView 只调派生层纯函数，不在渲染层堆数据逻辑", () => {
    expect(view).toContain("const recentEmptySessions = showEmpty ? pickRecentSessions(sessions, activeWorkspace) : []");
    expect(view).toContain('from "../derived/recent-sessions"');
  });

  it("承接行坐在 .empty-tail 内，onOpen 走 openSession(id, ws)", () => {
    expect(view).toMatch(/<div className="empty-tail">\s*<EmptyContext/s);
    expect(view).toContain("onOpen={(id, ws) => { openSession(id, ws); }}");
    // 弹性空带里现在有可交互内容，旧的 aria-hidden 必须撤掉
    expect(view).not.toContain('className="empty-tail" aria-hidden="true"');
  });
});

describe("pickRecentSessions：只认真实会话（派生层纯函数）", () => {
  const base = { mtimeMs: 0, lines: 1, workspace: "/tmp/demo-ws" };
  const sessions = [
    { ...base, id: "a", title: "较早", mtimeMs: 10 },
    { ...base, id: "b", title: "最新", mtimeMs: 30 },
    { ...base, id: "c", title: "中间", mtimeMs: 20 },
    { ...base, id: "d", title: "第四", mtimeMs: 15 },
    { ...base, id: "e", title: "  ", mtimeMs: 40 },
    { ...base, id: "f", mtimeMs: 50 },
    { ...base, id: "g", title: "归档", mtimeMs: 60, archived: true },
    { ...base, id: "h", title: "别的项目", mtimeMs: 70, workspace: "/tmp/other" },
  ];
  it("按 mtime 降序取 3 条，过滤无标题 / 空白 / 归档 / 别的工作区", () => {
    expect(pickRecentSessions(sessions, "/tmp/demo-ws").map((s) => s.id)).toEqual(["b", "c", "d"]);
  });
  it("workspace=null 不按工作区过滤；空输入回空数组（不放假数据）", () => {
    expect(pickRecentSessions([], null)).toEqual([]);
    expect(pickRecentSessions(sessions, null).map((s) => s.id)).toEqual(["h", "b", "c"]);
  });
  it("纯函数：filter 后再 sort，不改调用方的数组顺序", () => {
    const before = sessions.map((s) => s.id);
    pickRecentSessions(sessions, "/tmp/demo-ws");
    expect(sessions.map((s) => s.id)).toEqual(before);
  });
});

describe("CSS：不动既有裁决，只让出留白带顶端", () => {
  it(".empty-tail 的 flex 2.5 仍在（居中枢位判卷不改钉）", () => {
    expect(css).toMatch(/\.empty-tail\s*\{[^}]*flex:\s*2\.5/);
  });

  it("承接行沿用 --col-max / --reading-pad-x 单源与 rise-in 家族", () => {
    const rule = css.match(/\.empty-context\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("max-width: var(--col-max)");
    expect(rule).toContain("padding: var(--space-md) var(--reading-pad-x) 0");
    expect(rule).toContain("animation: rise-in var(--t-rise-in-long) var(--t-stagger-chip) both");
  });

  it("文本按钮命中区 ≥24px（第 1045 页可见靶面硬判据）且有 focus-visible", () => {
    const rule = css.match(/\.empty-context-item\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("min-height: 24px");
    expect(css).toContain(".empty-context-item:focus-visible");
  });
});
