import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { projectStream } from "../src/renderer/projections";
import { Stream } from "../src/renderer/components/Stream";

const events = [
  { type: "tool_call", id: "a", name: "read_file", args: { path: "a.ts" } },
  { type: "tool_result", callId: "a", ok: true, output: "export const a = 1;" },
  { type: "tool_call", id: "b", name: "run_shell", args: { command: "pnpm test" } },
  { type: "tool_result", callId: "b", ok: false, output: "Assertion failed\nExpected 2, received 1" },
] as AgentEvent[];

describe("工具过程的分层披露", () => {
  it("返回内容与调用配对，保留失败原因，限制巨量输出并明确标记截断", () => {
    const rows = projectStream([...events, { type: "tool_call", id: "c", name: "read_file", args: {} },
      { type: "tool_result", callId: "c", ok: true, output: "x".repeat(15000) }] as AgentEvent[]);
    expect(rows[0]).toMatchObject({ output: "export const a = 1;" });
    expect(rows[1]).toMatchObject({ ok: false, output: "Assertion failed\nExpected 2, received 1" });
    expect(rows[2]).toMatchObject({ outputTruncated: true });
    expect(rows[2]?.kind === "tool" && rows[2].output?.length).toBe(10000);
  });

  it("普通模式以工具组摘要开场，失败状态在收起时仍可见", () => {
    const html = renderToStaticMarkup(<Stream rows={projectStream(events)} view="normal" streaming={false} />);
    expect(html).toContain('class="tool-group-toggle"');
    expect(html).toContain('aria-expanded="false"');
    // 2026-11-02：失败数与总数合成一句（此前「2 次工具调用 | 1 次失败」并排，读成两件事）。
    expect(html).toContain("1 次工具失败（共 2 次）");
    // 2026-11-01 真机缺陷 1：收起卡那一行改说人话（机器面原文是写给模型读的解释面）；
    // 原文不丢——退到悬停提示（title）里，展开体另有全文。
    expect(html).toContain("run_shell 调用失败");
    expect(html).toContain("原始报错：Assertion failed");
  });

  it("详细模式显示输入和返回内容；输出当作文本转义，不执行 HTML", () => {
    const rows = projectStream(events);
    const html = renderToStaticMarkup(<Stream rows={rows} view="verbose" streaming={false} />);
    expect(html).toContain("原始参数（JSON）");
    expect(html).toContain("返回内容");
    expect(html).toContain("Expected 2, received 1");
    const escaped = renderToStaticMarkup(<Stream rows={projectStream([
      ...events.slice(0, 1), { type: "tool_result", callId: "a", ok: true, output: '<script>alert("x")</script>' },
    ] as AgentEvent[])} view="verbose" />);
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).not.toContain("<script>");
  });
});
