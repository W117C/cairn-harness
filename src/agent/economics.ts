import type { AgentEvent, PlanProposal, ToolCallEvent } from "../events";

export interface EconomicConfig {
  windowReserveTokens: number;
  firstCompactionRequestScale: number;
  subsequentCompactionMargin: number;
  remainingRequestScale: number;
  remainingRequestStddevK: number;
}
export const DEFAULT_ECONOMIC_CONFIG: Readonly<EconomicConfig> = Object.freeze({
  windowReserveTokens: 16_384,
  firstCompactionRequestScale: 2,
  subsequentCompactionMargin: 1.5,
  remainingRequestScale: 1,
  remainingRequestStddevK: 0,
});
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const known = (n: number | null | undefined): number | null => valid(n) ? n : null;

export interface HorizonInput {
  /** Observed requests per COMPLETED trusted boundary, not assistant step claims. */
  requestsPerBoundary: readonly number[];
  remainingBoundaries: number | null;
  windowTokens: number;
  contextTokens: number;
  avgIncrementTokens: number | null;
}
/** Population stddev; sparse samples are discounted by 0.5. A missing growth
 * estimate leaves the boundary forecast unclamped, never invents a growth rate. */
export function estimateHorizon(input: HorizonInput, config: Partial<EconomicConfig> = {}): number | null {
  const c = { ...DEFAULT_ECONOMIC_CONFIG, ...config };
  const samples = input.requestsPerBoundary;
  if (!samples.length || samples.some((x) => !valid(x)) || !valid(input.remainingBoundaries) ||
      !Number.isInteger(input.remainingBoundaries) || !valid(input.windowTokens) || input.windowTokens === 0 ||
      !valid(input.contextTokens) || !valid(c.remainingRequestScale) || !valid(c.remainingRequestStddevK) ||
      (input.avgIncrementTokens !== null && !valid(input.avgIncrementTokens))) return null;
  const mean = samples.reduce((a, b) => a + b / samples.length, 0);
  const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2 / samples.length, 0));
  const lowerBound = Math.max(0, mean - c.remainingRequestStddevK * stddev) * (samples.length < 3 ? 0.5 : 1);
  let horizon = 1 + Math.floor(lowerBound * input.remainingBoundaries * c.remainingRequestScale);
  if (input.avgIncrementTokens !== null && input.avgIncrementTokens > 0) {
    horizon = Math.min(horizon, Math.max(0, Math.floor((input.windowTokens - input.contextTokens) / input.avgIncrementTokens)));
  }
  return Number.isFinite(horizon) ? horizon : null;
}

/** Explicit JSON state. Persist alongside successful compaction and subsequent
 * observed request repayments, or replay those same actions with reduceEconomicState.
 * Debt is cache-read-token-equivalent cost, NOT dollars or claimed token savings. */
export interface EconomicState {
  version: 1;
  compactions: number;
  carriedDebtTokens: number | null;
}
export function initialEconomicState(): EconomicState { return { version: 1, compactions: 0, carriedDebtTokens: 0 }; }
function validState(s: EconomicState): boolean {
  return s.version === 1 && Number.isSafeInteger(s.compactions) && s.compactions >= 0 &&
    (s.carriedDebtTokens === null || valid(s.carriedDebtTokens));
}
export type EconomicAction =
  | { type: "compacted"; writeTokens: number | null; cacheWriteReadRatio: number | null }
  | { type: "request_repaid"; /** Observed saving, NOT forecast × horizon. */ savedTokens: number | null };
export function reduceEconomicState(state: EconomicState, action: EconomicAction): EconomicState {
  if (!validState(state)) throw new TypeError("Invalid economic state");
  if (action.type === "compacted") {
    const write = known(action.writeTokens), ratio = known(action.cacheWriteReadRatio);
    const cost = write === null || ratio === null ? null : known(write * Math.max(0, ratio - 1));
    const previous = state.compactions === 0 ? 0 : state.carriedDebtTokens;
    const debt = previous === null || cost === null ? null : known(previous + cost);
    if (!Number.isSafeInteger(state.compactions + 1)) throw new RangeError("Compaction count overflow");
    return { version: 1, compactions: state.compactions + 1, carriedDebtTokens: debt };
  }
  if (action.type !== "request_repaid") throw new TypeError("Unknown economic action");
  const saved = known(action.savedTokens);
  // Missing evidence cannot pay down debt. Once cost is unknown, only a replay
  // with recovered evidence can make it known; a restart must not reset it to zero.
  return { ...state, carriedDebtTokens: state.carriedDebtTokens === null || saved === null
    ? state.carriedDebtTokens : Math.max(0, state.carriedDebtTokens - saved) };
}
export function replayEconomicState(actions: readonly EconomicAction[], initial = initialEconomicState()): EconomicState {
  if (!validState(initial)) throw new TypeError("Invalid economic state");
  return actions.reduce(reduceEconomicState, { ...initial });
}
export interface EconomicInput extends HorizonInput {
  archiveTokens: number | null;
  memoTokens: number | null;
  writeTokens: number | null;
  /** No default 12.5: caller must supply a trusted provider/config ratio. */
  cacheWriteReadRatio: number | null;
  state: EconomicState;
  /** Existing hard-budget guard has priority even if the economic inputs are bad. */
  hardWindowProtection?: boolean;
}
export type EconomicReason = "economic" | "window_protection" | "deferred_invalid_input" |
  "deferred_cost_unavailable" | "deferred_first" | "deferred_margin" | "deferred_debt" |
  "horizon_unavailable" | "cache_ratio_unavailable" | "non_positive_saving";
