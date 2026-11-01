import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateOffline,
  mcnemarExactP,
  type OfflineRun,
  type OfflineTask,
} from "../src/agent/evolve/offline-eval";
import { newCandidate } from "../src/agent/evolve/candidates";
import { createCandidate, loadCandidate } from "../src/main/evolve/candidate-store";
import { recordOfflineEvaluation } from "../src/main/evolve/offline-eval-store";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

function tasks(n: number, split: OfflineTask["split"] = "holdout"): OfflineTask[] {
  return Array.from({ length: n }, (_, index) => ({ id: "t" + String(index), split }));
}

function runs(taskIds: readonly OfflineTask[], pass: (index: number) => boolean, cost = 1): OfflineRun[] {
  return taskIds.map((task, index) => ({ taskId: task.id, ok: pass(index), costUsd: cost }));
}

describe("McNemar 精确检验", () => {
  it("全不一致 0/10 显著；五五开不显著", () => {
    expect(mcnemarExactP(0, 10)).toBeLessThan(0.05);
    expect(mcnemarExactP(5, 5)).toBe(1);
    expect(mcnemarExactP(0, 0)).toBe(1);
  });
});

describe("离线配对评估", () => {
  it("holdout 全过且显著优于基线 ⇒ passed / promote，并产出安全评分", () => {
    const holdout = tasks(10);
    const baseline = runs(holdout, (index) => index < 2);
    const candidate = runs(holdout, () => true);
    const result = evaluateOffline({ tasks: holdout, baseline, candidate });
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("promote");
    expect(result.holdoutScores?.success).toBe(1);
    expect(result.holdoutScores?.safety).toBe("pass");
    expect(result.mcnemarP).toBeLessThan(0.05);
    expect(result.regressions).toEqual([]);
  });

  it("基线过而候选挂 ⇒ failed，点名回归任务", () => {
    const holdout = tasks(10);
    const baseline = runs(holdout, () => true);
    const candidate = runs(holdout, (index) => index !== 0);
    const result = evaluateOffline({ tasks: holdout, baseline, candidate });
    expect(result.status).toBe("failed");
    expect(result.decision).toBe("keep-old");
    expect(result.regressions).toEqual(["t0"]);
    expect(result.holdoutScores?.safety).toBe("fail");
  });

  it("没有 holdout 分片 ⇒ unmeasurable，不许晋升", () => {
    const search = tasks(5, "search");
    const result = evaluateOffline({
      tasks: search,
      baseline: runs(search, () => true),
      candidate: runs(search, () => true),
    });
    expect(result.status).toBe("unmeasurable");
    expect(result.decision).toBe("keep-old");
    expect(result.reason).toContain("holdout");
  });

  it("有不可测 run ⇒ unmeasurable，不折成失败", () => {
    const holdout = tasks(5);
    const baseline = runs(holdout, () => true);
    const candidate = runs(holdout, () => true).map((run, index) => index === 0 ? { ...run, ok: null } : run);
    const result = evaluateOffline({ tasks: holdout, baseline, candidate });
    expect(result.status).toBe("unmeasurable");
    expect(result.decision).toBe("keep-old");
    expect(result.reason).toContain("不可测");
  });

  it("正确性不劣且成本显著更低 ⇒ passed / promote", () => {
    const holdout = tasks(5);
    const baseline = runs(holdout, () => true, 10);
    const candidate = runs(holdout, () => true, 5);
    const result = evaluateOffline({ tasks: holdout, baseline, candidate, minCostImprovement: 0.1 });
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("promote");
    expect(result.holdoutScores?.costUsd).toBe(25);
    expect(result.reason).toContain("成本");
  });
});

describe("离线评估落候选档案", () => {
  it("passed 评估把候选从 evaluating 推到 passed，并写入 holdout 评分", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "evolve-offline-"));
    workspaces.push(workspace);
    const candidate = newCandidate({
      workspace,
      operator: "manual",
      target: { kind: "experience", id: "exp_0123456789abcdef" },
      body: "candidate body",
      evidence: ["ep_1"],
      status: "evaluating",
      now: 1_000,
    });
    await createCandidate(workspace, candidate);

    const holdout = tasks(10);
    const recorded = await recordOfflineEvaluation(workspace, candidate.id, {
      tasks: holdout,
      baseline: runs(holdout, (index) => index < 2),
      candidate: runs(holdout, () => true),
    }, 2_000);

    expect(recorded.candidate.status).toBe("passed");
    expect(recorded.candidate.eval.holdout?.success).toBe(1);
    expect(recorded.candidate.eval.holdout?.safety).toBe("pass");
    expect((await loadCandidate(workspace, candidate.id))?.status).toBe("passed");
  });

  it("没有 holdout 的评估只把候选留在 evaluating，不伪造 passed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "evolve-offline-"));
    workspaces.push(workspace);
    const candidate = newCandidate({
      workspace,
      operator: "manual",
      target: { kind: "experience", id: "exp_0123456789abcdef" },
      body: "candidate body",
      evidence: ["ep_1"],
      status: "evaluating",
      now: 1_000,
    });
    await createCandidate(workspace, candidate);
    const search = tasks(3, "search");
    const recorded = await recordOfflineEvaluation(workspace, candidate.id, {
      tasks: search,
      baseline: runs(search, () => true),
      candidate: runs(search, () => true),
    }, 2_000);
    expect(recorded.result.status).toBe("unmeasurable");
    expect(recorded.candidate.status).toBe("evaluating");
    expect(recorded.candidate.eval.holdout).toBeNull();
  });
});
