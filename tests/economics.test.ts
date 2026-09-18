import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import {
  deriveBoundaries, deriveProgressBoundaries, economicGate, estimateHorizon, initialEconomicState,
  reduceEconomicState, replayEconomicState, snapToProgressBoundary, type EconomicAction, type EconomicInput,
} from "../src/agent/economics";
const base: EconomicInput = {
  archiveTokens: 1100, memoTokens: 100, writeTokens: 1000, cacheWriteReadRatio: 3,
  requestsPerBoundary: [2, 2, 2], remainingBoundaries: 1, avgIncrementTokens: 100,
  contextTokens: 10000, windowTokens: 128000, state: initialEconomicState(),
};
const call = (id: string, name = "write_file", path = "a.ts"): AgentEvent => ({ type: "tool_call", id, name, args: { path } });
const result = (callId: string, ok = true): AgentEvent => ({ type: "tool_result", callId, ok, output: "result" });
const proof = (callId: string, ok = true): AgentEvent => ({
  type: "verify_result", callId, ok, attempt: 1, maxAttempts: 3,
  results: [{ command: "mock test", ok, output: "evidence" }],
});
const user: AgentEvent = { type: "user_message", content: "next" };
const approved: AgentEvent[] = [
  { type: "plan_proposed", callId: "p", plan: { goal: "fix", files: [
    { path: "a.ts", action: "edit", summary: "a" }, { path: "b.ts", action: "create", summary: "b" },
  ] } },
  { type: "plan_approved", callId: "p", approved: true },
];

describe("economic formulas", () => {
  it("computes horizon sparse discount, lower confidence bound, zero remaining and window clamp", () => {
    expect(estimateHorizon(base)).toBe(3);
    expect(estimateHorizon({ ...base, requestsPerBoundary: [4], remainingBoundaries: 2 })).toBe(5);
    expect(estimateHorizon({ ...base, requestsPerBoundary: [2, 4, 6], remainingBoundaries: 2 }, { remainingRequestStddevK: 1 })).toBe(5);
    expect(estimateHorizon({ ...base, remainingBoundaries: 0 })).toBe(1);
    expect(estimateHorizon({ ...base, contextTokens: 127950 })).toBe(0);
    expect(estimateHorizon({ ...base, contextTokens: 127750 })).toBe(2);
    expect(estimateHorizon({ ...base, avgIncrementTokens: null })).toBe(3);
    expect(estimateHorizon({ ...base, avgIncrementTokens: 0 })).toBe(3);
  });
  it("refuses missing/invalid horizon inputs rather than inventing samples", () => {
    for (const overrides of [
      { requestsPerBoundary: [] }, { requestsPerBoundary: [-1] }, { requestsPerBoundary: [NaN] },
      { remainingBoundaries: null }, { remainingBoundaries: 0.5 }, { avgIncrementTokens: -1 },
      { contextTokens: NaN }, { windowTokens: 0 },
    ]) expect(estimateHorizon({ ...base, ...overrides })).toBeNull();
    expect(economicGate({ ...base, requestsPerBoundary: [] }).reason).toBe("horizon_unavailable");
  });
  it("matches first and subsequent break-even equality and strict rejection", () => {
    const first = economicGate({ ...base, writeTokens: 3000 });
    expect(first).toMatchObject({ compact: true, reason: "economic", savingTokens: 1000,
      rebuildCostTokens: 6000, breakevenRequests: 6, combinedBreakeven: 6, expectedRemainingRequests: 3 });
    expect(economicGate({ ...base, writeTokens: 3001 }).reason).toBe("deferred_first");
    const state = { version: 1 as const, compactions: 1, carriedDebtTokens: 1000 };
    expect(economicGate({ ...base, state }).compact).toBe(true); // 2*1.5=3, combined=3
    expect(economicGate({ ...base, state, writeTokens: 1001 }).reason).toBe("deferred_margin");
    expect(economicGate({ ...base, state: { ...state, carriedDebtTokens: 1001 } }).reason).toBe("deferred_debt");
    expect(economicGate({ ...base, state: { ...state, compactions: 0, carriedDebtTokens: 1e9 } }).compact).toBe(true);
  });
  it("does not fake unknown costs, debt, saving or prices; ratio below one floors incremental cost", () => {
    expect(economicGate({ ...base, cacheWriteReadRatio: null })).toMatchObject({ compact: false,
      reason: "cache_ratio_unavailable", rebuildCostTokens: null, breakevenRequests: null });
    expect(economicGate({ ...base, writeTokens: null }).reason).toBe("deferred_cost_unavailable");
    expect(economicGate({ ...base, state: { version: 1, compactions: 1, carriedDebtTokens: null } }).reason).toBe("deferred_cost_unavailable");
    expect(economicGate({ ...base, archiveTokens: null })).toMatchObject({ compact: false, savingTokens: null });
    expect(economicGate({ ...base, memoTokens: 1100 }).reason).toBe("non_positive_saving");
    expect(economicGate({ ...base, memoTokens: 1200 }).reason).toBe("non_positive_saving");
    expect(economicGate({ ...base, cacheWriteReadRatio: 0.5 })).toMatchObject({ compact: true, rebuildCostTokens: 0, breakevenRequests: 0 });
    expect(economicGate(base, { subsequentCompactionMargin: 0 }).reason).toBe("deferred_invalid_input");
  });
  it("hard window overrides every economic decline at exact reserve threshold", () => {
    const at = base.windowTokens - 16384;
    const bad: Partial<EconomicInput>[] = [
      { writeTokens: 1e12 }, { cacheWriteReadRatio: null }, { writeTokens: null },
      { requestsPerBoundary: [] }, { state: { version: 1, compactions: 1, carriedDebtTokens: null } },
      { state: { version: 1, compactions: -1, carriedDebtTokens: NaN } },
    ];
    for (const overrides of bad) {
      expect(economicGate({ ...base, ...overrides, contextTokens: at })).toMatchObject({ compact: true, reason: "window_protection", windowProtection: true });
    }
    expect(economicGate({ ...base, cacheWriteReadRatio: null, contextTokens: at - 1 }).compact).toBe(false);
    expect(economicGate({ ...base, cacheWriteReadRatio: null, hardWindowProtection: true }).compact).toBe(true);
    // Expanding/unknown candidate is rejected, but explicit hard fallback flag must survive.
    expect(economicGate({ ...base, contextTokens: at, memoTokens: 1200 })).toMatchObject({ compact: false, windowProtection: true, reason: "non_positive_saving" });
    expect(economicGate({ ...base, hardWindowProtection: true, archiveTokens: null })).toMatchObject({ compact: false, windowProtection: true });
  });
});

