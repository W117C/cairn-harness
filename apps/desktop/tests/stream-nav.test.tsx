// 长对话导航判卷（v7.2）：轮折叠纯函数 + Stream 折叠渲染 + 对话目录面板 + 接线哨兵。
// 口径：摘要截断不编造；运行中的最后一轮不许折（不藏正在流的内容）；折叠行保留 data-round-anchor
// （目录跳转落点）；不给 onToggleFold 时折叠面全不渲染（旧判卷夹具口径不受扰）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { Stream, canFoldRound, foldAllButLast, truncateSummary, turnSummaries } from "../src/renderer/components/Stream";
import { OutlinePanel } from "../src/renderer/components/Outline";
import { projectStream } from "../src/renderer/projections";
import { SHORTCUT_GROUPS } from "../src/renderer/shortcuts";

const EVENTS = [
  { type: "user_message", content: "第一轮：把测试跑绿", ts: 1 },
  { type: "assistant_message", content: "好的，先看失败面。", ts: 2 },
  { type: "tool_call", name: "run_tests", args: { command: "pnpm test" }, id: "c1", ts: 3 },
  { type: "tool_result", callId: "c1", ok: true, ts: 4 },
  { type: "user_message", content: "第二轮：\n再补一个用例", ts: 5 },
  { type: "assistant_message", content: "补好了。", ts: 6 },
] as unknown as AgentEvent[];

describe("truncateSummary（目录/摘要行的单行摘要）", () => {
  it("空白（含换行）折叠为单空格；超长截断加省略号；≤上限原样", () => {
    expect(truncateSummary("第一行\n第二行   带空格")).toBe("第一行 第二行 带空格");
    const exact = "字".repeat(42);
    expect(truncateSummary(exact)).toBe(exact);
    expect(truncateSummary("字".repeat(43))).toBe("字".repeat(42) + "…");
  });
});

describe("目录与折叠的纯函数", () => {
  it("turnSummaries 只取用户轮：round 序 + 首句摘要", () => {
    const turns = turnSummaries(projectStream(EVENTS));
    expect(turns.map((t) => t.round)).toEqual([1, 2]);
    expect(turns[0]?.text).toBe("第一轮：把测试跑绿");
    expect(turns[1]?.text).toBe("第二轮： 再补一个用例");
  });

  it("foldAllButLast 保留最后一轮（正在读的那轮不折）", () => {
    expect([...foldAllButLast([1, 2, 3])]).toEqual([1, 2]);
    expect([...foldAllButLast([1])]).toEqual([]);
    expect([...foldAllButLast([])]).toEqual([]);
  });

  it("canFoldRound：运行中的最后一轮不可折；其余（含停转后的最后一轮）可折", () => {
    expect(canFoldRound(2, 2, true)).toBe(false);
    expect(canFoldRound(1, 2, true)).toBe(true);
    expect(canFoldRound(2, 2, false)).toBe(true);
    expect(canFoldRound(2, null, true)).toBe(true);
  });
});

describe("Stream 轮折叠（真 HTML）", () => {
  it("折叠轮整组收成一行摘要：正文/工具都藏了，锚点留下（目录落点）", () => {
    const html = renderToStaticMarkup(
      <Stream rows={projectStream(EVENTS)} foldedRounds={new Set([1])} actions={{ onToggleFold: () => undefined }} streaming={false} />,
    );
    expect(html).toContain("第 1 轮");
    expect(html).toContain('aria-label="展开第 1 轮（已折叠）"');
    expect((html.match(/data-round-anchor=/g) ?? []).length).toBe(2); // 第 1 轮摘要行 + 第 2 轮用户行
    expect(html).not.toContain("先看失败面"); // 第 1 轮回复藏了
    expect(html).not.toContain("run_tests"); // 第 1 轮工具行藏了
    expect(html).toContain("再补一个用例"); // 第 2 轮照常
    expect(html).toContain("补好了。");
  });

  it("展开态：折叠钮在用户行操作条里（eager 构建）；运行中最后一轮不出折叠钮", () => {
    const rows = projectStream(EVENTS);
    const idle = renderToStaticMarkup(<Stream rows={rows} actions={{ onCopyText: () => undefined, onToggleFold: () => undefined }} streaming={false} />);
    expect(idle).toContain('aria-label="折叠第 1 轮"');
    expect(idle).toContain('aria-label="折叠第 2 轮"');
    const live = renderToStaticMarkup(<Stream rows={rows} actions={{ onToggleFold: () => undefined }} />); // streaming 缺省 = 在跑
    expect(live).toContain('aria-label="折叠第 1 轮"');
    expect(live).not.toContain('aria-label="折叠第 2 轮"');
  });

  it("不给 onToggleFold ⇒ 用户行不出现折叠钮（旧夹具口径不受扰）", () => {
    const html = renderToStaticMarkup(<Stream rows={projectStream(EVENTS)} actions={{ onCopyText: () => undefined }} streaming={false} />);
    expect(html).not.toContain("折叠第");
  });

  it("flashRound 命中 ⇒ 该轮用户行带 flash（跳转落点反馈）", () => {
    const html = renderToStaticMarkup(<Stream rows={projectStream(EVENTS)} flashRound={1} streaming={false} />);
    expect((html.match(/class="row user flash"/g) ?? []).length).toBe(1); // 恰一处（第二轮不带）
  });
});

