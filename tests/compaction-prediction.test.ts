import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compactionPrefixDigest,
  shouldStartCompactionPrediction,
  validatePrediction,
  type PredictiveCompactionCandidate,
} from "../src/agent/compaction-prediction";
import {
  DEFAULT_COMPACTION_CONFIG,
  estimateContextTokens,
  type CompactionConfig,
} from "../src/agent/compaction";
import { projectContext } from "../src/agent/context";
import { createSessionProvider } from "../src/agent/session-provider";
import {
  createEventLog,
  replay,
  type AgentEvent,
  type CompactionEvent,
} from "../src/events";

const event = (content: string): AgentEvent => ({ type: "user_message", content });

const compaction: CompactionEvent = {
  type: "compaction",
  trigger: "auto",
  reason: "threshold",
  compressed_event_ids: [2],
  summary: "sum",
  summary_offset: 3,
  tokens_before: 100,
  tokens_after: 20,
};

function candidate(events: readonly AgentEvent[]): PredictiveCompactionCandidate {
  return {
    event: compaction,
    baseEventCount: events.length,
    prefixDigest: compactionPrefixDigest(events),
    modelKey: "model-a",
    createdAt: 1_000,
  };
}

describe("validatePrediction", () => {
  it("accepts append-only growth after the snapshot", () => {
    const snapshot = [event("one"), event("two")];
    expect(validatePrediction(candidate(snapshot), {
      events: [...snapshot, event("later")],
      modelKey: "model-a",
      now: 1_005,
      maxAgeMs: 10,
    })).toEqual({ ok: true });
  });

  it("rejects a rewritten prefix", () => {
    const snapshot = [event("one"), event("two")];
    expect(validatePrediction(candidate(snapshot), {
      events: [event("one"), event("changed")],
      modelKey: "model-a",
      now: 1_005,
      maxAgeMs: 10,
    })).toEqual({ ok: false, reason: "history-changed" });
  });

  it("rejects a changed model and an expired candidate", () => {
    const snapshot = [event("one")];
    const base = candidate(snapshot);
    expect(validatePrediction(base, {
      events: snapshot,
      modelKey: "model-b",
      now: 1_005,
      maxAgeMs: 10,
    })).toEqual({ ok: false, reason: "model-changed" });
    expect(validatePrediction(base, {
      events: snapshot,
      modelKey: "model-a",
      now: 1_011,
      maxAgeMs: 10,
    })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a later compaction even when the prefix bytes are unchanged", () => {
    const snapshot = [event("one")];
    expect(validatePrediction(candidate(snapshot), {
      events: [...snapshot, compaction],
      modelKey: "model-a",
      now: 1_005,
      maxAgeMs: 10,
    })).toEqual({ ok: false, reason: "history-changed" });
  });
});

describe("shouldStartCompactionPrediction", () => {
  const config = {
    ...DEFAULT_COMPACTION_CONFIG,
    inputLimit: 1_000,
    maxOutputReserve: 100,
    ratio: 0.7,
  };

  it("starts only in the warm band below the normal trigger", () => {
    expect(shouldStartCompactionPrediction({ estimateTokens: 500, config })).toBe(false);
    expect(shouldStartCompactionPrediction({ estimateTokens: 505, config })).toBe(true);
    expect(shouldStartCompactionPrediction({ estimateTokens: 629, config })).toBe(true);
    expect(shouldStartCompactionPrediction({ estimateTokens: 630, config })).toBe(false);
  });

  it("never starts for invalid budgets or a custom warm ratio outside (0,1)", () => {
    expect(shouldStartCompactionPrediction({ estimateTokens: 505, config, warmRatio: 1 })).toBe(false);
    expect(shouldStartCompactionPrediction({ estimateTokens: Number.NaN, config })).toBe(false);
    expect(shouldStartCompactionPrediction({
      estimateTokens: 505,
      config: { ...config, inputLimit: 100, maxOutputReserve: 100 },
    })).toBe(false);
  });
});

const SUMMARY = "## Objective\n- preserve the task\n## Work State\n### Active\n- continue";

function smallConfig(overrides: Partial<CompactionConfig> = {}): CompactionConfig {
  return {
    ...DEFAULT_COMPACTION_CONFIG,
    inputLimit: 1_000,
    maxOutputReserve: 100,
    ratio: 0.7,
    tailMinTokens: 1,
    tailMaxTokens: 50,
    summaryCapTokens: 500,
    retryBackoffMs: 1,
    ...overrides,
  };
}

function warmEvents(): AgentEvent[] {
  return [
    { type: "user_message", content: "goal" },
    { type: "assistant_message", content: "a".repeat(800) },
    { type: "assistant_message", content: "b".repeat(800) },
    { type: "assistant_message", content: "c".repeat(300) },
  ];
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForPredictionUsage(logPath: string): Promise<Extract<AgentEvent, { type: "usage" }>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    const found = (await replay(logPath)).find(
      (event): event is Extract<AgentEvent, { type: "usage" }> =>
        event.type === "usage" && event.source === "compaction_prediction",
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("prediction usage was not recorded");
}

async function drain(provider: ReturnType<typeof createSessionProvider>): Promise<void> {
  for await (const _event of provider.stream([], [])) {
    // Direct provider use: the loop normally owns event persistence.
  }
}

describe("session provider predictive compaction", () => {
  it("adopts an append-only candidate without a second summarizer call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "compaction-prediction-integration-"));
    try {
      const logPath = join(dir, "session.jsonl");
      const initial = warmEvents();
      const config = smallConfig();
      const estimate = estimateContextTokens(projectContext(initial), {}, 4);
      expect(estimate).toBeGreaterThanOrEqual(505);
      expect(estimate).toBeLessThan(630);
      const log = createEventLog(logPath);
      for (const event of initial) await log.append(event);
      await log.close?.();

      let summaryCalls = 0;
      const summarizer = async () => {
        summaryCalls += 1;
        return {
          text: SUMMARY,
          usage: { inputTokens: 40, outputTokens: 9 },
          model: "summary-fixture",
        };
      };
      async function* mainTransport() {
        yield { type: "assistant_delta" as const, callId: "main", text: "ok" };
      }
      const provider = createSessionProvider(logPath, {
        workspace: dir,
        map: false,
        transport: mainTransport,
        compaction: {
          summarizer,
          config,
          prediction: { enabled: true, startRatio: 0.8, maxAgeMs: 60_000 },
        },
      });

      await drain(provider);
      await waitFor(() => summaryCalls === 1);
      const predictionUsage = await waitForPredictionUsage(logPath);
      expect(predictionUsage).toMatchObject({ inputTokens: 40, outputTokens: 9 });

      const grow = createEventLog(logPath);
      await grow.append({ type: "assistant_message", content: "d".repeat(600) });
      await grow.close?.();

      await drain(provider);
      const final = await replay(logPath);
      const compactions = final.filter((event): event is CompactionEvent => event.type === "compaction");
      expect(summaryCalls).toBe(1);
      expect(compactions).toHaveLength(1);
      expect(compactions[0]?.usage).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an expired candidate, accounts its usage, and falls back synchronously", async () => {
    const dir = await mkdtemp(join(tmpdir(), "compaction-prediction-expired-"));
    try {
      const logPath = join(dir, "session.jsonl");
      const initial = warmEvents();
      const config = smallConfig();
      const log = createEventLog(logPath);
      for (const event of initial) await log.append(event);
      await log.close?.();

      let summaryCalls = 0;
      const summarizer = async () => {
        summaryCalls += 1;
        return {
          text: SUMMARY,
          usage: { inputTokens: 20, outputTokens: 5 },
          model: "summary-fixture",
        };
      };
      async function* mainTransport() {
        yield { type: "assistant_delta" as const, callId: "main", text: "ok" };
      }
      const provider = createSessionProvider(logPath, {
        workspace: dir,
        map: false,
        transport: mainTransport,
        compaction: {
          summarizer,
          config,
          prediction: { enabled: true, startRatio: 0.8, maxAgeMs: 0 },
        },
      });

      await drain(provider);
      await waitFor(() => summaryCalls === 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const grow = createEventLog(logPath);
      await grow.append({ type: "assistant_message", content: "d".repeat(600) });
      await grow.close?.();

      await drain(provider);
      const final = await replay(logPath);
      expect(summaryCalls).toBe(2);
      expect(final.filter((event) => event.type === "compaction")).toHaveLength(1);
      expect(final.filter(
        (event) => event.type === "usage" && event.source === "compaction_prediction",
      )).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

