import { searchHistory, type HistorySearchEntry } from "./history-search";
import { estimateTextTokens } from "./text-budget";
import { selectRecall, type RecallInput } from "./memory/retrieval";
import { selectRecallHybrid, type EmbeddingProvider } from "./memory/semantic";
import {
  DEFAULT_COMPACTION_CONFIG,
  runCompaction,
  type CompactionConfig,
  type Summarizer,
} from "./compaction";
import {
  compactionPrefixDigest,
  validatePrediction,
  type PredictiveCompactionCandidate,
} from "./compaction-prediction";
import type { AgentEvent } from "../events";

export interface ContextQualityMemoryCase {
  id: string;
  query: string;
  expectedTopic: string;
  queryVector: readonly number[];
  candidates: ReadonlyArray<{
    topic: string;
    type: string;
    digest: string;
    body: string;
    vector: readonly number[];
  }>;
}

export interface ContextQualityHistoryCase {
  id: string;
  query: string;
  expectedEventId: number;
  entries: ReadonlyArray<{
    eventId: number;
    event: AgentEvent;
  }>;
}

export interface ContextQualityCompactionCase {
  id: string;
  assistantChunks: readonly number[];
  summarizer: "success" | "failure";
}

export interface ContextQualityCases {
  version: 1;
  memory: readonly ContextQualityMemoryCase[];
  history: readonly ContextQualityHistoryCase[];
  compaction: readonly ContextQualityCompactionCase[];
}

export interface ContextQualityRow {
  caseId: string;
  arm: "lexical" | "hybrid" | "history" | "sync" | "prediction";
  hit: boolean;
  returnedTokens: number;
  latencyMs: number;
  failed: boolean;
  unknown: string[];
}

export interface ContextQualityReport {
  version: 1;
  rows: ContextQualityRow[];
  summary: {
    total: number;
    hits: number;
    failed: number;
    byArm: Record<string, {
      total: number;
      hits: number;
      failed: number;
      avgReturnedTokens: number;
      avgLatencyMs: number;
    }>;
  };
}

const QUALITY_UNKNOWN = "non-real-provider semantic quality";

function tokensOfText(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + estimateTextTokens(text), 0);
}

async function timed<T>(now: () => number, fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = now();
  const value = await fn();
  return { value, latencyMs: Math.max(0, now() - start) };
}

function candidateInputs(testCase: ContextQualityMemoryCase): RecallInput[] {
  return testCase.candidates.map((candidate) => ({
    topic: candidate.topic,
    type: candidate.type,
    digest: candidate.digest,
    body: candidate.body,
  }));
}

function fixtureEmbedder(testCase: ContextQualityMemoryCase): EmbeddingProvider {
  return {
    id: "context-quality-fixture",
    async embed(texts) {
      return texts.map((text, index) => {
        if (index === 0) return testCase.queryVector;
        return testCase.candidates[index - 1]?.vector ?? [0, 1];
      });
    },
  };
}

function compactionEvents(testCase: ContextQualityCompactionCase): AgentEvent[] {
  return [
    { type: "user_message", content: "goal" },
    ...testCase.assistantChunks.map((size): AgentEvent => ({
      type: "assistant_message",
      content: "x".repeat(size),
    })),
  ];
}

function compactionConfig(): CompactionConfig {
  return {
    ...DEFAULT_COMPACTION_CONFIG,
    inputLimit: 1_000,
    maxOutputReserve: 100,
    ratio: 0.7,
    tailMinTokens: 1,
    tailMaxTokens: 50,
    summaryCapTokens: 500,
    retryBackoffMs: 1,
  };
}

function summarizerFor(testCase: ContextQualityCompactionCase): Summarizer {
  return async () => {
    if (testCase.summarizer === "failure") throw new Error("fixture summarizer failed");
    return {
      text: "## Objective\n- preserve the task\n## Work State\n### Active\n- continue",
      usage: { inputTokens: 40, outputTokens: 9 },
      model: "fixture-summary",
    };
  };
}

function failedCompactionRow(
  caseId: string,
  arm: "sync" | "prediction",
  latencyMs: number,
): ContextQualityRow {
  return {
    caseId,
    arm,
    hit: false,
    returnedTokens: 0,
    latencyMs,
    failed: true,
    unknown: ["summarizer-failed", QUALITY_UNKNOWN],
  };
}

