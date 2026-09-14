import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, mergeAssistantDeltas, replay, replayIncremental, type AgentEvent, type AssistantDeltaEvent } from "../src/events";

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

// 审查 S1-2（修复任务书 1.2）：增量缓存的「读尾部 + push + 推进 offset」在 await 间隙会被
// 并发消费方各推一次 -> 该轮投影出现重复事件（生产形态：sidechat 读主会话日志与主 run
// assemble 同时在飞，旁路提问的设计前提就是主会话在跑）。修前实测返回 11 条且两路同一数组。
describe("replayIncremental 并发与缓存边界（S1-2 回归）", () => {
  it("两路并发读同一日志不产生重复事件，且不交出缓存数组本体", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-incremental-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const um = (t: string): AgentEvent => ({ type: "user_message", content: t } as AgentEvent);
    for (let i = 1; i <= 5; i++) await log.append(um("m" + String(i)));
    expect(await replayIncremental(logPath)).toHaveLength(5); // 建缓存（此后只走增量分支）
    for (let i = 1; i <= 3; i++) await log.append(um("c" + String(i)));
    const [a, b] = await Promise.all([replayIncremental(logPath), replayIncremental(logPath)]);
    expect(a.map((ev) => (ev as { content?: string }).content)).toEqual([
      "m1", "m2", "m3", "m4", "m5", "c1", "c2", "c3",
    ]);
    expect(b).toHaveLength(8);
    expect(a).not.toBe(b); // 共享缓存本体不得外泄
    a.push(um("poison")); // 消费方就地改数组也不该污染缓存
    expect(await replayIncremental(logPath)).toHaveLength(8);
  });
});


// 审查 S1-4（修复任务书 1.4）：A1 的逐行容错若也吃掉中段坏行，「事件 id = 1-based 行号」
// 这个跨文件契约就破了（promote 的 events[id-1]、untilEventId、compressed_event_ids 全按
// 行号取事件）。本用例锁边界：尾部坏行可容且 id 语义不变；中段坏行显式失败，不静默错位。
describe("replay 坏行容错边界（S1-4 回归）", () => {
  it("尾部半写行可容：前缀完整、untilEventId 仍按行号成立", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-tailbad-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    for (let i = 1; i <= 3; i++) await log.append({ type: "user_message", content: "m" + String(i) } as AgentEvent);
    await appendFile(logPath, '{"type":"user_message","conten', "utf8"); // 崩溃截断的尾行
    const events = await replay(logPath);
    expect(events.map((e) => (e as { content?: string }).content)).toEqual(["m1", "m2", "m3"]);
    const upto2 = await replay(logPath, "2");
    expect(upto2).toHaveLength(2);
    expect(upto2[1]!.type).toBe("user_message");
    expect((upto2[1] as { content?: string }).content).toBe("m2"); // 不偏位
    await expect(replay(logPath, "4")).rejects.toThrow(/无效 untilEventId/);
  });

  it("中段坏行不静默跳过：显式失败（跳过会让之后每个 id 错位一格）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-midbad-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "m1" } as AgentEvent);
    await log.append({ type: "user_message", content: "m2" } as AgentEvent);
    const raw = await readFile(logPath, "utf8");
    const lines = raw.trimEnd().split("\n");
    await writeFile(logPath, lines[0] + "\n" + "{ 坏行不是合法 JSON" + "\n" + lines[1] + "\n", "utf8");
    await expect(replay(logPath)).rejects.toThrow(/非尾部坏行/);
    await expect(replay(logPath, "2")).rejects.toThrow(/非尾部坏行/);
  });
});

