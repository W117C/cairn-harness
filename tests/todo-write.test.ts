// todo_write 工具判卷（2026-11-04 工作状态面板「进程」的数据源）：
//   ① 校验面：items 非空/帽 20/单条 200 字/state 封闭枚举——违规 ToolError，不静默丢；
//   ② 事件面：todo_updated 全量替换 + 回执文本进上下文（模型靠它记着写到哪）；
//   ③ 权限面：todo_write **不进** SIDE_EFFECT_TOOLS（无用户数据副作用，各档免批直行）。
import { describe, expect, it } from "vitest";
import { parseTodoItems, todoReceipt, todo_write } from "../src/tools/todo_write";
import { isSideEffectTool } from "../src/permissions/autonomy";
import { ToolError } from "../src/tools/base";
import { atomicUnits, keepFirstSet } from "../src/agent/compaction";
import { unfinishedIndexes } from "../src/events/session";
import type { AgentEvent } from "../src/events";

describe("parseTodoItems（校验面）", () => {
  it("合法清单原样规整（trim 文本、state 缺省 pending）", () => {
    expect(parseTodoItems({ items: [{ text: " 修 a " }, { text: "修 b", state: "done" }] })).toEqual([
      { text: "修 a", state: "pending" },
      { text: "修 b", state: "done" },
    ]);
  });

  it("违规当场抛：空数组 / 缺 text / 空 text / 未知 state / 超 20 项 / 超 200 字", () => {
    expect(() => parseTodoItems({})).toThrow(ToolError);
    expect(() => parseTodoItems({ items: [] })).toThrow(ToolError);
    expect(() => parseTodoItems({ items: [{ state: "done" }] })).toThrow(ToolError);
    expect(() => parseTodoItems({ items: [{ text: "   " }] })).toThrow(ToolError);
    expect(() => parseTodoItems({ items: [{ text: "x", state: "doing" }] })).toThrow(ToolError);
    expect(() => parseTodoItems({ items: Array.from({ length: 21 }, (_, i) => ({ text: `t${String(i)}` })) })).toThrow(ToolError);
    expect(() => parseTodoItems({ items: [{ text: "x".repeat(201) }] })).toThrow(ToolError);
  });
});

describe("todoReceipt（回执面）", () => {
  it("进上下文的回执带完成数与逐项勾叉", () => {
    const r = todoReceipt([
      { text: "修 a", state: "done" },
      { text: "修 b", state: "pending" },
    ]);
    expect(r).toContain("1/2 完成");
    expect(r).toContain("✓ 修 a");
    expect(r).toContain("○ 修 b");
  });
});

describe("todo_write（工具面）", () => {
  it("run：emit todo_updated 全量替换事件；回执 ok", async () => {
    const emitted: unknown[] = [];
    const r = await todo_write.run(
      { items: [{ text: "a" }, { text: "b", state: "done" }] },
      { workspace: "/w", emit: (e) => { emitted.push(e); }, callId: "t9" },
    );
    expect(r.ok).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "todo_updated", callId: "t9", items: [{ text: "a", state: "pending" }, { text: "b", state: "done" }] });
    expect((r as { output: string }).output).toContain("1/2 完成");
  });

  it("无 emit/callId ⇒ fail-closed 拒", async () => {
    await expect(todo_write.run({ items: [{ text: "a" }] }, { workspace: "/w" })).rejects.toThrow(ToolError);
    await expect(todo_write.run({ items: [{ text: "a" }] }, { workspace: "/w", emit: () => undefined })).rejects.toThrow(ToolError);
  });

  it("权限面：todo_write 不是副作用工具（各档免批直行，含只读档）", () => {
    expect(isSideEffectTool("todo_write")).toBe(false);
  });

  it("压缩受护与原子单元：最新主会话 todo_updated 连同同 callId 的调用/回执一起跨压缩受护，且不串 worker 同名 callId", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "修完三件事" }, // 1
      { type: "tool_call", id: "c1", name: "todo_write", args: { items: [{ text: "旧", state: "pending" }] } }, // 2
      { type: "todo_updated", callId: "c1", items: [{ text: "旧", state: "pending" }] }, // 3
      { type: "tool_result", callId: "c1", ok: true, output: "旧回执" }, // 4
      { type: "tool_call", id: "c2", name: "todo_write", args: { items: [{ text: "新", state: "pending" }] } }, // 5
      { type: "todo_updated", callId: "c2", items: [{ text: "新", state: "pending" }] }, // 6
      { type: "tool_result", callId: "c2", ok: true, output: "新回执" }, // 7
      // worker 用了相同的 callId "c2"，不能把父单元拉长，也不能顶掉父的受护清单
      { type: "tool_call", id: "c2", name: "todo_write", args: {}, agent_id: "w1" }, // 8
      { type: "todo_updated", callId: "c2", items: [{ text: "worker", state: "pending" }], agent_id: "w1" }, // 9
      { type: "tool_result", callId: "c2", ok: true, output: "w", agent_id: "w1" }, // 10
    ];
    const units = atomicUnits(events);
    expect(units).toEqual([
      { lo: 2, hi: 4, ids: [2, 3, 4] },
      { lo: 5, hi: 7, ids: [5, 6, 7] },
      { lo: 8, hi: 10, ids: [8, 9, 10] },
    ]);
    const keep = keepFirstSet(events);
    expect(keep.has(5)).toBe(true);
    expect(keep.has(6)).toBe(true);
    expect(keep.has(7)).toBe(true);
    expect(keep.has(2)).toBe(false);
    expect(keep.has(9)).toBe(false);
  });

  it("分叉未收尾清理：tool_result 未落盘前中断，todo_updated 随在飞 tool_call 一起被判为未收尾", () => {
    const dangling: AgentEvent[] = [
      { type: "user_message", content: "go" },
      { type: "tool_call", id: "t-open", name: "todo_write", args: {} },
      { type: "todo_updated", callId: "t-open", items: [{ text: "半截", state: "pending" }] },
    ];
    expect([...unfinishedIndexes(dangling)]).toEqual([1, 2]);

    const settled: AgentEvent[] = [
      ...dangling,
      { type: "tool_result", callId: "t-open", ok: true, output: "ok" },
    ];
    expect([...unfinishedIndexes(settled)]).toEqual([]);
  });
});