describe("对话左右分（业主 18.41.11 裁，照搬原型 v3-lite .u/.u-wrap；样式层哨兵）", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  it("user = 右对齐气泡：行 grid 收右 + 82% 封顶 / bg-300 暖灰底 / 无描边 / 圆角 14", () => {
    expect(css).toMatch(/\.row\.user\s*{[^}]*justify-items:\s*end/s);
    expect(css).toMatch(/\.row\.user \.t\s*{[^}]*max-width:\s*82%/s);
    // 2026-10-17「像 Claude」：白底 → bg-300 暖灰（#F0EEE6），白底在暖米白画布上无边界
    expect(css).toMatch(/\.row\.user \.t\s*{[^}]*background:\s*var\(--user-bubble-bg\)/s);
    expect(css).toMatch(/\.row\.user \.t\s*{[^}]*border-radius:\s*var\(--radius-composer\)/s);
    expect(css).not.toMatch(/\.row\.user \.t\s*{[^}]*border:\s*1px solid/s);
  });

  it("模型侧仍左对齐独立面（✦ 行不带 justify-items:end——左右才构成对照）", () => {
    expect(css).toMatch(/\.row\.assistant\s*{[^}]*grid-template-columns:\s*20px/s);
    expect(css).not.toMatch(/\.row\.assistant\s*{[^}]*justify-items:\s*end/s);
  });
});

describe("对话目录面板（真 HTML）", () => {
  const TURNS = [
    { round: 1, text: "把测试跑绿" },
    { round: 2, text: "再补一个用例" },
    { round: 3, text: "发布" },
  ];
  const render = (over: Partial<Parameters<typeof OutlinePanel>[0]> = {}): string =>
    renderToStaticMarkup(
      <OutlinePanel turns={TURNS} currentRound={2} anyFolded={false} onJump={() => undefined} onToggleAllFold={() => undefined} onClose={() => undefined} {...over} />,
    );

  it("列表齐、当前轮 aria-current 恰一处、动作钮与键盘提示都在", () => {
    const html = render();
    expect(html).toContain('aria-label="对话目录"');
    for (const t of ["第 1 轮", "第 2 轮", "第 3 轮", "把测试跑绿", "发布"]) expect(html).toContain(t);
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("折叠全部（保留最后一轮）");
    expect(html).toContain("↑↓ 选 · Enter 跳 · Esc 关");
    expect(html).toContain('aria-label="关闭目录"');
  });

  it("有折叠 ⇒ 动作钮翻面为「展开全部」", () => {
    const html = render({ anyFolded: true });
    expect(html).toContain("展开全部");
    expect(html).not.toContain("折叠全部（保留最后一轮）");
  });
});

describe("接线哨兵（源码级）", () => {
  const appSrc = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

  it("App 热键：⌘↑/⌘↓ 在 switch 里，且输入框聚焦时让给文本编辑（不劫持）", () => {
    expect(appSrc).toContain('case "ArrowUp"');
    expect(appSrc).toContain('case "ArrowDown"');
    expect(appSrc).toContain("isEditableTarget(e.target)");
    expect(appSrc).toContain("jumpTop");
    expect(appSrc).toContain("jumpBottom");
  });

  it("Esc 浮层链包含目录：先关目录、return（不动运行）", () => {
    expect(appSrc).toContain("if (h.outlineOpen) { e.preventDefault(); h.setOutlineOpen(false); return; }");
  });

  it("速查表补了 ⌘↑ / ⌘↓ 一行（只列已实现的键）", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.keys));
    expect(keys).toContain("⌘↑ / ⌘↓");
  });

  it("useStickyScroll 提供 scrollToTop（⌘↑ 的落点，走同一套贴底判定）", () => {
    const src = readFileSync(new URL("../src/renderer/useStickyScroll.ts", import.meta.url), "utf8");
    expect(src).toContain("scrollToTop");
    expect(src).toContain("NEAR_BOTTOM_PX");
  });
});

describe("第十九遍：输出完光标不陪跑尾部（usage 落定 × Stream 显隐）", () => {
  const ev = (p: Record<string, unknown>) => p as unknown as AgentEvent;
  it("流式中光标在（streaming 缺省=在跑）；usage 到达即灭——不再等会话收束", () => {
    const mid = projectStream([
      ev({ type: "user_message", content: "问" }),
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
    ]);
    const htmlMid = renderToStaticMarkup(<Stream rows={mid} actions={{ onCopyText: () => undefined }} />);
    expect((htmlMid.match(/class="cursor"/g) ?? []).length).toBe(1);

    // 真流形态（案卷 21:51:38）：末 delta 与 usage 同秒到达，之后还有尾部（记忆沉淀）——
    // 会话仍在跑（streaming=true），但光标必须已灭。
    const after = projectStream([
      ev({ type: "user_message", content: "问" }),
      ev({ type: "assistant_delta", callId: "c1", text: "你好" }),
      ev({ type: "usage", inputTokens: 10, outputTokens: 3 }),
    ]);
    const htmlAfter = renderToStaticMarkup(<Stream rows={after} actions={{ onCopyText: () => undefined }} />);
    expect(htmlAfter).not.toContain('class="cursor"');
    expect(htmlAfter).toContain("你好");
  });
});

// 2026-10-17：目录入口从流内浮片迁入会话条（真机目验：absolute 浮片压住第一条工具行）。
describe("对话目录入口落点（会话条，不再浮在流上）", () => {
  const app = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  it("入口按钮在 .chat-bar 段内（与 Terminal/Changes/Browser 同族）", () => {
    const barStart = app.indexOf('<div className="chat-bar">');
    const barEnd = app.indexOf("{showEmpty ? (", barStart);
    expect(barStart).toBeGreaterThan(-1);
    expect(barEnd).toBeGreaterThan(barStart);
    const bar = app.slice(barStart, barEnd);
    expect(bar).toContain('aria-label="对话目录"');
    expect(bar).toContain("outlineTurns.length >= 2");
    expect(bar).toContain("data-on={outlineOpen}");
  });
  it("旧浮片类名从样式层撤净（没有第二条落点）", () => {
    expect(css).not.toMatch(/\.outline-btn\s*\{/);
  });
});
