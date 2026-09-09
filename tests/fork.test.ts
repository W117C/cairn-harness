import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, forkSession, replay } from "../src/events";

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function seedSession(): Promise<{ path: string; sha: string }> {
  dir = await mkdtemp(join(tmpdir(), "m1a-fork-"));
  const logPath = join(dir, "events.jsonl");
  const log = createEventLog(logPath);
  const written = [
    { type: "user_message", content: "修 bug" },
    { type: "assistant_delta", callId: "a1", text: "我先" },
    { type: "assistant_delta", callId: "a1", text: "看看" },
    { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } },
    { type: "tool_result", callId: "c1", ok: true, output: "..." },
  ] as const;
  for (const e of written) await log.append(e);
  return { path: logPath, sha: createHash("sha256").update(await readFile(logPath)).digest("hex") };
}

describe("forkSession", () => {
  it("分支后新会话事件数 = N+1，前缀与原会话一致，末条为 session_meta{branch_of}", async () => {
    const s = await seedSession();
    const res = await forkSession(s.path, "3", join(dir, "fork-a"));
    expect(res.count).toBe(4);
    const forked = await replay(res.eventsPath);
    expect(forked).toHaveLength(4);
    const original = await replay(s.path);
    expect(forked.slice(0, 3)).toEqual(original.slice(0, 3));
    expect(forked[3]).toEqual({ type: "session_meta", branch_of: s.path });
  });

  it("原会话文件 sha256 与分支前逐字一致", async () => {
    const s = await seedSession();
    await forkSession(s.path, "3", join(dir, "fork-b"));
    const after = createHash("sha256").update(await readFile(s.path)).digest("hex");
    expect(after).toBe(s.sha);
  });

  it("在最后一个事件点上分支 → N = 全部长度；非法 eventId 拒绝", async () => {
    const s = await seedSession();
    const res = await forkSession(s.path, "5", join(dir, "fork-c"));
    expect(res.count).toBe(6);
    await expect(forkSession(s.path, "6", join(dir, "fork-d"))).rejects.toThrow(/无效 eventId/);
    await expect(forkSession(s.path, "0", join(dir, "fork-e"))).rejects.toThrow(/无效 eventId/);
  });
});