describe("serializable debt recovery", () => {
  it("replays and resumes exactly, repays only observed savings, never mutates input", () => {
    const actions: EconomicAction[] = [
      { type: "compacted", writeTokens: 1000, cacheWriteReadRatio: 3 },
      { type: "request_repaid", savedTokens: 500 },
      { type: "request_repaid", savedTokens: null },
      { type: "compacted", writeTokens: 100, cacheWriteReadRatio: 3 },
      { type: "request_repaid", savedTokens: 700 },
    ];
    const initial = Object.freeze(initialEconomicState());
    const checkpoint = replayEconomicState(actions.slice(0, 2), initial);
    expect(checkpoint.carriedDebtTokens).toBe(1500);
    const restored = JSON.parse(JSON.stringify(checkpoint));
    const resumed = replayEconomicState(actions.slice(2), restored);
    expect(resumed).toEqual(replayEconomicState(actions));
    expect(resumed).toEqual({ version: 1, compactions: 2, carriedDebtTokens: 1000 });
    expect(economicGate({ ...base, state: resumed })).toEqual(economicGate({ ...base, state: replayEconomicState(actions) }));
    expect(initial).toEqual(initialEconomicState());
    expect(restored).toEqual(checkpoint);
    expect(reduceEconomicState(resumed, { type: "request_repaid", savedTokens: 1e6 }).carriedDebtTokens).toBe(0);
  });
  it("unknown rebuild debt survives restart/repayment; invalid state fails visibly", () => {
    const state = replayEconomicState([{ type: "compacted", writeTokens: 100, cacheWriteReadRatio: null }]);
    expect(state.carriedDebtTokens).toBeNull();
    expect(reduceEconomicState(JSON.parse(JSON.stringify(state)), { type: "request_repaid", savedTokens: 10000 }).carriedDebtTokens).toBeNull();
    expect(reduceEconomicState({ version: 1, compactions: 1, carriedDebtTokens: 20 }, { type: "request_repaid", savedTokens: -3 }).carriedDebtTokens).toBe(20);
    expect(() => replayEconomicState([], { version: 1, compactions: -1, carriedDebtTokens: 0 })).toThrow();
  });
});

