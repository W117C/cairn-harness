import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { newCandidate, type CandidateRecord, type CandidateScores } from "../src/agent/evolve/candidates";
import { projectEpisode } from "../src/agent/evolve";
import { newExperience, type ExperienceEntry, type PlaybookOp } from "../src/agent/evolve/playbook";
import type { ExperimentRecord } from "../src/agent/evolve/experiment";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { createExperiment, analyzeExperimentById } from "../src/main/evolve/experiment-store";
import { candidatePathFor, createCandidate, listCandidates, loadCandidate, saveCandidate } from "../src/main/evolve/candidate-store";
import { createCandidateFromExperiment } from "../src/main/evolve/experiment-candidate";
import { PROMOTION_GATES, promoteCandidateToSema } from "../src/main/evolve/promotion";
import { openEvolutionRegistry } from "../src/main/evolution/activation-host";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-promotion-"));
  workspaces.push(workspace);
  return workspace;
}

function addOp(entry: ExperienceEntry): PlaybookOp {
  return { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
}

async function seedPlaybook(workspace: string, body = "candidate body"): Promise<ExperienceEntry> {
  const candidate = newExperience({
    id: "exp_0123456789abcdef",
    kind: "strategy",
    scope: { workspace },
    trigger: { when: "always" },
    body,
    now: 1_000,
  });
  await appendPlaybookEvents(workspace, [addOp(candidate)]);
  return candidate;
}

function syntheticCandidate(
  workspace: string,
  body = "candidate body",
  status: CandidateRecord["status"] = "passed",
  holdout: CandidateScores | null = { success: 0.9, costUsd: 1, latencyMs: 100, safety: "pass" },
): CandidateRecord {
  return newCandidate({
    workspace,
    operator: "manual",
    target: { kind: "experience", id: "exp_0123456789abcdef" },
    body,
    evidence: ["ep_1"],
    status,
    eval: { holdout },
    now: 2_000,
  });
}

function experiment(workspace: string): ExperimentRecord {
  return {
    v: 1,
    id: "ex1",
    workspace,
    hypothesis: "candidate improves debug success",
    candidateRef: "exp_0123456789abcdef",
    control: "current-active",
    taskFilter: { class: ["debug"] },
    treatmentPct: 0.5,
    minSamplesPerArm: 10,
    maxSamplesPerArm: 20,
    decisionRule: { kind: "superiority", minRiskDiff: 0, minCostImprovement: 0.1, requireNoRegression: true },
    budget: { maxRuns: 40, maxUsd: null, maxWallMs: null },
    status: "running",
    createdAt: 1_000,
    approvedBy: "owner",
  };
}

function events(success: boolean): AgentEvent[] {
  return [
    { type: "user_message", content: "修复 parser 的报错" } as AgentEvent,
    (success
      ? { type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 1, results: [] }
      : {
        type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 1,
        results: [{ command: "pnpm test", ok: false, output: "fail" }], cause: "code",
      }) as AgentEvent,
    { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent,
  ];
}

function episodeFor(workspace: string, sessionId: string, arm: "control" | "treatment", success: boolean) {
  return projectEpisode({
    events: events(success),
    workspace,
    sessionId,
    logPath: join(workspace, "sessions", sessionId + ".jsonl"),
    observedAt: 2_000,
    assignment: {
      source: "sidecar",
      experimentId: "ex1",
      arm,
      propensity: 0.5,
      policyVersion: "evolve-v1",
      injectedExperienceIds: [],
      injectedChars: 0,
    },
  });
}

describe("候选存储", () => {
  it("create/load/list/save；重复 id 拒绝", async () => {
    const workspace = await tempWorkspace();
    const candidate = syntheticCandidate(workspace);
    await createCandidate(workspace, candidate);
    expect((await loadCandidate(workspace, candidate.id))?.id).toBe(candidate.id);
    expect((await listCandidates(workspace)).map((item) => item.id)).toEqual([candidate.id]);
    await expect(createCandidate(workspace, candidate)).rejects.toThrow(/已存在/u);

    const promoted: CandidateRecord = {
      ...candidate,
      status: "promoted",
      promotion: { bundleId: "content-pack.evolve-test", version: "0.1.0", stagingDir: "/tmp/x", ts: 2_000 },
    };
    await saveCandidate(workspace, promoted);
    expect((await loadCandidate(workspace, candidate.id))?.status).toBe("promoted");
    expect(candidatePathFor(workspace, candidate.id)).toContain(candidate.id);
  });
});

describe("实验 → 候选", () => {
  it("passed 实验生成候选；重复调用幂等", async () => {
    const workspace = await tempWorkspace();
    await seedPlaybook(workspace);
    await createExperiment(workspace, experiment(workspace));
    for (let i = 0; i < 10; i += 1) {
      await appendEpisode(workspace, episodeFor(workspace, "c" + String(i), "control", i < 2));
      await appendEpisode(workspace, episodeFor(workspace, "t" + String(i), "treatment", i < 9));
    }
    const result = await analyzeExperimentById(workspace, "ex1");
    expect(result.analysis.status).toBe("passed");

    const first = await createCandidateFromExperiment(workspace, "ex1", { now: 3_000 });
    expect(first.created).toBe(true);
    expect(first.candidate.status).toBe("passed");
    expect(first.candidate.target.id).toBe("exp_0123456789abcdef");
    expect(first.candidate.eval.validation?.success).toBeCloseTo(0.9, 5);
    expect(first.candidate.eval.holdout).toBeNull();
    expect(first.candidate.evidence).toHaveLength(10);

    const second = await createCandidateFromExperiment(workspace, "ex1", { now: 4_000 });
    expect(second.created).toBe(false);
    expect(second.candidate.id).toBe(first.candidate.id);
  });
});

describe("候选 → SEMA staging", () => {
  it("没有 modules/ ⇒ 拒绝且不改候选状态", async () => {
    const workspace = await tempWorkspace();
    await seedPlaybook(workspace);
    const candidate = syntheticCandidate(workspace);
    await createCandidate(workspace, candidate);

    const result = await promoteCandidateToSema(workspace, candidate.id);
    expect(result.outcome).toBe("refused");
    expect(result.outcome === "refused" ? result.reason : "").toBe("工作区没有 modules/（SEMA 未启用）");
    expect((await loadCandidate(workspace, candidate.id))?.status).toBe("passed");
  });

  it("passed 候选提交为 content-pack staging；不自动安装", async () => {
    const workspace = await tempWorkspace();
    await mkdir(join(workspace, "modules"), { recursive: true });
    await seedPlaybook(workspace);
    const candidate = syntheticCandidate(workspace);
    await createCandidate(workspace, candidate);

    const result = await promoteCandidateToSema(workspace, candidate.id);
    expect(result.outcome).toBe("submitted");
    if (result.outcome !== "submitted") throw new Error("expected submitted");
    expect(result.bundleId).toMatch(/^content-pack\.evolve-[0-9a-f]{16}$/u);
    expect(result.candidate.status).toBe("promoted");
    expect(result.candidate.promotion?.bundleId).toBe(result.bundleId);
    const prompt = await readFile(join(result.stagingDir, "prompt.md"), "utf8");
    expect(prompt).toContain("candidate body");
    expect(prompt).toContain("ep_1");

    const opened = await openEvolutionRegistry(workspace, PROMOTION_GATES);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") throw new Error("expected registry");
    expect(opened.index.bundles[result.bundleId]?.active).toBeUndefined();

    const again = await promoteCandidateToSema(workspace, candidate.id);
    expect(again.outcome).toBe("already-promoted");
  });

  it("非 passed 候选拒绝晋升", async () => {
    const workspace = await tempWorkspace();
    await seedPlaybook(workspace);
    const candidate = syntheticCandidate(workspace, "candidate body", "draft");
    await createCandidate(workspace, candidate);
    const result = await promoteCandidateToSema(workspace, candidate.id);
    expect(result.outcome).toBe("refused");
    expect(result.outcome === "refused" ? result.reason : "").toBe("只有 passed 候选可晋升（当前 draft）");
  });

  it("没有离线 holdout 评分拒绝晋升", async () => {
    const workspace = await tempWorkspace();
    await mkdir(join(workspace, "modules"), { recursive: true });
    await seedPlaybook(workspace);
    const candidate = syntheticCandidate(workspace, "candidate body", "passed", null);
    await createCandidate(workspace, candidate);
    const result = await promoteCandidateToSema(workspace, candidate.id);
    expect(result.outcome).toBe("refused");
    expect(result.outcome === "refused" ? result.reason : "").toBe("没有可用的离线 holdout 评分（需要 success>0 且 safety=pass；先跑 evolve-eval）");
  });
});
