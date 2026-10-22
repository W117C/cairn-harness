// UI 来源身份（计划 Task 5 红面）：
//   ① 视图 + 实时增量合并：显示序不等于物理行号，父/子同号各留各的；
//   ② 实时事件的物理行号从快照的本地水位往后推；
//   ③ Stream 按 eventRefKey 做 DOM 键，并给祖先行挂来源标记；
//   ④ 会话键：有可信 workspace 才是 ref 键，没有就不生成裸 id 键。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentEvent, EventRef, SessionView } from "../../../src/events";
import { eventRefKey } from "../../../src/events/session-ref";
import { inheritedDisplayIndexes, mergeViewEvents, refsByDisplayIndex } from "../src/renderer/derived/event-reference";
import { isInheritedRef, isStaleForActive, sessionKeyOf } from "../src/renderer/state/session-identity";
import { projectStream } from "../src/renderer/projections";
import { Stream } from "../src/renderer/components/Stream";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_message", content });
const W = "/tmp/ws";

function view(): SessionView {
  return {
    session: { workspace: W, sessionId: "child" },
    entries: [
      { event: user("P1"), ref: { workspace: W, sessionId: "parent", eventId: 1 }, inherited: true },
      { event: assistant("PARENT_ANSWER"), ref: { workspace: W, sessionId: "parent", eventId: 2 }, inherited: true },
      { event: { type: "session_meta" }, ref: { workspace: W, sessionId: "child", eventId: 1 }, inherited: false },
      { event: user("CHILD_USER"), ref: { workspace: W, sessionId: "child", eventId: 2 }, inherited: false },
    ],
    localEvents: [{ type: "session_meta" }, user("CHILD_USER")],
  };
}

describe("视图 + 实时增量", () => {
  it("父/子同号事件各留各的来源，实时行的物理行号从本地水位推", () => {
    const live = [...view().localEvents, assistant("LIVE_ANSWER")];
    const merged = mergeViewEvents(view(), live);
    expect(merged.map((m) => [m.ref.sessionId, m.ref.eventId])).toEqual([
      ["parent", 1], ["parent", 2], ["child", 1], ["child", 2], ["child", 3],
    ]);
    expect(merged[1]!.ref.eventId).toBe(merged[3]!.ref.eventId); // 都是 2 号，但不是同一格
    expect(eventRefKey(merged[1]!.ref)).not.toBe(eventRefKey(merged[3]!.ref));
    expect([...inheritedDisplayIndexes(merged)]).toEqual([0, 1]);
    expect(refsByDisplayIndex(merged).get(4)).toEqual({ workspace: W, sessionId: "child", eventId: 3 });
  });

  it("快照后的实时增量不重复：本地水位之前的事件只出现一次", () => {
    const merged = mergeViewEvents(view(), view().localEvents);
    expect(merged).toHaveLength(4); // 没有额外的 child 行被重复追加
  });
});

describe("Stream：DOM 键与来源标记", () => {
  it("父子同号行各按 eventRefKey 出键；祖先行挂「来自 parent」", () => {
    const merged = mergeViewEvents(view(), view().localEvents);
    const rows = projectStream(merged.map((m) => m.event), false);
    const refs = refsByDisplayIndex(merged);
    const inherited = inheritedDisplayIndexes(merged);
    const html = renderToStaticMarkup(
      <Stream rows={rows} refs={refs} inherited={inherited} streaming={false} />,
    );
    expect(html).toContain("data-event-ref=");
    // 两个不同的来源引用都进了 DOM：父第 2 行与子第 2 行。
    expect(html).toContain(eventRefKey({ workspace: W, sessionId: "parent", eventId: 2 }).replace(/"/g, "&quot;"));
    expect(html).toContain(eventRefKey({ workspace: W, sessionId: "child", eventId: 2 }).replace(/"/g, "&quot;"));
    expect(html).toContain("来自 parent");
    expect(html.match(/来自 parent/g)).toHaveLength(2); // 父用户行 + 父助手行
    expect(html).not.toContain("来自 child");
  });
});

describe("会话键：没有可信工作区就不写裸 id 键", () => {
  it("A/B 同名会话得到不同键；无 workspace 返回 null", () => {
    const a = sessionKeyOf("/tmp/A", "same");
    const b = sessionKeyOf("/tmp/B", "same");
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
    expect(sessionKeyOf(null, "same")).toBeNull();
    expect(sessionKeyOf("", "same")).toBeNull();
    expect(isInheritedRef({ workspace: W, sessionId: "child" }, { workspace: W, sessionId: "parent", eventId: 1 })).toBe(true);
    expect(isInheritedRef({ workspace: W, sessionId: "child" }, { workspace: W, sessionId: "child", eventId: 1 })).toBe(false);
  });

  it("同名 id 的另一棵根的迟到推送不进当前会话；旧 host 不带 workspace 时保持旧行为", () => {
    expect(isStaleForActive({ activeId: "same", activeWorkspace: "/A", eventSessionId: "same", eventWorkspace: "/B" })).toBe(true);
    expect(isStaleForActive({ activeId: "same", activeWorkspace: "/B", eventSessionId: "same", eventWorkspace: "/B" })).toBe(false);
    expect(isStaleForActive({ activeId: "other", activeWorkspace: "/A", eventSessionId: "same", eventWorkspace: "/B" })).toBe(false);
    expect(isStaleForActive({ activeId: "same", activeWorkspace: "/A", eventSessionId: "same", eventWorkspace: undefined })).toBe(false);
  });
});
