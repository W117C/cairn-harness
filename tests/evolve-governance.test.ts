import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { projectEpisode } from "../src/agent/evolve";
import { newExperience } from "../src/agent/evolve/playbook";
import { newCandidate } from "../src/agent/evolve/candidates";
import type { ExperimentRecord } from "../src/agent/evolve/experiment";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { createExperiment } from "../src/main/evolve/experiment-store";
import { createCandidate } from "../src/main/evolve/candidate-store";
import {
  DEFAULT_EVOLVE_BUDGET,
  evolveBudgetPathFor,
  evolveStopPathFor,
  isEvolveFrozen,
  setEvolveFrozen,
  loadEvolveBudget,
} from "../src/main/evolve/governance";
import { buildEvolveReport, formatEvolveReport } from "../src/main/evolve/report";
import { prepareEvolutionInjection } from "../src/main/evolve/runtime";
import { promoteCandidateToSema } from "../src/main/evolve/promotion";
import { seedSkillCandidates } from "../src/main/evolve/skill-synthesis";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-governance-"));
  workspaces.push(workspace);
  return workspace;
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
    minSamplesPerArm: 2,
    maxSamplesPerArm: 4,
    decisionRule: { kind: "superiority", minRiskDiff: 0, minCostImprovement: 0.1, requireNoRegression: true },
    budget: { maxRuns: 8, maxUsd: null, maxWallMs: null },
    status: "running",
    createdAt: 1_000,
    approvedBy: "owner",
  };
}

describe("Evolve 治理面", () => {
  it("STOP 冻结；缺失 = 未冻结", async () => {
    const workspace = await tempWorkspace();
    expect(await isEvolveFrozen(workspace)).toBe(false);
    await mkdir(join(workspace, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveStopPathFor(workspace), "", "utf8");
    expect(await isEvolveFrozen(workspace)).toBe(true);
  });

  it("setEvolveFrozen：冻结写 STOP、解冻删 STOP（幂等；目录缺失也能建）", async () => {
    const workspace = await tempWorkspace();
    await setEvolveFrozen(workspace, true);
    expect(await isEvolveFrozen(workspace)).toBe(true);
    await setEvolveFrozen(workspace, true); // 幂等
    expect(await isEvolveFrozen(workspace)).toBe(true);
    await setEvolveFrozen(workspace, false);
    expect(await isEvolveFrozen(workspace)).toBe(false);
    await setEvolveFrozen(workspace, false); // 少了也不炸
    expect(await isEvolveFrozen(workspace)).toBe(false);
  });

  it("预算缺省/文件/坏档三态分明", async () => {
    const workspace = await tempWorkspace();
    const missing = await loadEvolveBudget(workspace);
    expect(missing.source).toBe("default");
    expect(missing.budget).toEqual(DEFAULT_EVOLVE_BUDGET);

    await mkdir(join(workspace, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveBudgetPathFor(workspace), JSON.stringify({ maxInjectedEntries: 2, maxInjectedChars: 800 }), "utf8");
    const file = await loadEvolveBudget(workspace);
    expect(file.source).toBe("file");
    expect(file.budget.maxInjectedEntries).toBe(2);
    expect(file.budget.maxInjectedChars).toBe(800);
    expect(file.budget.maxPlaybookEntries).toBe(DEFAULT_EVOLVE_BUDGET.maxPlaybookEntries);

    await writeFile(evolveBudgetPathFor(workspace), JSON.stringify({ maxInjectedEntries: 999 }), "utf8");
    const invalid = await loadEvolveBudget(workspace);
    expect(invalid.source).toBe("invalid");
    expect(invalid.budget.maxInjectedEntries).toBe(DEFAULT_EVOLVE_BUDGET.maxInjectedEntries);
  });

  it("冻结时运行时注入、晋升、技能落库都不动作", async () => {
    const workspace = await tempWorkspace();
    await mkdir(join(workspace, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveStopPathFor(workspace), "", "utf8");

    const injection = await prepareEvolutionInjection({
      workspace, sessionId: "s1", taskContent: "修复 parser 的报错", now: 2_000,
    });
    expect(injection.reason).toBe("frozen");
    expect(injection.note).toBe("");
    expect(injection.assignment).toBeNull();

    const entry = newExperience({
      id: "exp_0123456789abcdef", kind: "strategy", scope: { workspace },
      trigger: { when: "always" }, body: "candidate body", now: 1_000,
    });
    await appendPlaybookEvents(workspace, [{ v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" }]);
    await mkdir(join(workspace, "modules"), { recursive: true });
    const candidate = newCandidate({
      workspace, operator: "manual", target: { kind: "experience", id: entry.id },
      body: entry.body, evidence: ["ep_1"], status: "passed", now: 2_000,
    });
    await createCandidate(workspace, candidate);
    const promotion = await promoteCandidateToSema(workspace, candidate.id);
    expect(promotion.outcome).toBe("refused");
    expect(promotion.outcome === "refused" ? promotion.reason : "").toBe("STOP 冻结中：不晋升、不写 staging");

    const skills = await seedSkillCandidates(workspace);
    expect(skills.frozen).toBe(true);
    expect(skills.added).toBe(0);
  });

  it("报告聚合并显式标冻结", async () => {
    const workspace = await tempWorkspace();
    const entry = newExperience({
      id: "exp_0123456789abcdef", kind: "strategy", scope: { workspace },
      trigger: { when: "always" }, body: "candidate body", status: "active",
      evidenceEpisodes: ["ep_1"], now: 1_000,
    });
    await appendPlaybookEvents(workspace, [{ v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" }]);
    const events: AgentEvent[] = [
      { type: "user_message", content: "修复 parser 的报错" } as AgentEvent,
      { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent,
    ];
    const episode = projectEpisode({
      events, workspace, sessionId: "s1", logPath: join(workspace, "events.jsonl"), observedAt: 2_000,
    });
    await appendEpisode(workspace, episode);
    await createExperiment(workspace, experiment(workspace));
    const candidate = newCandidate({
      workspace, operator: "manual", target: { kind: "experience", id: entry.id },
      body: entry.body, evidence: ["ep_1"], status: "passed", now: 2_000,
    });
    await createCandidate(workspace, candidate);
    await mkdir(join(workspace, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveStopPathFor(workspace), "", "utf8");

    const report = await buildEvolveReport(workspace, 3_000);
    expect(report.frozen).toBe(true);
    expect(report.episodes.total).toBe(1);
    expect(report.playbook.total).toBe(1);
    expect(report.experiments).toHaveLength(1);
    expect(report.candidates.total).toBe(1);
    expect(report.budget.source).toBe("default");
    expect(formatEvolveReport(report)).toContain("FROZEN");
  });
});