export interface EconomicDecision {
  compact: boolean;
  reason: EconomicReason;
  /** ALWAYS run the existing hard-window fallback when true, even if compact=false
   * because the candidate expands/has unknown size. Never send an over-budget body. */
  windowProtection: boolean;
  savingTokens: number | null;
  rebuildCostTokens: number | null;
  breakevenRequests: number | null;
  combinedBreakeven: number | null;
  expectedRemainingRequests: number | null;
}
/** Pure candidate gate, used AFTER legacy trigger; does not enable the feature,
 * choose a cut, execute a summary, or mutate debt on a declined/failed candidate. */
export function economicGate(input: EconomicInput, config: Partial<EconomicConfig> = {}): EconomicDecision {
  const c = { ...DEFAULT_ECONOMIC_CONFIG, ...config };
  const windowProtection = input.hardWindowProtection === true ||
    (valid(input.contextTokens) && valid(input.windowTokens) && input.windowTokens > 0 &&
      input.contextTokens >= input.windowTokens - (valid(c.windowReserveTokens) ? c.windowReserveTokens : DEFAULT_ECONOMIC_CONFIG.windowReserveTokens));
  const archive = known(input.archiveTokens), memo = known(input.memoTokens);
  const savingTokens = archive === null || memo === null ? null : archive - memo;
  const write = known(input.writeTokens), ratio = known(input.cacheWriteReadRatio);
  const rebuildCostTokens = write === null || ratio === null ? null : known(write * Math.max(0, ratio - 1));
  const breakevenRequests = savingTokens !== null && savingTokens > 0 && rebuildCostTokens !== null
    ? known(rebuildCostTokens / savingTokens) : null;
  const debt = validState(input.state) ? input.state.compactions === 0 ? 0 : input.state.carriedDebtTokens : null;
  const combinedBreakeven = savingTokens !== null && savingTokens > 0 && rebuildCostTokens !== null && debt !== null
    ? known((debt + rebuildCostTokens) / savingTokens) : null;
  const expectedRemainingRequests = estimateHorizon(input, c);
  const result = (compact: boolean, reason: EconomicReason): EconomicDecision => ({
    compact, reason, windowProtection, savingTokens, rebuildCostTokens, breakevenRequests,
    combinedBreakeven, expectedRemainingRequests,
  });
  if (savingTokens === null) return result(false, "deferred_invalid_input");
  if (savingTokens <= 0) return result(false, "non_positive_saving");
  // Hard window wins over EVERY economic rejection, including invalid/unknown costs and debt.
  if (windowProtection) return result(true, "window_protection");
  if (!validState(input.state) || Object.values(c).some((v) => !valid(v)) ||
      c.firstCompactionRequestScale <= 0 || c.subsequentCompactionMargin < 1) return result(false, "deferred_invalid_input");
  if (ratio === null) return result(false, "cache_ratio_unavailable");
  if (breakevenRequests === null || combinedBreakeven === null) return result(false, "deferred_cost_unavailable");
  if (expectedRemainingRequests === null) return result(false, "horizon_unavailable");
  if (input.state.compactions === 0) {
    return breakevenRequests <= expectedRemainingRequests * c.firstCompactionRequestScale
      ? result(true, "economic") : result(false, "deferred_first");
  }
  if (breakevenRequests * c.subsequentCompactionMargin > expectedRemainingRequests) return result(false, "deferred_margin");
  if (combinedBreakeven > expectedRemainingRequests) return result(false, "deferred_debt");
  return result(true, "economic");
}

export interface ProgressBoundary {
  /** 1-based event ID at which retained tail may start; N+1 means after last event. */
  tailStart: number;
  kind: "verified" | "user";
}
/** Rebuild from trusted host events only. Assistant prose is never parsed. Worker
 * events cannot close main-stream pairs. Verification must have a matching verify
 * call and fresh successful evidence after completed work, with no in-flight tool.
 * The loop's terminal successful verify_result is itself a completion (no generic
 * tool_result is emitted on that path). When a generic result exists, wait for it.
 * Approved plans additionally require all paths covered by successful write/edit
 * pairs since approval. User turns cannot cut an unfinished plan/pair.
 */
