// 段的写入点判卷（设计规格 §2）：这是「段」第一次有真调用方。
//
// 判的是什么：
//   ① 写入就是往会话日志追加一条 `session_meta_update`（不另存状态）；
//   ② 序数由**日志本身**算：连开两次 ⇒ 2、3；重开同一份日志算出同一个数；
//   ③ 坏输入不写：非法会话 id、空会话都拒，且错误说得出原因。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSegmentForSession } from "../src/main/session-segments";
import { readSessionEvents } from "../../../src/main/sessions";
import { currentSegment, segmentBoundaries } from "../../../src/agent/segments";

let root: string | null = null;
afterEach(async () => { if (root !== null) await rm(root, { recursive: true, force: true }); root = null; });

async function sessionWith(lines: number): Promise<{ root: string; id: string }> {
  root = await mkdtemp(join(tmpdir(), "cairn-segment-"));
  const id = "s1";
  const body = Array.from({ length: lines }, (_, i) => JSON.stringify({ type: "user_message", content: `第 ${String(i + 1)} 句` }));
  await writeFile(join(root, `${id}.jsonl`), body.join("\n") + (lines > 0 ? "\n" : ""), "utf8");
  return { root, id };
}

describe("段的写入点", () => {
  it("开一段 ⇒ 日志多一条元数据补丁，当前段变 2；再开一次变 3", async () => {
    const { root: r, id } = await sessionWith(2);
    expect(currentSegment(await readSessionEvents(r, id))).toBe(1);
    const first = await openSegmentForSession(r, id, "user");
    expect(first).toEqual({ ok: true, segment: 2 });
    const afterFirst = await readSessionEvents(r, id);
    expect(currentSegment(afterFirst)).toBe(2);
    expect(segmentBoundaries(afterFirst)).toEqual([{ eventId: 3, segment: 2, reason: "user" }]);
    const second = await openSegmentForSession(r, id, "steward_switch");
    expect(second).toEqual({ ok: true, segment: 3 });
  });

  it("空会话不接受开段（没有历史就没有「下一段」）", async () => {
    const { root: r, id } = await sessionWith(0);
    const result = await openSegmentForSession(r, id, "user");
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("历史");
  });

  it("非法会话 id 直接拒（不猜路径）", async () => {
    const { root: r } = await sessionWith(1);
    const result = await openSegmentForSession(r, "../逃出去", "user");
    expect(result.ok).toBe(false);
    expect(String(result.error).length).toBeGreaterThan(0);
  });

  it("同一份日志算两次得同一个序数（写侧不记状态）", async () => {
    const { root: r, id } = await sessionWith(3);
    const events = await readSessionEvents(r, id);
    const a = await openSegmentForSession(r, id, "user");
    const b = await openSegmentForSession(r, id, "user");
    expect(a.segment).toBe(2);
    expect(b.segment).toBe(3);
    expect(currentSegment(events)).toBe(1); // 旧快照不受影响：投影是读取时的事
  });
});
