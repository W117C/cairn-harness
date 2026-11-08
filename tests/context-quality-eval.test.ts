import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runContextQualityEvaluation,
  type ContextQualityCases,
} from "../src/agent/context-quality-eval";

async function fixedCases(): Promise<ContextQualityCases> {
  const path = join(process.cwd(), "fixtures", "context-quality", "cases.json");
  return JSON.parse(await readFile(path, "utf8")) as ContextQualityCases;
}

describe("context quality paired evaluation", () => {
  it("reports every arm with hit, tokens, latency, failure, and unknown fields", async () => {
    let clock = 0;
    const report = await runContextQualityEvaluation(await fixedCases(), {
      now: () => {
        clock += 5;
        return clock;
      },
    });
    const arms = new Set(report.rows.map((row) => row.arm));
    expect(arms).toEqual(new Set(["lexical", "hybrid", "history", "sync", "prediction"]));
    for (const row of report.rows) {
      expect(row).toEqual(expect.objectContaining({
        caseId: expect.any(String),
        arm: expect.any(String),
        hit: expect.any(Boolean),
        returnedTokens: expect.any(Number),
        latencyMs: expect.any(Number),
        failed: expect.any(Boolean),
        unknown: expect.any(Array),
      }));
      expect(row.latencyMs).toBeGreaterThanOrEqual(0);
      expect(row.returnedTokens).toBeGreaterThanOrEqual(0);
    }

    const memoryRows = report.rows.filter((row) => row.caseId === "paraphrase-runbook");
    expect(memoryRows.find((row) => row.arm === "lexical")?.hit).toBe(false);
    expect(memoryRows.find((row) => row.arm === "hybrid")?.hit).toBe(true);
    expect(report.rows.find((row) => row.arm === "history")?.hit).toBe(true);
  });

  it("preserves a failed compaction as failed with a reason rather than zero usage", async () => {
    const report = await runContextQualityEvaluation(await fixedCases(), {
      now: (() => {
        let time = 0;
        return () => {
          time += 1;
          return time;
        };
      })(),
    });
    const failed = report.rows.filter(
      (row) => row.caseId === "compaction-failure" && (row.arm === "sync" || row.arm === "prediction"),
    );
    expect(failed).toHaveLength(2);
    expect(failed.every((row) => row.failed)).toBe(true);
    expect(failed.every((row) => row.unknown.includes("summarizer-failed"))).toBe(true);
  });

  it("summarizes paired arms without hiding failures in a single score", async () => {
    const report = await runContextQualityEvaluation(await fixedCases(), {
      now: (() => {
        let time = 0;
        return () => ++time;
      })(),
    });
    expect(report.summary.total).toBe(report.rows.length);
    expect(report.summary.failed).toBeGreaterThan(0);
    expect(report.summary.byArm.hybrid?.hits).toBe(1);
    expect(report.summary.byArm.lexical?.hits).toBe(0);
  });
});