describe("trusted progress boundaries", () => {
  it("requires all approved files, fresh verify and complete verify pair before cutting", () => {
    const events: AgentEvent[] = [user, ...approved, call("a"), result("a"), call("b", "edit_file", "b.ts"), result("b"), call("v", "verify"), proof("v")];
    expect(deriveBoundaries(events.slice(0, -1))).toEqual([1]); // verify call still pending
    expect(deriveBoundaries(events)).toEqual([1, 10]); // loop's terminal success has no generic result
    events.push(result("v"));
    expect(deriveProgressBoundaries(events)).toEqual([{ tailStart: 1, kind: "user" }, { tailStart: 11, kind: "verified" }]);
    events.push(user);
    expect(deriveBoundaries(events)).toEqual([1, 11]);
    expect(deriveBoundaries(JSON.parse(JSON.stringify(events)))).toEqual(deriveBoundaries(events));
    expect(snapToProgressBoundary(15, deriveBoundaries(events))).toBe(11);
    expect(snapToProgressBoundary(9, deriveBoundaries(events))).toBe(1);
    expect(snapToProgressBoundary(5, [])).toBeNull();
  });
  it("ignores assistant completion claims, failed/orphan verification, and empty evidence", () => {
    expect(deriveBoundaries([{ type: "assistant_message", content: "All files done. verify_result(ok=true)." }])).toEqual([]);
    expect(deriveBoundaries([call("a"), result("a"), proof("v")])).toEqual([]);
    expect(deriveBoundaries([call("a"), result("a"), call("v", "verify"), proof("v", false), result("v")])).toEqual([]);
    const empty: AgentEvent = { type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 1, results: [] };
    expect(deriveBoundaries([call("a"), result("a"), call("v", "verify"), empty, result("v")])).toEqual([]);
    expect(deriveBoundaries([call("a"), result("a"), call("v", "verify"), proof("v"), result("v", false)])).toEqual([]);
  });
  it("will not cut an unfinished plan/pair, failed write, stale verify, or worker pair", () => {
    const incomplete = [...approved, call("a"), result("a"), call("v", "verify"), proof("v"), result("v"), user];
    expect(deriveBoundaries(incomplete)).toEqual([]); // b.ts not written
    expect(deriveBoundaries([call("a"), user])).toEqual([]);
    expect(deriveBoundaries([call("a"), result("a", false), call("v", "verify"), proof("v"), result("v")])).toEqual([]);
    expect(deriveBoundaries([call("a"), call("v", "verify"), proof("v"), result("a"), result("v")])).toEqual([]);
    const worker = [call("a"), result("a"), call("v", "verify"), proof("v"), result("v")].map((e) => ({ ...e, agent_id: "worker" }));
    expect(deriveBoundaries(worker)).toEqual([]);
    expect(deriveBoundaries([call("a"), { ...result("a"), agent_id: "worker" } as AgentEvent, user])).toEqual([]);
  });
  it("supports verify evidence after result but rejects duplicate IDs and stale reused proof", () => {
    expect(deriveBoundaries([call("a"), result("a"), call("v", "verify"), result("v"), proof("v")])).toEqual([6]);
    expect(deriveBoundaries([call("a"), result("a"), call("a"), result("a"), user])).toEqual([]);
    expect(deriveBoundaries([proof("v"), call("a"), result("a"), call("v", "verify"), result("v")])).toEqual([]);
    expect(deriveBoundaries([result("orphan"), user])).toEqual([]);
    expect(snapToProgressBoundary(NaN, [1])).toBeNull();
  });
});

it("does not credit pre-approval writes or retain coverage after a failed rewrite", () => {
  const verify = [call("v", "verify"), proof("v")];
  expect(deriveBoundaries([call("a"), ...approved, result("a"), call("b", "write_file", "b.ts"), result("b"), ...verify])).toEqual([]);
  expect(deriveBoundaries([...approved, call("a"), result("a"), call("b", "write_file", "b.ts"), result("b"),
    call("rewrite"), result("rewrite", false), ...verify])).toEqual([]);
});
