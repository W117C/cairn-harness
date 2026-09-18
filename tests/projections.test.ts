// projections.ts 纯函数覆盖：本文件替代随 React 归档删除的 tests/panels.test.ts 中
// 对三个**仍在发货**的投影函数的断言（projectDiffCards 还被 panels-check 消费）。
// React 组件注册表/SSR 冒烟部分随 panels/registry.tsx 归档不再适用，故不重建。
import { describe, expect, it } from "vitest";
import { pendingApprovals, projectDiffCards, projectMemoryWrites } from "../src/renderer/projections";
import type { AgentEvent } from "../src/events";

describe("projections 纯函数（vanilla 层仍在使用：store.ts / panels-check）", () => {
  it("memory 投影：remember tool_call/tool_result 配对（M2d）", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "m1", name: "remember", args: { scope: "project", kind: "memory", topic: "note" } },
      { type: "tool_result", callId: "m1", ok: true, output: "已记录" },
    ];
    const writes = projectMemoryWrites(events);
    expect(writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ callId: "m1", scope: "project", kind: "memory", topic: "note", ok: true });
  });

  it("memory 投影：无 remember 调用 → 空列表（不误报）", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "x1", name: "read_file", args: { path: "a.ts" } },
      { type: "tool_result", callId: "x1", ok: true, output: "" },
    ];
    expect(projectMemoryWrites(events)).toEqual([]);
  });

  it("diff 投影：write_file 聚合 + tool_result 配对状态；空事件 → 空列表", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts", content: "x" } },
      { type: "tool_result", callId: "t1", ok: true, output: "written" },
      { type: "tool_call", id: "t2", name: "write_file", args: { path: "b.ts", content: "y" } },
      { type: "tool_call", id: "t3", name: "read_file", args: { path: "a.ts" } },
    ];
    const diffs = projectDiffCards(events);
    expect(diffs.map((d) => d.id)).toEqual(["t1", "t2"]);
    expect(diffs[0]?.ok).toBe(true);
    expect(diffs[1]?.ok).toBe(null);
    expect(projectDiffCards([])).toEqual([]);
  });

  it("approvals 投影：未 resolved 计数；resolved 后归零（重启后 pending 必空）", () => {
    const asks = [
      { askId: "a1", tool: "run_shell", args: {} },
      { askId: "a2", tool: "write_file", args: {}, resolved: "approved" as const },
    ];
    expect(pendingApprovals(asks).map((a) => a.askId)).toEqual(["a1"]);
    expect(pendingApprovals([])).toEqual([]);
  });
});
