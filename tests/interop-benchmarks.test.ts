import { describe, expect, it } from "vitest";
import {
  adaptHarborTasks,
  adaptTerminalBenchTasks,
  recordUsage,
  runExternalBenchmark,
  toExternalRunRecord,
  type ExternalRunEvidence,
} from "../src/interop/benchmarks";

const DATASET = { datasetVersion: "harbor@2026.10" };

describe("external benchmark adapters", () => {
  it("adapts Harbor-style tasks and keeps absent seed/budget as unknown, not zero", () => {
    const result = adaptHarborTasks([
      {
        task_id: "harbor-1",
        instruction: "Fix the failing test in /app and prove it passes.",
        repo: "acme/widget",
        commit: "abc123",
        seed: 7,
        max_agent_timeout_sec: 900,
        token_budget: 100_000,
        max_cost_usd: 2.5,
      },
      {
        id: "harbor-2",
        description: "No seed and no budgets on this one.",
      },
    ], DATASET);
    expect(result.errors).toEqual([]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toMatchObject({
      benchmark: "harbor",
      datasetVersion: "harbor@2026.10",
      taskId: "harbor-1",
      seed: 7,
      timeoutSec: 900,
      tokenBudget: 100_000,
      dollarBudget: 2.5,
      source: "acme/widget@abc123",
    });
    expect(result.tasks[1]).toMatchObject({ taskId: "harbor-2", seed: null, timeoutSec: null, tokenBudget: null, dollarBudget: null });
  });

  it("adapts Terminal-Bench-style fields and rejects malformed or duplicate entries", () => {
    const result = adaptTerminalBenchTasks([
      {
        task_id: "tb-1",
        instruction: "Make the build green.",
        difficulty: "medium",
        category: "build",
        tags: ["ci"],
        max_agent_timeout_sec: 600,
        max_test_timeout_sec: 60,
      },
      { task_id: "tb-1", instruction: "duplicate" },
      { task_id: "tb-2", instruction: "   " },
      { task_id: "tb-3", instruction: "bad timeout", max_agent_timeout_sec: -1 },
    ], { datasetVersion: "tb@1" });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ taskId: "tb-1", timeoutSec: 600, benchmark: "terminal-bench" });
    expect(result.errors.join("\n")).toContain("重复");
    expect(result.errors.join("\n")).toContain("缺指令");
    expect(result.errors.join("\n")).toContain("非负有限数字");
  });

  it("records failures, interruptions, and missing usage without substituting zero", () => {
    const task = adaptHarborTasks([{ task_id: "t", instruction: "go" }], DATASET).tasks[0]!;
    const failed = toExternalRunRecord(task, {
      model: "m", provider: "p", toolPolicy: "read-only", startedAt: 0, finishedAt: 10,
    }, { outcome: "failed", failure: "boom" });
    expect(failed).toMatchObject({ outcome: "failed", failure: "boom", interruption: null });
    expect(failed.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      dollars: null,
      unknown: ["inputTokens", "outputTokens", "dollars"],
    });

    const interrupted = toExternalRunRecord(task, {
      model: "m", provider: "p", toolPolicy: "read-only", startedAt: 0, finishedAt: 10,
    }, { outcome: "interrupted", interruption: "network partition", usage: { inputTokens: 12 } });
    expect(interrupted).toMatchObject({ outcome: "interrupted", failure: null, interruption: "network partition" });
    expect(interrupted.usage).toEqual({
      inputTokens: 12,
      outputTokens: null,
      dollars: null,
      unknown: ["outputTokens", "dollars"],
    });

    expect(recordUsage({ inputTokens: Number.NaN, outputTokens: -1, dollars: 0.5 })).toEqual({
      inputTokens: null,
      outputTokens: null,
      dollars: 0.5,
      unknown: ["inputTokens", "outputTokens"],
    });

    const unknown = toExternalRunRecord(task, {
      model: "m", provider: "p", toolPolicy: "read-only", startedAt: 0, finishedAt: 10,
    }, { outcome: "unknown" });
    expect(unknown).toMatchObject({ outcome: "unknown", failure: null, interruption: null });
    expect(unknown.usage.unknown).toEqual(["inputTokens", "outputTokens", "dollars"]);
  });

  it("runs each task exactly once and preserves the first failed result", async () => {
    const tasks = adaptTerminalBenchTasks([
      { task_id: "ok", instruction: "works", max_agent_timeout_sec: 30 },
      { task_id: "bad", instruction: "fails" },
      { task_id: "cut", instruction: "interrupted" },
    ], { datasetVersion: "tb@1" }).tasks;
    const calls: string[] = [];
    let clock = 0;
    const records = await runExternalBenchmark({
      tasks,
      model: "model-x",
      provider: "provider-y",
      toolPolicy: "default",
      now: () => (clock += 5),
      async execute(task) {
        calls.push(task.taskId);
        if (task.taskId === "ok") {
          return { outcome: "succeeded" as ExternalRunEvidence["outcome"], usage: { inputTokens: 10, outputTokens: 5, dollars: 0.01 } };
        }
        if (task.taskId === "bad") throw new Error("test failed");
        return { outcome: "interrupted" as ExternalRunEvidence["outcome"], interruption: "timeout" };
      },
    });
    expect(calls).toEqual(["ok", "bad", "cut"]);
    expect(records.map((r) => [r.taskId, r.outcome])).toEqual([
      ["ok", "succeeded"],
      ["bad", "failed"],
      ["cut", "interrupted"],
    ]);
    expect(records[1]).toMatchObject({ failure: "test failed", model: "model-x", provider: "provider-y", toolPolicy: "default" });
    expect(records[1]!.usage.unknown).toEqual(["inputTokens", "outputTokens", "dollars"]);
    expect(records[2]).toMatchObject({ interruption: "timeout" });
    expect(records[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 5, dollars: 0.01, unknown: [] });
    expect(records[0]!.durationMs).toBe(5);
  });

  it("classifies an AbortError as interrupted, not failed", async () => {
    const tasks = adaptHarborTasks([{ task_id: "t", instruction: "go" }], DATASET).tasks;
    const records = await runExternalBenchmark({
      tasks,
      model: "m",
      provider: "p",
      toolPolicy: "default",
      now: () => 1,
      async execute() {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    });
    expect(records[0]).toMatchObject({ outcome: "interrupted", failure: null, interruption: "aborted" });
  });
});
