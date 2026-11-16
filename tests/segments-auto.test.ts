// 段的自动触发判卷（spec §2 的 `compaction` 理由）：压缩之后，下一轮开新段。
//
// 判的是什么：
//   ① 日志停在一次压缩上 ⇒ 开新段（序数 = 当前段 + 1），理由记 compaction；
//   ② 幂等：写完补丁之后最后一条不再是 compaction ⇒ 再跑一次不开第二段（重试/重启安全）；
//   ③ 不是压缩结尾 ⇒ 什么都不做（不猜「该不该开」）；
//   ④ 空日志 ⇒ 什么都不做（没有历史就没有段）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSegmentAfterCompaction } from "../src/main/segments-auto";
import { readSessionEvents } from "../src/main/sessions";
import { currentSegment, segmentBoundaries } from "../src/agent/segments";
import type { AgentEvent } from "../src/events";

let dir: string | null = null;
afterEach(async () => { if (dir !== null) await rm(dir, { recursive: true, force: true }); dir = null; });

const line = (event: AgentEvent): string => JSON.stringify(event);
const compaction: AgentEvent = {
  type: "compaction", trigger: "auto", reason: "threshold", summary: "摘要",
  tokens_before: 1000, tokens_after: 100,
} as AgentEvent;

async function logWith(events: AgentEvent[]): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "cairn-segauto-"));
  const path = join(dir, "s1.jsonl");
  await writeFile(path, events.map(line).join("\n") + (events.length > 0 ? "\n" : ""), "utf8");
  return path;
}

describe("段的自动触发", () => {
  it("日志停在压缩上 ⇒ 开新段（理由 compaction）", async () => {
    const path = await logWith([
      { type: "user_message", content: "第一段" } as AgentEvent,
      compaction,
    ]);
    expect(await openSegmentAfterCompaction(path)).toBe(2);
    const events = await readSessionEvents(dir!, "s1");
    expect(currentSegment(events)).toBe(2);
    expect(segmentBoundaries(events)).toEqual([{ eventId: 3, segment: 2, reason: "compaction" }]);
    // 压缩事件没有被改写：它只是不再是最后一条
    expect(events[1]!.type).toBe("compaction");
  });

  it("幂等：再跑一次不开第二段", async () => {
    const path = await logWith([{ type: "user_message", content: "a" } as AgentEvent, compaction]);
    expect(await openSegmentAfterCompaction(path)).toBe(2);
    expect(await openSegmentAfterCompaction(path)).toBeNull();
    const text = await readFile(path, "utf8");
    expect(text.trim().split("\n")).toHaveLength(3);
  });

  it("不是压缩结尾 ⇒ 什么都不做", async () => {
    const path = await logWith([
      { type: "user_message", content: "a" } as AgentEvent,
      compaction,
      { type: "user_message", content: "压缩之后又说了一句" } as AgentEvent,
    ]);
    expect(await openSegmentAfterCompaction(path)).toBeNull();
  });

  it("空日志 ⇒ 什么都不做", async () => {
    const path = await logWith([]);
    expect(await openSegmentAfterCompaction(path)).toBeNull();
  });

  it("回退把压缩砍掉之后，不再开段（按有效历史判）", async () => {
    const path = await logWith([
      { type: "user_message", content: "a" } as AgentEvent,
      compaction,
      { type: "session_rewind", to_event_id: 1 } as AgentEvent,
    ]);
    expect(await openSegmentAfterCompaction(path)).toBeNull();
  });
});
