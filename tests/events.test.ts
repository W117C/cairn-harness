import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, mergeAssistantDeltas, replay, type AssistantDeltaEvent } from "../src/events";

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("事件流", () => {
  it("写 3 条 → replay 回 3 条且顺序一致", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      { type: "user_message", content: "修复失败的测试" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } },
      { type: "tool_result", callId: "c1", ok: true, output: "...file body..." },
    ] as const;
    for (const e of written) await log.append(e);
    const events = await replay(logPath);
    expect(events).toHaveLength(3);
    expect(events).toEqual([...written]);
    // 顺序一致性：逐条比对类型与关键字段
    expect(events.map((e) => e.type)).toEqual(["user_message", "tool_call", "tool_result"]);
  });

  it("append-only：replay 之后继续追加只增不改", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "a" });
    expect(await replay(logPath)).toHaveLength(1);
    await log.append({ type: "assistant_message", content: "b" });
    const events = await replay(logPath);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "user_message", content: "a" });
  });

  it("未知事件类型被拒绝（防坏日志）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-events-"));
    const log = createEventLog(join(dir, "events.jsonl"));
    await expect(log.append({ type: "bogus" } as never)).rejects.toThrow(/未知事件类型/);
  });

  it("M1a：5 条事件（含 2 条 delta）replay 顺序与内容一致", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1a-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      { type: "user_message", content: "hi" },
      { type: "assistant_delta", callId: "a1", text: "你好" },
      { type: "assistant_delta", callId: "a1", text: "，世界" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "a.ts" } },
      { type: "usage", inputTokens: 3, outputTokens: 5 },
    ] as const;
    for (const e of written) await log.append(e);
    const events = await replay(logPath);
    expect(events).toHaveLength(5);
    expect(events).toEqual([...written]);
    expect(events.map((e) => e.type)).toEqual([
      "user_message", "assistant_delta", "assistant_delta", "tool_call", "usage",
    ]);
  });

  it("M1a：按 event id 截断重放长度正确", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1a-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      { type: "user_message", content: "1" },
      { type: "assistant_delta", callId: "a1", text: "x" },
      { type: "assistant_delta", callId: "a1", text: "y" },
      { type: "tool_call", id: "c1", name: "read_file", args: {} },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
    ] as const;
    for (const e of written) await log.append(e);
    const three = await replay(logPath, "3");
    expect(three).toHaveLength(3);
    expect(three).toEqual([...written].slice(0, 3));
    expect(await replay(logPath, "1")).toHaveLength(1);
    expect(await replay(logPath, "5")).toHaveLength(5);
    // 非法 id 一律报错（fail loud），不静默截断
    await expect(replay(logPath, "0")).rejects.toThrow(/无效 untilEventId/);
    await expect(replay(logPath, "6")).rejects.toThrow(/无效 untilEventId/);
    await expect(replay(logPath, "x")).rejects.toThrow(/无效 untilEventId/);
  });

  it("M1a：同一段文本拆成 N 个 delta → 合成结果与原文逐字相等", async () => {
    const text = "3 条测试全部通过，bug 已修复，任务完成。";
    const chars = Array.from(text);
    const deltas: AssistantDeltaEvent[] = [];
    for (let i = 0; i < chars.length; i += 4) {
      deltas.push({ type: "assistant_delta", callId: "a1", text: chars.slice(i, i + 4).join("") });
    }
    expect(deltas.length).toBeGreaterThan(1);
    expect(mergeAssistantDeltas(deltas)).toBe(text);
    expect(mergeAssistantDeltas(deltas, "a1")).toBe(text);
    // 不同 callId 只合成各自的
    deltas.push({ type: "assistant_delta", callId: "a2", text: "另一轮" });
    expect(mergeAssistantDeltas(deltas)).toBe(text + "另一轮");
    expect(mergeAssistantDeltas(deltas, "a1")).toBe(text);
  });
});
