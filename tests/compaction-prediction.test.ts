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

async function drain(provider: ReturnType<typeof createSessionProvider>, signal?: AbortSignal): Promise<void> {
  for await (const _event of provider.stream([], [], signal ? { signal } : undefined)) {
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
      const compactTriggers: string[] = [];
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
          onPreCompact: async (trigger) => { compactTriggers.push(trigger); },
        },
      });

      await drain(provider);
      await waitFor(() => summaryCalls === 1);
      const predictionUsage = await waitForPredictionUsage(logPath);
      expect(predictionUsage).toMatchObject({ inputTokens: 40, outputTokens: 9 });
      expect(compactTriggers).toEqual([]);

      const grow = createEventLog(logPath);
      await grow.append({ type: "assistant_message", content: "d".repeat(600) });
      await grow.close?.();

      await drain(provider);
      const final = await replay(logPath);
      const compactions = final.filter((event): event is CompactionEvent => event.type === "compaction");
      expect(summaryCalls).toBe(1);
      expect(compactions).toHaveLength(1);
      expect(compactions[0]?.usage).toBeUndefined();
      expect(compactTriggers).toEqual(["auto"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces a prediction when a large new tail would immediately trigger another compaction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "compaction-prediction-tail-"));
    const logPath = join(dir, "session.jsonl");
    const log = createEventLog(logPath);
    try {
      const config = smallConfig();
      await log.append(event("keep this goal " + "x".repeat(1_470)));
      await log.append({ type: "assistant_message", content: "a".repeat(630) });
      let summaryCalls = 0;
      const provider = createSessionProvider(logPath, {
        workspace: dir, map: false,
        transport: async function* () { yield { type: "assistant_delta", callId: "main", text: "ok" }; },
        compaction: {
          config, prediction: { enabled: true },
          summarizer: async () => ({
            text: ++summaryCalls === 1 ? SUMMARY : SUMMARY + "\n- re-evaluated the new tail",
            usage: { inputTokens: 40, outputTokens: 9 },
          }),
        },
      });
      await drain(provider);
      await waitForPredictionUsage(logPath);
      const newTail = "b".repeat(1_200);
      await log.append({ type: "assistant_message", content: newTail });
      await drain(provider);

      const records = (await replay(logPath)).filter((entry) => entry.type === "compaction");
      expect(summaryCalls).toBe(2);
      expect(records).toHaveLength(1);
      expect(records[0]?.summary).toContain("re-evaluated the new tail");
      expect(records[0]?.tokens_after).toBeLessThan(630);
      expect(JSON.stringify(projectContext(await replay(logPath)))).not.toContain(newTail);
    } finally {
      await log.close?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  // #34：预测摘要挂起时，run 取消必须能立刻收束，且不把取消后的 usage/候选落进事件流。
  it("预测摘要收到 signal；等待中取消不落 usage、不采纳候选", async () => {
    const dir = await mkdtemp(join(tmpdir(), "compaction-prediction-abort-"));
    try {
      const logPath = join(dir, "session.jsonl");
      const initial = warmEvents();
      const config = smallConfig();
      const log = createEventLog(logPath);
      for (const event of initial) await log.append(event);
      await log.close?.();

      const controller = new AbortController();
      let started: (() => void) | null = null;
      let summarizerCalls = 0;
      let sawSignal = false;
      const waiting = new Promise<void>((resolve) => { started = resolve; });
      const summarizer = async (input: { signal?: AbortSignal }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> => {
        summarizerCalls++;
        sawSignal = input.signal === controller.signal;
        started?.();
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) return resolve();
          input.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { text: SUMMARY, usage: { inputTokens: 99, outputTokens: 9 } };
      };
      async function* mainTransport() { yield { type: "assistant_delta" as const, callId: "main", text: "ok" }; }
      const provider = createSessionProvider(logPath, {
        workspace: dir,
        map: false,
        transport: mainTransport,
        compaction: { summarizer, config, prediction: { enabled: true, startRatio: 0.8, maxAgeMs: 60_000 } },
      });

      // 第一轮：预热区只起预测任务，不进入 auto 触发；把 signal 递进 startPrediction。
      const first = drain(provider, controller.signal);
      await first;
      await waiting;
      expect(summarizerCalls).toBe(1);
      expect(sawSignal, "预测摘要没拿到本轮 signal").toBe(true);

      // 第二轮把估算推到 auto 档：它必须 await 挂起的 predictionTask；取消后立刻返回。
      const grow = createEventLog(logPath);
      await grow.append({ type: "assistant_message", content: "d".repeat(600) });
      await grow.close?.();
      const second = drain(provider, controller.signal);
      let cancelled: unknown = null;
      // 主请求链在轮界按取消收束（throwIfAborted）：判的是「立刻收束」而不是「假装成功」。
      const secondFinished = second.then(
        () => "done" as const,
        (err: unknown) => { cancelled = err; return "cancelled" as const; },
      );
      await new Promise((r) => setTimeout(r, 10));
      const startedWait = Date.now();
      controller.abort();
      await expect(Promise.race([
        secondFinished,
        new Promise<string>((r) => setTimeout(() => r("timeout"), 1_000)),
      ])).resolves.toBe("cancelled");
      expect(cancelled, "取消必须沿 run 信号上抛，不许被吞成正常收场").toBeTruthy();
      expect(Date.now() - startedWait, "取消后不该等摘要器返回").toBeLessThan(900);
      await new Promise((r) => setTimeout(r, 20));
      const final = await replay(logPath);
      expect(final.filter((e) => e.type === "usage" && e.source === "compaction_prediction")).toEqual([]);
      expect(final.filter((e) => e.type === "compaction")).toEqual([]);
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