export async function runContextQualityEvaluation(
  cases: ContextQualityCases,
  deps: { now?: () => number } = {},
): Promise<ContextQualityReport> {
  const now = deps.now ?? (() => performance.now());
  const rows: ContextQualityRow[] = [];

  for (const testCase of cases.memory) {
    const candidates = candidateInputs(testCase);
    const lexical = await timed(now, async () => selectRecall(testCase.query, candidates));
    rows.push({
      caseId: testCase.id,
      arm: "lexical",
      hit: lexical.value.some((pick) => pick.topic === testCase.expectedTopic),
      returnedTokens: tokensOfText(lexical.value.map((pick) => pick.excerpt)),
      latencyMs: lexical.latencyMs,
      failed: false,
      unknown: [QUALITY_UNKNOWN],
    });

    const hybrid = await timed(now, async () => await selectRecallHybrid(testCase.query, candidates, {
      embedding: { provider: fixtureEmbedder(testCase) },
    }));
    rows.push({
      caseId: testCase.id,
      arm: "hybrid",
      hit: hybrid.value.picks.some((pick) => pick.topic === testCase.expectedTopic),
      returnedTokens: tokensOfText(hybrid.value.picks.map((pick) => pick.excerpt)),
      latencyMs: hybrid.latencyMs,
      failed: false,
      unknown: [QUALITY_UNKNOWN],
    });
  }

  for (const testCase of cases.history) {
    const entries: HistorySearchEntry[] = testCase.entries.map((entry) => ({
      event: entry.event,
      ref: { workspace: "/fixture", sessionId: testCase.id, eventId: entry.eventId },
    }));
    const history = await timed(now, async () => searchHistory({ entries, query: testCase.query }));
    rows.push({
      caseId: testCase.id,
      arm: "history",
      hit: history.value.kind !== "unavailable" &&
        history.value.hits.some((hit) => hit.ref.eventId === testCase.expectedEventId),
      returnedTokens: history.value.kind === "unavailable"
        ? 0
        : tokensOfText(history.value.hits.map((hit) => hit.excerpt)),
      latencyMs: history.latencyMs,
      failed: history.value.kind === "unavailable",
      unknown: history.value.kind === "unavailable" ? [history.value.reason] : [QUALITY_UNKNOWN],
    });
  }

  for (const testCase of cases.compaction) {
    const events = compactionEvents(testCase);
    const config = compactionConfig();
    const sync = await timed(now, async () => await runCompaction({
      events,
      trigger: "auto",
      reason: "threshold",
      summarizer: summarizerFor(testCase),
      config,
    }));
    if (!sync.value.ok) {
      rows.push(failedCompactionRow(testCase.id, "sync", sync.latencyMs));
    } else {
      rows.push({
        caseId: testCase.id,
        arm: "sync",
        hit: true,
        returnedTokens: estimateTextTokens(sync.value.event.summary),
        latencyMs: sync.latencyMs,
        failed: false,
        unknown: [QUALITY_UNKNOWN],
      });
    }

    const candidateBuild = await timed(now, async () => await runCompaction({
      events,
      trigger: "auto",
      reason: "threshold",
      summarizer: summarizerFor(testCase),
      config,
      prediction: true,
    }));
    if (!candidateBuild.value.ok) {
      rows.push(failedCompactionRow(testCase.id, "prediction", candidateBuild.latencyMs));
      continue;
    }
    const candidate: PredictiveCompactionCandidate = {
      event: candidateBuild.value.event,
      baseEventCount: events.length,
      prefixDigest: compactionPrefixDigest(events),
      modelKey: "fixture-model",
      createdAt: 0,
    };
    const adopted = await timed(now, async () => validatePrediction(candidate, {
      events,
      modelKey: "fixture-model",
      now: 0,
      maxAgeMs: 1,
    }));
    rows.push({
      caseId: testCase.id,
      arm: "prediction",
      hit: adopted.value.ok,
      returnedTokens: estimateTextTokens(candidate.event.summary),
      latencyMs: adopted.latencyMs,
      failed: !adopted.value.ok,
      unknown: adopted.value.ok
        ? ["candidate-build-latency-excluded-from-request", QUALITY_UNKNOWN]
        : [adopted.value.reason, QUALITY_UNKNOWN],
    });
  }

  const byArm: ContextQualityReport["summary"]["byArm"] = {};
  for (const row of rows) {
    const bucket = byArm[row.arm] ?? {
      total: 0,
      hits: 0,
      failed: 0,
      avgReturnedTokens: 0,
      avgLatencyMs: 0,
    };
    bucket.total += 1;
    if (row.hit) bucket.hits += 1;
    if (row.failed) bucket.failed += 1;
    bucket.avgReturnedTokens += row.returnedTokens;
    bucket.avgLatencyMs += row.latencyMs;
    byArm[row.arm] = bucket;
  }
  for (const bucket of Object.values(byArm)) {
    bucket.avgReturnedTokens /= bucket.total;
    bucket.avgLatencyMs /= bucket.total;
  }
  return {
    version: 1,
    rows,
    summary: {
      total: rows.length,
      hits: rows.filter((row) => row.hit).length,
      failed: rows.filter((row) => row.failed).length,
      byArm,
    },
  };
}

