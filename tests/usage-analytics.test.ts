import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scanUsageFile, type UsageFileCache } from "../src/main/usage-ledger-scan";

const dir = mkdtempSync(join(tmpdir(), "cairn-usage-analytics-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const line = (row: unknown) => JSON.stringify(row) + "\n";

describe("usage analytics from the raw log", () => {
  it("groups real timestamps across days, includes worker usage, and leaves missing dates/models unknown", async () => {
    const file = join(dir, "days.jsonl");
    const first = new Date(2026, 9, 20, 23, 59).getTime();
    const next = new Date(2026, 9, 21, 0, 1).getTime();
    writeFileSync(file, [
      { type: "session_meta", session_id: "days", lineage: { parent: "other", boundary: 20 } },
      { type: "user_message", content: "hi", ts: first },
      { type: "usage", inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 40, model: "model-a", ts: first },
      { type: "usage", inputTokens: 30, outputTokens: 5, agent_id: "worker-1", model: "model-b", ts: next },
      { type: "usage", inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, ts: next },
      { type: "usage", inputTokens: 7, outputTokens: 2 },
    ].map(line).join(""));
    const result = await scanUsageFile(file);
    expect(result.analytics?.buckets).toEqual([
      { day: "2026-10-20", model: "model-a", inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, usageCount: 1, workerUsageCount: 0, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 1 },
      { day: "2026-10-21", model: "model-b", inputTokens: 30, outputTokens: 5, cacheReadTokens: 0, usageCount: 1, workerUsageCount: 1, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 0 },
      { day: "2026-10-21", model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 1, workerUsageCount: 0, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 1 },
      { day: null, model: null, inputTokens: 7, outputTokens: 2, cacheReadTokens: 0, usageCount: 1, workerUsageCount: 0, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 0 },
    ]);
    expect(result.analytics?.activity).toEqual([
      { day: "2026-10-20", sessions: 1, rounds: 1, toolSteps: 0 },
      { day: "2026-10-21", sessions: 1, rounds: 0, toolSteps: 0 },
      { day: null, sessions: 1, rounds: 0, toolSteps: 0 },
    ]);
    // A pointer's parent's usage is never read or copied into this session.
    expect(result.totals.inputTokens).toBe(137);
  });

  it("distinguishes absent/invalid token fields from explicit zero without counting cache twice", async () => {
    const file = join(dir, "missing.jsonl");
    writeFileSync(file, [
      { type: "usage", inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, model: "zero", ts: 0 },
      { type: "usage", model: "  ", ts: "2026-10-20" },
      { type: "usage", inputTokens: -2, outputTokens: "8", cacheReadInputTokens: -4 },
    ].map(line).join(""));
    const result = await scanUsageFile(file);
    expect(result.totals).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 3 });
    expect(result.analytics?.buckets[0]).toMatchObject({ inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 1, model: "zero" });
    expect(result.analytics?.buckets[1]).toMatchObject({ day: null, model: null, usageCount: 2, inputMeasured: 0, outputMeasured: 0, cacheReadMeasured: 0 });
  });

  it("keeps cached analytics isolated from callers and refreshes appended data; bad rows remain visible", async () => {
    const file = join(dir, "cache.jsonl");
    writeFileSync(file, line({ type: "usage", inputTokens: 4, outputTokens: 1, model: "a" }) + "{broken}\n");
    const cache: UsageFileCache = new Map();
    const first = await scanUsageFile(file, cache);
    expect(first.analytics?.buckets[0]?.inputTokens).toBe(4);
    first.analytics!.buckets[0]!.inputTokens = 999;
    first.analytics!.activity.length = 0;
    const second = await scanUsageFile(file, cache);
    expect(second.analytics?.buckets[0]?.inputTokens).toBe(4);
    expect(second.analytics?.activity).toHaveLength(1);
    expect(second.badLines).toBe(1);
    appendFileSync(file, line({ type: "usage", inputTokens: 2, outputTokens: 1, model: "b" }));
    const third = await scanUsageFile(file, cache);
    expect(third.analytics?.buckets).toHaveLength(2);
    expect(third.totals.inputTokens).toBe(6);
    expect(third.badLines).toBe(1);
  });

  it("records activity with no usage without inventing measurements or worker conversation rounds", async () => {
    const file = join(dir, "activity.jsonl");
    writeFileSync(file, [
      { type: "user_message", content: "hi", ts: new Date(2026, 9, 22, 12).getTime() },
      { type: "user_message", content: "worker", agent_id: "w", ts: new Date(2026, 9, 23, 12).getTime() },
      { type: "tool_call", name: "read_file" },
    ].map(line).join(""));
    const result = await scanUsageFile(file);
    expect(result.analytics?.buckets).toEqual([]);
    expect(result.analytics?.activity).toEqual([
      { day: "2026-10-22", sessions: 1, rounds: 1, toolSteps: 0 },
      { day: null, sessions: 1, rounds: 0, toolSteps: 1 },
    ]);
  });
});
