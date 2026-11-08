// R1 消息流重做判卷（2026-10-31）：工具状态单源、审批卡 pending 态、代码块复制衰减。
// 依据 open-claude-ui 的 ChatMessageBubbles / McpToolDecisionCard / CodeBlock 契约；
// 本仓无 jsdom：状态机走纯函数，标记走 SSR，源码哨兵只钉单一事实源。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalCard } from "../src/renderer/components/ApprovalCard";
import { toolStatusOf } from "../src/renderer/components/Stream";
import { Markdown } from "../src/renderer/markdown";
import type { AskPayload } from "../../../src/main/ipc-protocol";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ask = (over: Partial<AskPayload>): AskPayload => ({ askId: "a1", tool: "run_shell", args: {}, ...over }) as AskPayload;

describe("工具状态机：one source, five states", () => {
  it("优先级：中断 > 执行中 > 失败 > 完成 > 未知", () => {
    expect(toolStatusOf({ interrupted: true, pending: true, ok: false })).toBe("interrupted");
    expect(toolStatusOf({ pending: true, ok: false })).toBe("pending");
    expect(toolStatusOf({ ok: false })).toBe("failed");
    expect(toolStatusOf({ ok: true })).toBe("done");
    expect(toolStatusOf({})).toBe("unknown");
  });

  it("行与簇计数共用 toolStatusOf；行上带 data-tool-status 与 aria-busy", () => {
    const src = read("../src/renderer/components/Stream.tsx");
    expect(src).toContain("const state = toolStatusOf(r);");
    expect(src).toContain("data-tool-status={state}");
    expect(src).toContain("aria-busy={r.pending === true}");
    // 簇的四个计数必须走同一个状态机，不许再各写一套布尔组合。
    expect(src).toContain('props.rows.filter((r) => toolStatusOf(r) === "pending")');
    expect(src).toContain('props.rows.filter((r) => toolStatusOf(r) === "failed")');
    expect(src).toContain('props.rows.filter((r) => toolStatusOf(r) === "interrupted")');
    expect(src).toContain('props.rows.filter((r) => toolStatusOf(r) === "unknown")');
  });

  it("用户行渲染态带 data-state=done / data-author=self（流内消息均已落盘）", () => {
    const src = read("../src/renderer/components/Stream.tsx");
    expect(src).toContain('data-state="done" data-author="self"');
  });
});

describe("审批卡：pending 态可识别、可聚焦", () => {
  it("SSR 带 data-status=pending_approval、role=region、工具名 aria-label", () => {
    const html = renderToStaticMarkup(<ApprovalCard ask={ask({ tool: "write_file", args: { path: "src/a.ts" } })} onDecide={() => undefined} />);
    expect(html).toContain('data-status="pending_approval"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="工具调用决策卡片: write_file"');
  });

  it("样式：pending 与澄清/方案卡共用同一骨架；risk 只换语义描边与徽标", () => {
    const css = read("../src/renderer/styles.css");
    const pending = /\.card\[data-status="pending_approval"\]\s*\{([^}]*)\}/s.exec(css)?.[1] ?? "";
    expect(pending).toContain("--gate-border: hsl(var(--color-danger) / 45%)");
    expect(pending).toContain("--gate-accent: hsl(var(--color-danger))");
    expect(pending).toContain("--gate-note-surface: hsl(var(--color-danger) / 8%)");
    expect(pending).toContain("box-shadow: var(--shadow-gate)");
    // 旧「陶土半透明边 + 一层暖光」是局部字面量，体检后不许回到卡片上。
    const oldGlow = /0 4px 16px hsl\(var\(--accent-brand\) \/ 12%\)/;
    expect(pending).not.toMatch(oldGlow);
    expect(oldGlow.test("0 4px 16px hsl(var(--accent-brand) / 12%)"), "反向自证：旧写法要能被这条正则抓到").toBe(true);
    // 三卡一致的抬升面与高度帽：审批不再比另外两张重一档。
    expect(css).toMatch(/\.card\s*\{[^}]*background:\s*var\(--gate-surface\)/s);
    expect(css).toMatch(/\.zone-gate > \*\s*\{[^}]*max-height:\s*min\(62vh, 520px\)/s);
  });
});

describe("R1 工具行视觉：类型字形 + 状态签", () => {
  it("工具名之前有类型字形；非完成态状态签是 pill，pending/failed 各有色", () => {
    const src = read("../src/renderer/components/Stream.tsx");
    const css = read("../src/renderer/styles.css");
    expect(src).toContain("<ToolKindGlyph tool={r.tool} />");
    expect(src).toContain('className="tool-kind"');
    expect(css).toMatch(/\.tool-kind\s*\{[^}]*display:\s*inline-flex/s);
    expect(css).toMatch(/\.tool-status\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s);
    expect(css).toContain('.row.tool[data-tool-status="pending"] .tool-status');
    expect(css).toContain('.row.tool[data-tool-status="failed"] .tool-status');
    expect(css).toContain('.row.tool[data-tool-status="unknown"] .tool-status');
  });
});

describe("R1 审批卡动作次序", () => {
  it("拒绝在最左，总是允许居中，允许一次在最右（主钮）", () => {
    const html = renderToStaticMarkup(<ApprovalCard ask={ask({})} onDecide={() => undefined} />);
    const denyAt = html.indexOf(">拒绝<");
    const alwaysAt = html.indexOf(">总是允许");
    const allowAt = html.indexOf(">允许 · 本次<");
    expect(denyAt).toBeGreaterThan(-1);
    expect(alwaysAt).toBeGreaterThan(denyAt);
    expect(allowAt).toBeGreaterThan(alwaysAt);
    const buttons = [...html.matchAll(/<button[^>]*class="btn [^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(buttons.at(-1)).toContain('class="btn primary"');
  });
});

describe("代码块：复制状态 2.5s + data-copied", () => {
  it("SSR 初始 data-copied=false，按钮仍是复制", () => {
    const html = renderToStaticMarkup(<Markdown text={"```css\nbody{}\n```"} />);
    expect(html).toContain('data-copied="false"');
    expect(html).toContain('aria-label="复制代码"');
  });

  it("状态机时长 2500ms；成功态有独立颜色，不靠远处 toast", () => {
    const src = read("../src/renderer/markdown.tsx");
    const css = read("../src/renderer/styles.css");
    expect(src).toContain("2500");
    expect(src).toContain("data-copied={copied ? \"true\" : \"false\"}");
    expect(css).toContain('.md-copy[data-copied="true"]');
  });

  it("暗色码面：官方灰阶 + 12px 壳 + 36px 头 + 13/1.6 码面", () => {
    const css = read("../src/renderer/styles.css");
    expect(css).toMatch(/\.md-code\s*\{[^}]*background:\s*var\(--gray-900\)/s);
    expect(css).toMatch(/\.md-code\s*\{[^}]*border-radius:\s*var\(--radius-composer-card\)/s);
    expect(css).toMatch(/\.md-code-head\s*\{[^}]*height:\s*36px/s);
    expect(css).toMatch(/\.md-code pre\s*\{[^}]*font-size:\s*var\(--fs-code\)/s);
    expect(css).toMatch(/\.md-code pre\s*\{[^}]*line-height:\s*1\.6/s);
    // 皮肤层近似值（白底 / 15px）会被更高特异性的官方值覆盖；真机读数钉住这一层。
    expect(css).toContain("body[data-dsh-claude-style] .md-body .md-code { background: var(--gray-900)");
    expect(css).toContain("body[data-dsh-claude-style] .md-body .md-code pre { font-size: var(--fs-code)");
  });
});
