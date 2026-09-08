import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, replay } from "../src/events";

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
});