export function deriveProgressBoundaries(events: readonly AgentEvent[]): ProgressBoundary[] {
  const out: ProgressBoundary[] = [];
  const pending = new Map<string, { call: ToolCallEvent; at: number }>();
  const resultIds = new Set(events.filter((e) => e.type === "tool_result" && !e.agent_id)
    .map((e) => (e as Extract<AgentEvent, { type: "tool_result" }>).callId));
  const usedIds = new Set<string>();
  const proposals = new Map<string, PlanProposal>();
  const unresolvedPlans = new Set<string>();
  const verifications = new Map<string, { ok: boolean; at: number }>();
  const verifyResults = new Map<string, { callAt: number; resultAt: number; ok: boolean }>();
  let plan: { paths: Set<string>; covered: Set<string>; approvedAt: number } | null = null;
  let completed = 0, lastWorkAt = -1;
  let malformed = false;
  const planCovered = () => plan === null || [...plan.paths].every((p) => plan!.covered.has(p));
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if ("agent_id" in e && e.agent_id !== undefined) continue;
    if (e.type === "plan_proposed") {
      proposals.set(e.callId, structuredClone(e.plan));
      unresolvedPlans.add(e.callId);
    } else if (e.type === "plan_approved") {
      const proposal = proposals.get(e.callId);
      if (!proposal || !unresolvedPlans.has(e.callId)) { malformed = true; continue; }
      unresolvedPlans.delete(e.callId);
      if (e.approved) {
        plan = { paths: new Set(proposal.files.map((f) => f.path)), covered: new Set(), approvedAt: i };
        completed = 0;
        lastWorkAt = i;
      }
    } else if (e.type === "tool_call") {
      if (usedIds.has(e.id)) { malformed = true; continue; }
      usedIds.add(e.id);
      pending.set(e.id, { call: e, at: i });
    } else if (e.type === "tool_result") {
      const pair = pending.get(e.callId);
      if (!pair) { malformed = true; continue; }
      pending.delete(e.callId);
      if (pair.call.name === "verify") {
        verifyResults.set(e.callId, { callAt: pair.at, resultAt: i, ok: e.ok });
      } else {
        lastWorkAt = i; // failed work also invalidates older verification evidence
        const path = pair.call.args.path;
        if (plan && (pair.call.name === "write_file" || pair.call.name === "edit_file") && typeof path === "string") {
          if (e.ok && pair.at > plan.approvedAt) plan.covered.add(path);
          else plan.covered.delete(path);
        }
        if (e.ok) {
          completed++;
        }
      }
    } else if (e.type === "verify_result") {
      // Require actual successful command evidence, not an empty vacuous `every`.
      const ok = e.ok && e.results.length > 0 && e.results.every((r) => r.ok);
      verifications.set(e.callId, { ok, at: i });
      const terminal = pending.get(e.callId);
      if (ok && terminal?.call.name === "verify" && !resultIds.has(e.callId)) {
        pending.delete(e.callId);
        verifyResults.set(e.callId, { callAt: terminal.at, resultAt: i, ok: true });
      }
    } else if (e.type === "user_message") {
      if (!malformed && pending.size === 0 && unresolvedPlans.size === 0 && plan === null) {
        out.push({ tailStart: i + 1, kind: "user" });
        completed = 0;
        lastWorkAt = i;
      }
    }
    if (malformed || pending.size || unresolvedPlans.size || !completed || !planCovered()) continue;
    // Only the arriving verify_result or matching tool_result may create the boundary.
    if (e.type !== "verify_result" && e.type !== "tool_result") continue;
    const proof = verifications.get(e.callId), pair = verifyResults.get(e.callId);
    if (proof?.ok && pair?.ok && pair.callAt > lastWorkAt && proof.at >= pair.callAt) {
      out.push({ tailStart: Math.max(proof.at, pair.resultAt) + 2, kind: "verified" });
      plan = null;
      completed = 0;
      lastWorkAt = i;
    }
  }
  return out;
}
export function deriveBoundaries(events: readonly AgentEvent[]): number[] {
  return [...new Set(deriveProgressBoundaries(events).map((b) => b.tailStart))];
}
/** Only move backwards to a trusted boundary (retain more context). Null means
 * no safe economic cut; callers must keep existing keep-first/excluded/atomic-unit
 * rules and hard-window fallback. Disabled callers should not invoke this policy. */
export function snapToProgressBoundary(tailStart: number, boundaries: readonly number[]): number | null {
  if (!Number.isSafeInteger(tailStart) || tailStart < 1) return null;
  let best: number | null = null;
  for (const b of boundaries) if (Number.isSafeInteger(b) && b >= 1 && b <= tailStart && (best === null || b > best)) best = b;
  return best;
}
