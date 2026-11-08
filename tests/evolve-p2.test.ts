import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import {
  assignArm,
  type ExperimentRecord,
} from "../src/agent/evolve/experiment";
import { projectEpisode } from "../src/agent/evolve";
import { newExperience, type ExperienceEntry, type PlaybookOp } from "../src/agent/evolve/playbook";
import { appendEpisode, recordEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { readAssignment, writeAssignment } from "../src/main/evolve/assignment-store";
import {
  analyzeExperimentById,
  createExperiment,
  listExperiments,
  loadExperiment,
  loadExperimentAnalysis,
} from "../src/main/evolve/experiment-store";
import { prepareEvolutionInjection } from "../src/main/evolve/runtime";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-p2-"));
  workspaces.push(workspace);
  return workspace;
}

function addOp(entry: ExperienceEntry): PlaybookOp {
  return { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
}

async function seedPlaybook(workspace: string): Promise<{ active: ExperienceEntry; candidate: ExperienceEntry }> {
  const active = newExperience({
    kind: "warning", scope: { workspace }, trigger: { when: "always" }, body: "active baseline",
    status: "active", evidenceEpisodes: ["ep_1"], now: 1_000,
  });
  const candidate = newExperience({
    id: "exp_0123456789abcdef",
    kind: "strategy", scope: { workspace }, trigger: { when: "always" }, body: "candidate body",
    now: 1_000,
  });
  await appendPlaybookEvents(workspace, [addOp(active), addOp(candidate)]);
  return { active, candidate };
}

function experiment(workspace: string, overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
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
    ...overrides,
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

function episodeFor(
  workspace: string,
  sessionId: string,
  arm: "control" | "treatment",
  success: boolean,
) {
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

describe("实验存储", () => {
  it("create/load/list 与重复 id 拒绝", async () => {
    const workspace = await tempWorkspace();
    const created = await createExperiment(workspace, experiment(workspace));
    expect(created).toContain("ex1.json");
    expect((await loadExperiment(workspace, "ex1"))?.id).toBe("ex1");
    expect((await listExperiments(workspace)).map((item) => item.id)).toEqual(["ex1"]);
    await expect(createExperiment(workspace, experiment(workspace))).rejects.toThrow(/已存在/u);
  });

  it("按 Episode 的 sidecar 分配聚合分析并落结果；裁决后不再继续分配", async () => {
    const workspace = await tempWorkspace();
    const { active } = await seedPlaybook(workspace);
    await createExperiment(workspace, experiment(workspace));
    for (let i = 0; i < 10; i += 1) {
      await appendEpisode(workspace, episodeFor(workspace, "c" + String(i), "control", i < 2));
      await appendEpisode(workspace, episodeFor(workspace, "t" + String(i), "treatment", i < 9));
    }
    const result = await analyzeExperimentById(workspace, "ex1");
    expect(result.analysis.status).toBe("passed");
    expect(result.analysis.decision).toBe("suggest-promote");
    expect(result.analysis.nControl).toBe(10);
    expect(result.analysis.nTreatment).toBe(10);
    const saved = await loadExperimentAnalysis(workspace, "ex1");
    expect(saved?.status).toBe("passed");

    const after = await prepareEvolutionInjection({
      workspace, sessionId: "after-decision", taskContent: "修复 parser 的报错", now: 3_000,
    });
    expect(after.assignment).toBeNull();
    expect(after.note).toContain(active.body);
  });
});

describe("运行时分配与 Episode 归因", () => {
  it("没有 active 经验也没有实验 ⇒ 零行为", async () => {
    const workspace = await tempWorkspace();
    const injection = await prepareEvolutionInjection({
      workspace, sessionId: "s0", taskContent: "修复 parser 的报错", now: 2_000,
    });
    expect(injection.note).toBe("");
    expect(injection.assignment).toBeNull();
    expect(await readAssignment(workspace, "s0")).toBeNull();
  });

  it("实验按确定性 hash 分配；treatment 注入候选，control 不注入", async () => {
    const workspace = await tempWorkspace();
    const { active, candidate } = await seedPlaybook(workspace);
    await createExperiment(workspace, experiment(workspace, { minSamplesPerArm: 2, maxSamplesPerArm: 10 }));

    let treatmentSession = "";
    let controlSession = "";
    for (let i = 0; i < 100 && (treatmentSession === "" || controlSession === ""); i += 1) {
      const session = "s" + String(i);
      const arm = assignArm("ex1", session, 0.5).arm;
      if (arm === "treatment" && treatmentSession === "") treatmentSession = session;
      if (arm === "control" && controlSession === "") controlSession = session;
    }
    expect(treatmentSession).not.toBe("");
    expect(controlSession).not.toBe("");

    const treatment = await prepareEvolutionInjection({
      workspace, sessionId: treatmentSession, taskContent: "修复 parser 的报错", now: 2_000,
    });
    expect(treatment.assignment?.arm).toBe("treatment");
    expect(treatment.note).toContain(active.body);
    expect(treatment.note).toContain(candidate.body);
    expect((await readAssignment(workspace, treatmentSession))?.arm).toBe("treatment");

    const control = await prepareEvolutionInjection({
      workspace, sessionId: controlSession, taskContent: "修复 parser 的报错", now: 2_000,
    });
    expect(control.assignment?.arm).toBe("control");
    expect(control.note).toContain(active.body);
    expect(control.note).not.toContain(candidate.body);
    expect((await readAssignment(workspace, controlSession))?.arm).toBe("control");
  });

  it("sidecar 分配进入 Episode；收束时读回", async () => {    const workspace = await tempWorkspace();
    await seedPlaybook(workspace);
    await createExperiment(workspace, experiment(workspace, { minSamplesPerArm: 2, maxSamplesPerArm: 10 }));
    const sessionId = Array.from({ length: 100 }, (_, i) => "s" + String(i))
      .find((id) => assignArm("ex1", id, 0.5).arm === "treatment");
    if (sessionId === undefined) throw new Error("no treatment session found");
    await prepareEvolutionInjection({ workspace, sessionId, taskContent: "修复 parser 的报错", now: 2_000 });

    const logPath = join(workspace, "sessions", sessionId + ".jsonl");
    await mkdir(join(workspace, "sessions"), { recursive: true });
    await writeFile(logPath, events(true).map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    const recorded = await recordEpisode({ events: events(true), workspace, sessionId, logPath });
    expect(recorded.episode.assignment).toMatchObject({
      source: "sidecar", experimentId: "ex1", arm: "treatment", propensity: 0.5,
    });
  });

  it("无实验的后续装配清除旧 sidecar，不把旧臂带进新 Episode", async () => {
    const workspace = await tempWorkspace();
    await writeAssignment(workspace, "stale", {
      experimentId: "ex1",
      arm: "treatment",
      propensity: 0.5,
      policyVersion: "evolve-v1",
      injectedExperienceIds: ["exp_0123456789abcdef"],
      injectedChars: 10,
    });
    expect(await readAssignment(workspace, "stale")).not.toBeNull();

    const injection = await prepareEvolutionInjection({
      workspace, sessionId: "stale", taskContent: "修复 parser 的报错", now: 2_000,
    });
    expect(injection.assignment).toBeNull();
    expect(await readAssignment(workspace, "stale")).toBeNull();
  });
});
