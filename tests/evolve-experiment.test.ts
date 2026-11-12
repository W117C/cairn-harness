import { describe, expect, it } from "vitest";
import {
  aggregateExperimentSamplesBySession,
  analyzeExperiment,
  assignArm,
  checkExperimentBudget,
  formatExperimentAnalysis,
  validateExperiment,
  type ExperimentRecord,
  type ExperimentSample,
} from "../src/agent/evolve/experiment";
import { projectEpisode } from "../src/agent/evolve/episode";
import type { AgentEvent } from "../src/events";

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

  it("按分配单元（sessionId）聚合多轮 Episode，防同一会话重复膨胀样本量并追踪实际暴露", () => {
    const exp = record({ minSamplesPerArm: 2, maxSamplesPerArm: 10 });
    const makeEp = (
      sessionId: string,
      ts: number,
      arm: "control" | "treatment",
      ok: boolean,
      injected: string[],
      usd: number | null = 0.05,
    ) => {
      const ep = projectEpisode({
        events: [
          { type: "user_message", content: `修 bug ${sessionId}-${ts}` } as AgentEvent,
          {
            type: "verify_result",
            callId: "v1",
            ok,
            attempt: 1,
            maxAttempts: 1,
            results: [{ command: "pnpm test", ok, output: ok ? "ok" : "fail" }],
          } as AgentEvent,
          { type: "usage", inputTokens: 100, outputTokens: 20 } as AgentEvent,
        ],
        workspace: "/w",
        sessionId,
        logPath: `/w/${sessionId}-${ts}.jsonl`,
        observedAt: ts,
        assignment: {
          source: "sidecar",
          experimentId: exp.id,
          arm,
          propensity: 0.5,
          policyVersion: "evolve-v1",
          injectedExperienceIds: injected,
          injectedChars: injected.length * 40,
        },
      });
      return { ...ep, cost: { ...ep.cost, usd } };
    };

    // 同一治疗会话 s-treat 跑了 3 轮（先红后绿）：应聚合成 1 个独立会话样本、结局取最后可判定轮（success=true）、成本累加
    const episodes = [
      makeEp("s-treat-1", 1_000, "treatment", false, [exp.candidateRef], 0.02),
      makeEp("s-treat-1", 2_000, "treatment", false, [exp.candidateRef], 0.03),
      makeEp("s-treat-1", 3_000, "treatment", true, [exp.candidateRef], 0.05),
      makeEp("s-treat-2", 4_000, "treatment", true, [], 0.04), // 未实际注入候选（exposed=false）
      makeEp("s-ctrl-1", 5_000, "control", false, [], 0.03),
      makeEp("s-ctrl-2", 6_000, "control", false, [], 0.03),
    ];

    const agg = aggregateExperimentSamplesBySession(exp, episodes);
    expect(agg.totalRuns).toBe(6);
    expect(agg.samples).toHaveLength(4); // 4 个独立会话，不是 6 条 Episode
    expect(agg.totalUsd).toBeCloseTo(0.2, 5);
    const analysis = analyzeExperiment(exp, agg.samples, agg.unknownEpisodes, {
      unknownControl: agg.unknownControl,
      unknownTreatment: agg.unknownTreatment,
      totalRuns: agg.totalRuns,
    });
    expect(analysis.nControl).toBe(2);
    expect(analysis.nTreatment).toBe(2);
    expect(analysis.exposedTreatment).toBe(1);
    expect(analysis.coverageControl).toBe(1);
    expect(analysis.coverageTreatment).toBe(1);
  });

  it("实验预算守门：maxRuns / maxUsd（含不可定价 fail-closed）/ maxWallMs 耗尽时收束为 unmeasurable", () => {
    const expUsd = record({
      minSamplesPerArm: 5,
      budget: { maxRuns: 20, maxUsd: 0.5, maxWallMs: 10_000 },
    });
    // 不可定价 run 在设了 maxUsd 时必须 fail-closed
    expect(checkExperimentBudget(expUsd, { totalRuns: 2, totalUsd: null, hasUnpricedRuns: true }).exhausted).toBe(true);
    // 美元超限
    expect(checkExperimentBudget(expUsd, { totalRuns: 2, totalUsd: 0.5, hasUnpricedRuns: false }).exhausted).toBe(true);
    // 时长超限
    expect(checkExperimentBudget(expUsd, { totalRuns: 2, totalUsd: 0.1, hasUnpricedRuns: false, now: 12_000 }).exhausted).toBe(true);

    // 样本未达标但 maxRuns 已耗尽 ⇒ unmeasurable / keep-old（不再无限 keep-running）
    const exhaustedAnalysis = analyzeExperiment(
      record({ minSamplesPerArm: 10, budget: { maxRuns: 6, maxUsd: null, maxWallMs: null } }),
      samples(2, 2, 3),
      0,
    );
    expect(exhaustedAnalysis.status).toBe("unmeasurable");
    expect(exhaustedAnalysis.decision).toBe("keep-old");
    expect(exhaustedAnalysis.reason).toContain("最大运行预算");
  });
});
