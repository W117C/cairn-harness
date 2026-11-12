// 工具行的 zcode 对标批（2026-11-08 第 1042 页）：
// ① 短纯文本结果（≤160 字、单行、非 JSON）不再穿 pre 代码块外衣——一行「Documentation loaded.」
//    读起来是人话，不是终端转储（zcode uQe 同规）；长/多行/JSON 仍走代码块。
// ② 运行中的活动信号：单行摘要与组标题走中性墨色流光（与思考行同一套语言）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stream } from "../src/renderer/components/Stream";
import { isPlainShortOutput } from "../src/renderer/derived/tool-output";
import type { StreamRow } from "../src/renderer/projections";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const tool = (over: Partial<Extract<StreamRow, { kind: "tool" }>> = {}): StreamRow => ({
  kind: "tool", seq: 0, tool: "web_fetch", summary: "example.com/docs", ...over,
});

describe("isPlainShortOutput（短纯文本结果判定）", () => {
  it("≤160 字、单行、非 JSON ⇒ true（边界 160 含）", () => {
    expect(isPlainShortOutput("Documentation loaded.")).toBe(true);
    expect(isPlainShortOutput("  OK  ")).toBe(true);
    expect(isPlainShortOutput("x".repeat(160))).toBe(true);
  });
  it("多行 / 超长 / 空白 / 合法 JSON ⇒ false（仍走代码块）", () => {
    expect(isPlainShortOutput("第一行\n第二行")).toBe(false);
    expect(isPlainShortOutput("x".repeat(161))).toBe(false);
    expect(isPlainShortOutput("")).toBe(false);
    expect(isPlainShortOutput("   ")).toBe(false);
    expect(isPlainShortOutput('{"ok":true}')).toBe(false);
    expect(isPlainShortOutput("[1,2,3]")).toBe(false);
  });
  it("像 JSON 但 parse 不通 ⇒ 纯文本（不猜它是结构）", () => {
    expect(isPlainShortOutput("{broken json")).toBe(true);
  });
});

describe("短结果轻卡片（展开体）", () => {
  it("短单行结果 ⇒ p.tool-output-plain，不再包 pre；复制入口仍在", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ ok: true, output: "Documentation loaded." })]} view="verbose" streaming={false} actions={{ onCopyText: () => undefined }} />);
    expect(html).toContain('<p class="tool-output-plain">Documentation loaded.</p>');
    expect(html).not.toContain("<pre>Documentation loaded.</pre>");
    expect(html).toContain('aria-label="复制工具返回内容"');
  });
  it("多行结果仍走 pre（终端输出的对齐不丢）", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ ok: true, output: "src\ntests\nscripts" })]} view="verbose" streaming={false} />);
    expect(html).toContain("<pre>src\ntests\nscripts</pre>");
    expect(html).not.toContain("tool-output-plain");
  });
  it("空输出仍明说「（空输出）」，不摆轻卡片空壳", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ ok: true, output: "" })]} view="verbose" streaming={false} />);
    expect(html).toContain("（空输出）");
    expect(html).not.toContain("tool-output-plain");
  });
});

describe("运行中工具的中性流光（与思考行同一套活动语言）", () => {
  const processCss = read("../src/renderer/components/stream-process.css");
  it("pending 单行摘要：text-200 墨流光，挂 data-state 不改 DOM 文本", () => {
    const rule = processCss.match(/\.row\.tool\[data-state="pending"\] \.tsum\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("background-clip: text");
    expect(rule).toContain("hsl(var(--text-200))");
    expect(rule).toContain("animation: live-shimmer-flow var(--t-live-shimmer)");
  });
  it("组标题：有待返回行 ⇒ data-pending=true + 组名流光", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ pending: true })]} view="normal" streaming />);
    expect(html).toMatch(/class="tool-group-toggle"[^>]*data-pending="true"/);
    const rule = processCss.match(/\.tool-group-toggle\[data-pending="true"\] \.tool-group-label\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("background-clip: text");
    const settled = renderToStaticMarkup(<Stream rows={[tool({ ok: true })]} view="normal" streaming={false} />);
    expect(settled).toMatch(/class="tool-group-toggle"[^>]*data-pending="false"/);
  });
  it("系统/app 减弱动效：两路都停动并还原 flat 墨色", () => {
    const block = processCss.slice(processCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\.row\.tool\[data-state="pending"\] \.tsum\s*\{[^}]*animation:\s*none/s);
    expect(block).toMatch(/\.tool-group-toggle\[data-pending="true"\] \.tool-group-label\s*\{[^}]*animation:\s*none/s);
    expect(processCss).toMatch(/\[data-reduce-motion="true"\] \.row\.tool\[data-state="pending"\] \.tsum\s*\{[^}]*animation:\s*none/s);
  });
});