// 段判卷（设计规格 2026-11-16 §2；ADR 0015 §五 的 P2）：
// 段 = 一条 session_meta_update 的行号，不是新会话文件、不是新事件种类。
//
// 判的是什么：
//   ① 没有分界时是第一段（隐式），分界行属于它开启的新段；
//   ② 回退（session_rewind）会把分界一起回滚——与「补丁只从有效集合累积」同一条语义；
//   ③ 理由认不出 ⇒ 记 unknown 但段仍成立；序数写坏 ⇒ 炸（写侧违约，不静默）；
//   ④ 同一份日志算两次逐字相同（纯函数）；切片只装消息，不装控制记录。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import {
  currentSegment,
  openSegmentPatch,
  segmentBoundaries,
  segmentOf,
  segmentPatch,
  segmentReasonOf,
  segmentSlices,
} from "../src/agent/segments";

const msg = (content: string): AgentEvent => ({ type: "user_message", content }) as AgentEvent;
const metaUpdate = (patch: Record<string, string>): AgentEvent =>
  ({ type: "session_meta_update", patch }) as AgentEvent;
const rewind = (to: number): AgentEvent => ({ type: "session_rewind", to_event_id: to }) as AgentEvent;

describe("段", () => {
  it("没有分界 ⇒ 第一段（隐式，不需要任何事件）", () => {
    const events = [msg("你好"), msg("继续")];
    expect(currentSegment(events)).toBe(1);
    expect(segmentBoundaries(events)).toEqual([]);
    expect(segmentOf(events, 2)).toBe(1);
    expect(segmentSlices(events)).toEqual([{ segment: 1, eventIds: [1, 2] }]);
  });

  it("开新段：当前段推进，分界行属于新段，切片按段分开", () => {
    const events = [
      msg("第一段的话"), // 1
      metaUpdate(segmentPatch(2, "steward_switch")), // 2 ← 分界
      msg("第二段的话"), // 3
    ];
    expect(currentSegment(events)).toBe(2);
    expect(segmentBoundaries(events)).toEqual([{ eventId: 2, segment: 2, reason: "steward_switch" }]);
    expect(segmentOf(events, 1)).toBe(1);
    expect(segmentOf(events, 2)).toBe(2); // 分界行本身就是新段的第一行
    expect(segmentOf(events, 3)).toBe(2);
    expect(segmentSlices(events)).toEqual([
      { segment: 1, eventIds: [1] },
      { segment: 2, eventIds: [3] },
    ]);
  });

  it("回退把分界一起回滚（补丁只从有效集合累积）", () => {
    const events = [
      msg("第一段的话"), // 1
      metaUpdate(segmentPatch(2, "user")), // 2 ← 分界
      msg("第二段的话"), // 3
      rewind(1), // 4 ← 退回第 1 行之后：第 2、3 行都不算数
    ];
    expect(segmentBoundaries(events)).toEqual([]);
    expect(currentSegment(events)).toBe(1);
    expect(segmentOf(events, 3)).toBe(1);
    expect(segmentSlices(events)).toEqual([{ segment: 1, eventIds: [1] }]);
  });

  it("理由认不出 ⇒ unknown，段仍然成立（分界是事实，理由只是注解）", () => {
    const events = [msg("a"), metaUpdate({ segment: "2", segment_reason: "从未来来的理由" }), msg("b")];
    expect(segmentBoundaries(events)).toEqual([{ eventId: 2, segment: 2, reason: "unknown" }]);
    expect(currentSegment(events)).toBe(2);
    expect(segmentReasonOf(undefined)).toBe("unknown");
    expect(segmentReasonOf("user")).toBe("user");
  });

  it("序数写坏 ⇒ 炸（写侧违约，不静默忽略）", () => {
    for (const bad of ["0", "-1", "2.5", "x", ""]) {
      const events = [msg("a"), metaUpdate({ segment: bad }), msg("b")];
      expect(() => segmentBoundaries(events)).toThrow(/segment/);
    }
  });

  it("没写 segment 键的补丁不开段（既有补丁语义不受影响）", () => {
    const events = [msg("a"), metaUpdate({ model: "x" }), msg("b")];
    expect(segmentBoundaries(events)).toEqual([]);
    expect(currentSegment(events)).toBe(1);
  });

  it("多段：序数按写入推进，切片稳定；同一份日志算两次逐字相同（纯函数）", () => {
    const events = [
      msg("a"), // 1
      metaUpdate(segmentPatch(2, "user")), // 2
      msg("b"), // 3
      metaUpdate(segmentPatch(3, "compaction")), // 4
      msg("c"), // 5
    ];
    const first = segmentSlices(events);
    expect(first).toEqual([
      { segment: 1, eventIds: [1] },
      { segment: 2, eventIds: [3] },
      { segment: 3, eventIds: [5] },
    ]);
    expect(segmentSlices(events)).toEqual(first);
    expect(currentSegment(events)).toBe(3);
    expect(segmentBoundaries(events).map((b) => b.reason)).toEqual(["user", "compaction"]);
  });

  it("写侧 helper 只接受三值理由与正整数序数", () => {
    expect(segmentPatch(2, "compaction")).toEqual({ segment: "2", segment_reason: "compaction" });
    expect(() => segmentPatch(0, "user")).toThrow();
    expect(() => segmentPatch(2, "unknown" as never)).toThrow();
  });
});

describe("开新段的写侧 helper", () => {
  it("序数由日志算：没有分界 ⇒ 2；已有两段 ⇒ 3", () => {
    expect(openSegmentPatch([msg("a")], "user")).toEqual({ segment: "2", segment_reason: "user" });
    const two = [msg("a"), metaUpdate(segmentPatch(2, "user")), msg("b")];
    expect(openSegmentPatch(two, "compaction")).toEqual({ segment: "3", segment_reason: "compaction" });
  });

  it("回退之后按**有效**序数算（不按被砍掉的那条）", () => {
    const events = [msg("a"), metaUpdate(segmentPatch(2, "user")), msg("b"), rewind(1)];
    expect(openSegmentPatch(events, "user")).toEqual({ segment: "2", segment_reason: "user" });
  });
});
