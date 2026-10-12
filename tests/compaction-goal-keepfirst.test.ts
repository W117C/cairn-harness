// #84「goal 半守」侧的闸：goal 的证据锚点（goal_set / goal_stopped）此前不在 compaction 的
// keep-first 受护名单里——一旦被压缩摘掉，下一次压缩后 goal-trace 的「最后一条 goal_set 之后」
// 证据窗口断锚，续跑判据读不出设过目标。这条闸钉住：goal 证据锚点必须与 plan 同一纪律，
// 永不进压缩集、永不进摘要输入。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { DEFAULT_COMPACTION_CONFIG, atomicUnits, keepFirstSet, selectCut } from "../src/agent/compaction";

const GOAL_TEXT = "把 fixtures/todo-app 的 1 失败修到 0";

function user(content: string): AgentEvent {
  return { type: "user_message", content };
}
function say(content: string): AgentEvent {
  return { type: "assistant_message", content };
}
function call(id: string, name: string): AgentEvent {
  return { type: "tool_call", id, name, args: {} };
}
function result(callId: string, output: string): AgentEvent {
  return { type: "tool_result", callId, ok: true, output };
}
function goalSet(): AgentEvent {
  return { type: "goal_set", objective: GOAL_TEXT, max_turns: 20, max_usd: 2 };
}
function goalStopped(): AgentEvent {
  return { type: "goal_stopped", reason: "done", turn: 3, evidence: "verified" };
}

describe("goal 证据锚点跨压缩受护（#84）", () => {
  it("keep-first 名单含最后一组 goal_set / goal_stopped", () => {
    const events: AgentEvent[] = [
      user(GOAL_TEXT), // 1
      goalSet(), // 2
      call("t1", "read_file"), // 3
      result("t1", "x".repeat(400)), // 4
      goalStopped(), // 5
      say("done"), // 6
    ];
    const keep = keepFirstSet(events);
    expect(keep.has(2)).toBe(true); // goal_set 受护
    expect(keep.has(5)).toBe(true); // goal_stopped 受护
    // 受护的应该是最后一组：早段 goal_set 之后若再有一组，最新的那一组受护
    const events2: AgentEvent[] = [
      user(GOAL_TEXT), // 1
      goalSet(), // 2（旧）
      say("a"), // 3
      goalSet(), // 4（新，应受护）
      say("b"), // 5
    ];
    const keep2 = keepFirstSet(events2);
    expect(keep2.has(4)).toBe(true); // 最后一条 goal_set 受护
    expect(keep2.has(2)).toBe(false); // 旧的 goal_set 不再单独受护（证据窗以新锚点为准）
  });

  it("selectCut 不得把 goal_set / goal_stopped 压进 compressedIds", () => {
    const events: AgentEvent[] = [
      user(GOAL_TEXT), // 1 keep-first
      goalSet(), // 2 keep-first（目标锚点）
      call("t1", "run_shell"), // 3 大参数
      result("t1", "y".repeat(2000)), // 4 大输出
      goalStopped(), // 5 keep-first
      say("收尾"), // 6
    ];
    const units = atomicUnits(events);
    const cut = selectCut(events, { ...DEFAULT_COMPACTION_CONFIG, tailMinTokens: 30, tailMaxTokens: 60 }, {
      availableTokens: 2000,
      factor: 4,
      keepFirst: keepFirstSet(events),
      excluded: new Set(),
      lastUserMsgId: 1,
      units,
    });
    expect(cut.compressedIds).not.toContain(2);
    expect(cut.compressedIds).not.toContain(5);
  });
});
