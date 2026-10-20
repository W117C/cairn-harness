import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { projectStream } from "../src/renderer/projections";
import { Stream } from "../src/renderer/components/Stream";

it("大文件编辑的参数展示被截断后，差异入口仍用原始路径", () => {
  const rows = projectStream([
    { type: "tool_call", id: "a", name: "edit_file", args: { path: "src/large.ts", old_text: "x".repeat(5000), new_text: "y".repeat(5000) } },
    { type: "tool_result", callId: "a", ok: true, output: "已修改" },
  ] as AgentEvent[], false);
  expect(rows[0]?.kind === "tool" && rows[0].args?.length).toBeLessThanOrEqual(1501);
  const html = renderToStaticMarkup(<Stream rows={rows} view="verbose" streaming={false} />);
  expect(html).toContain("文件差异");
  expect(html).toContain("src/large.ts");
});
it("相同的非写入工具不能因为有 path 就显示文件差异", () => {
  const rows = projectStream([
    { type: "tool_call", id: "a", name: "read_file", args: { path: "src/large.ts", note: "x".repeat(5000) } },
    { type: "tool_result", callId: "a", ok: true, output: "文件内容" },
  ] as AgentEvent[], false);
  expect(renderToStaticMarkup(<Stream rows={rows} view="verbose" streaming={false} />)).not.toContain("文件差异");
});
