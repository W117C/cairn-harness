import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { projectStream } from "../src/renderer/projections";
import { Stream } from "../src/renderer/components/Stream";
const call = { type: "tool_call", id: "a", name: "read_file", args: { path: "a.ts" }, ts: 1 } as AgentEvent;
it("未返回的调用在运行时显示执行中，停转后明确未收到结果", () => {
  expect(projectStream([call], true)[0]).toMatchObject({ pending: true });
  const rows = projectStream([call], false);
  expect(rows[0]).toMatchObject({ pending: false, interrupted: true });
  const html = renderToStaticMarkup(<Stream rows={rows} view="normal" streaming={false} />);
  expect(html).toContain("未收到结果");
  expect(html).not.toContain('aria-label="执行中"');
  expect(html).not.toContain('aria-label="完成"');
});
it("历史主会话终态关闭未结调用，新一轮运行也不会重新转圈", () => {
  const rows = projectStream([call, { type: "agent_status", status: "cancelled" },
    { type: "tool_call", id: "b", name: "list_dir", args: {} }] as AgentEvent[], true);
  expect(rows[0]).toMatchObject({ pending: false, interrupted: true });
  expect(rows[1]).toMatchObject({ pending: true });
});
it("worker 终态不关闭主会话工具；迟到的真实返回替换未收口状态", () => {
  expect(projectStream([call, { type: "agent_status", agent_id: "worker", status: "done" }] as AgentEvent[], true)[0]).toMatchObject({ pending: true });
  const rows = projectStream([call, { type: "agent_status", status: "cancelled" },
    { type: "tool_result", callId: "a", ok: false, output: "操作取消" }] as AgentEvent[], false);
  expect(rows[0]).toMatchObject({ pending: false, ok: false, output: "操作取消" });
  expect(rows[0]?.kind === "tool" && rows[0].interrupted).not.toBe(true);
});
