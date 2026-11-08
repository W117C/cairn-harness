import { createHash } from "node:crypto";
import type { AgentEvent, CompactionEvent } from "../events";
import type { CompactionConfig } from "./compaction";

export interface PredictiveCompactionCandidate {
  event: CompactionEvent;
  baseEventCount: number;
  prefixDigest: string;
  modelKey: string;
  createdAt: number;
}

export type PredictionRejection = "history-changed" | "model-changed" | "expired";

export const DEFAULT_PREDICTION_WARM_RATIO = 0.8;
export const DEFAULT_PREDICTION_MAX_AGE_MS = 10 * 60_000;

export function compactionPrefixDigest(events: readonly AgentEvent[]): string {
  return createHash("sha256").update(JSON.stringify(events)).digest("hex");
}

/**
 * Prediction is useful only in the band before the synchronous trigger. At or
 * above the trigger the normal compaction path must run immediately.
 */
export function shouldStartCompactionPrediction(input: {
  estimateTokens: number;
  config: CompactionConfig;
  warmRatio?: number;
}): boolean {
  const ratio = input.warmRatio ?? DEFAULT_PREDICTION_WARM_RATIO;
  const available = input.config.inputLimit - input.config.maxOutputReserve;
  if (!Number.isFinite(input.estimateTokens) || !Number.isFinite(available) || available <= 0) return false;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return false;
  const triggerAt = available * input.config.ratio;
  const warmAt = triggerAt * ratio;
  return Number.isFinite(triggerAt) && input.estimateTokens >= warmAt && input.estimateTokens < triggerAt;
}

export function validatePrediction(
  candidate: PredictiveCompactionCandidate,
  current: {
    events: readonly AgentEvent[];
    modelKey: string;
    now: number;
    maxAgeMs: number;
  },
):
  | { ok: true }
  | { ok: false; reason: PredictionRejection } {
  if (!Number.isSafeInteger(candidate.baseEventCount) ||
      candidate.baseEventCount < 0 ||
      candidate.baseEventCount > current.events.length) {
    return { ok: false, reason: "history-changed" };
  }
  if (compactionPrefixDigest(current.events.slice(0, candidate.baseEventCount)) !== candidate.prefixDigest) {
    return { ok: false, reason: "history-changed" };
  }
  if (current.events.slice(candidate.baseEventCount).some((event) => event.type === "compaction")) {
    return { ok: false, reason: "history-changed" };
  }
  if (candidate.modelKey !== current.modelKey) return { ok: false, reason: "model-changed" };
  if (!Number.isFinite(candidate.createdAt) ||
      !Number.isFinite(current.now) ||
      !Number.isFinite(current.maxAgeMs) ||
      current.maxAgeMs < 0 ||
      current.now < candidate.createdAt ||
      current.now - candidate.createdAt > current.maxAgeMs) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

