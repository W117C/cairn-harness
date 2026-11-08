import { describe, expect, it } from "vitest";
import {
  analyzeExperiment,
  assignArm,
  formatExperimentAnalysis,
  validateExperiment,
  type ExperimentRecord,
  type ExperimentSample,
} from "../src/agent/evolve/experiment";

function record(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    v: 1,
    id: "ex1",
    workspace: "/w",
    hypothesis: "在 debug 任务上注入候选会提高成功率",
    candidateRef: "exp_0123456789abcdef",
    control: "current-active",
    taskFilter: { class: ["debug"] },
    treatmentPct: 0.5,
    minSamplesPerArm: 10,
    maxSamplesPerArm: 20,
    decisionRule: {
      kind: "superiority",
      minRiskDiff: 0,
      minCostImprovement: 0.1,
      requireNoRegression: true,
    },
    budget: { maxRuns: 40, maxUsd: null, maxWallMs: null },
    status: "running",
    createdAt: 1_000,
    approvedBy: "owner",
    ...overrides,
  };
}

function samples(controlSuccess: number, treatmentSuccess: number, n = 10): ExperimentSample[] {
  const out: ExperimentSample[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ episodeId: "c" + String(i), arm: "control", success: i < controlSuccess, tokens: 100 });
    out.push({ episodeId: "t" + String(i), arm: "treatment", success: i < treatmentSuccess, tokens: 100 });
  }
  return out;
}

describe("实验分配", () => {
  it("同一实验+会话稳定，分配大致平衡", () => {
    const first = assignArm("ex1", "session-a", 0.5);
    expect(assignArm("ex1", "session-a", 0.5)).toEqual(first);
    expect(["control", "treatment"]).toContain(first.arm);
    expect(first.propensity).toBe(0.5);

    let treatment = 0;
    for (let i = 0; i < 1_000; i += 1) {
      if (assignArm("ex1", "s" + String(i), 0.5).arm === "treatment") treatment += 1;
    }
    expect(treatment).toBeGreaterThan(400);
    expect(treatment).toBeLessThan(600);
  });

  it("拒绝越界分配比例与形状", () => {
    expect(validateExperiment(record())).toEqual([]);
    expect(validateExperiment(record({ treatmentPct: 0.9 })).join("\n")).toContain("treatmentPct");
    expect(validateExperiment(record({ candidateRef: "bad" })).join("\n")).toContain("candidateRef");
  });
});

describe("实验分析", () => {
  it("治疗臂显著更好 ⇒ passed / suggest-promote（不自动晋升）", () => {
    const result = analyzeExperiment(record(), samples(2, 9));
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("suggest-promote");
    expect(result.nControl).toBe(10);
    expect(result.nTreatment).toBe(10);
    expect(result.riskDiff).toBeCloseTo(0.7, 5);
    expect(result.ci95![0]).toBeGreaterThan(0);
    expect(formatExperimentAnalysis(result)).toContain("suggest-promote");
  });

  it("治疗臂显著更差 ⇒ failed / stop", () => {
    const result = analyzeExperiment(record(), samples(9, 2));
    expect(result.status).toBe("failed");
    expect(result.decision).toBe("stop");
    expect(result.ci95![1]).toBeLessThan(0);
  });

  it("样本不足 ⇒ running；到了上限仍无法区分 ⇒ unmeasurable", () => {
    const running = analyzeExperiment(record(), samples(1, 1, 3));
    expect(running.status).toBe("running");
    expect(running.decision).toBe("keep-running");

    const inconclusive = analyzeExperiment(record({ maxSamplesPerArm: 10 }), samples(5, 5, 10));
    expect(inconclusive.status).toBe("unmeasurable");
    expect(inconclusive.decision).toBe("keep-old");
    expect(inconclusive.ci95![0]).toBeLessThan(0);
    expect(inconclusive.ci95![1]).toBeGreaterThan(0);
  });

  it("未知结局多于可判定样本 ⇒ unmeasurable，不拿已知样本下结论", () => {
    const result = analyzeExperiment(record(), samples(2, 9), 100);
    expect(result.status).toBe("unmeasurable");
    expect(result.decision).toBe("keep-old");
    expect(result.unknownEpisodes).toBe(100);
  });
});
