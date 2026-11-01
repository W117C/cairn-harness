import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { newExperience, type ExperienceEntry, type NewExperienceInput, type PlaybookOp } from "../src/agent/evolve/playbook";
import type { ExperimentRecord } from "../src/agent/evolve/experiment";
import { projectEpisode } from "../src/agent/evolve/episode";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents, loadPlaybook } from "../src/main/evolve/playbook-store";
import { createExperiment } from "../src/main/evolve/experiment-store";
import { createCandidateFromExperiment } from "../src/main/evolve/experiment-candidate";
import { activatePlaybookEntry, activationBlockers, dormantPlaybookEntry } from "../src/main/evolve/activation";
import { prepareEvolutionInjection } from "../src/main/evolve/runtime";
import { buildEvolveReport } from "../src/main/evolve/report";
import { runEvolveActivate, runEvolveActivateList } from "../scripts/evolve-activate";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-activation-"));
  workspaces.push(workspace);
  return workspace;
}

function addOp(entry: ExperienceEntry): PlaybookOp {
  return { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
}

const ENTRY_ID = "exp_0123456789abcdef";

function candidateEntry(workspace: string, overrides: Partial<NewExperienceInput> = {}): ExperienceEntry {
  return newExperience({
    id: ENTRY_ID,
    kind: "strategy",
    scope: { workspace },
    trigger: { when: "always" },
    body: "passing controlled experiment",
    status: "candidate",
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt: null,
    ...overrides,
  });
}

function withCausal(entry: ExperienceEntry, riskDiff: number | null, trials = 20): ExperienceEntry {
  return {
    ...entry,
    confidence: { ...entry.confidence, causal: { trials, riskDiff, ci95: riskDiff === null ? null : [riskDiff / 2, riskDiff] } },
  };
}

function experiment(workspace: string): ExperimentRecord {
  return {
    v: 1,
    id: "ex1",
    workspace,
    hypothesis: "candidate improves debug success",
    candidateRef: ENTRY_ID,
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
      source: "sidecar", experimentId: "ex1", arm, propensity: 0.5,
      policyVersion: "evolve-v1", injectedExperienceIds: [], injectedChars: 0,
    },
  });
}

describe("激活门（纯函数）", () => {
  it("无因果证据、无改进、过期、冲突各自阻断", () => {
    const base = candidateEntry("/ws");
    expect(activationBlockers(base, [base], 2_000).map((item) => item.code)).toContain("no-causal");
    expect(activationBlockers(withCausal(base, 0), [withCausal(base, 0)], 2_000).map((item) => item.code))
      .toContain("no-improvement");
    const expired = { ...withCausal(base, 0.2), expiresAt: 1_500 };
    expect(activationBlockers(expired, [expired], 2_000).map((item) => item.code)).toContain("expired");
    const other = newExperience({
      id: "exp_ffffffffffffffff", kind: "warning", scope: { workspace: "/ws" }, trigger: { when: "always" },
      body: "conflicting", status: "active", evidenceEpisodes: ["ep_x"], now: 1_000, expiresAt: null,
    });
    const good = withCausal(base, 0.2);
    expect(activationBlockers(good, [good, other], 2_000).map((item) => item.code)).toContain("conflict");
  });

  it("有因果证据 + Episode 证据且无冲突 ⇒ 门通过", () => {
    const good = withCausal(candidateEntry("/ws"), 0.2);
    expect(activationBlockers(good, [good], 2_000)).toEqual([]);
  });

  it("全局作用域 fail-closed：跨 workspace 证据核验未实现", () => {
    const global = withCausal(candidateEntry("/ws", { scope: { workspace: "*" } }), 0.2);
    expect(activationBlockers(global, [global], 2_000).map((item) => item.code)).toContain("global-scope");
  });

  it("人工休眠：active 可转 dormant，非 active 拒绝，冻结拒绝", async () => {
    const workspace = await tempWorkspace();
    const active = candidateEntry(workspace, { status: "active" });
    await appendPlaybookEvents(workspace, [addOp(active)]);
    const dry = await dormantPlaybookEntry(workspace, ENTRY_ID, { now: 4_000 });
    expect(dry.outcome).toBe("dry-run");
    const applied = await dormantPlaybookEntry(workspace, ENTRY_ID, { now: 4_000, apply: true });
    expect(applied.outcome).toBe("dormant");
    expect((await loadPlaybook(workspace)).entries[0]!.status).toBe("dormant");
    const again = await dormantPlaybookEntry(workspace, ENTRY_ID, { now: 4_000, apply: true });
    expect(again.outcome).toBe("refused");
    expect((await prepareEvolutionInjection({
      workspace, sessionId: "after-dormant", taskContent: "修复 parser 的报错", now: 5_000,
    })).note).not.toContain(active.body);
  });
});

describe("实验 → 因果置信度 → 激活 → 基线注入", () => {
  it("passed 实验回填 causal；人工门激活后运行时能注入", async () => {
    const workspace = await tempWorkspace();
    const entry = candidateEntry(workspace);
    await appendPlaybookEvents(workspace, [addOp(entry)]);
    await createExperiment(workspace, experiment(workspace));
    for (let i = 0; i < 10; i += 1) {
      await appendEpisode(workspace, episodeFor(workspace, "c" + String(i), "control", i < 2));
      await appendEpisode(workspace, episodeFor(workspace, "t" + String(i), "treatment", i < 9));
    }

    await createCandidateFromExperiment(workspace, "ex1", { now: 3_000 });
    const patched = (await loadPlaybook(workspace)).entries.find((item) => item.id === ENTRY_ID)!;
    expect(patched.status).toBe("candidate");
    expect(patched.confidence.causal.trials).toBe(20);
    expect(patched.confidence.causal.riskDiff).toBeCloseTo(0.7, 5);
    expect(patched.evidence.episodes.length).toBeGreaterThanOrEqual(10);
    expect((await buildEvolveReport(workspace, 3_500)).playbook.activatable).toContain(ENTRY_ID);
    const candidateReport = await buildEvolveReport(workspace, 3_500);
    expect(candidateReport.activationCandidates.find((item) => item.id === ENTRY_ID)).toMatchObject({
      kind: "strategy", body: "passing controlled experiment", riskDiff: 0.7, trials: 20,
    });
    const listed = await runEvolveActivateList(["--workspace", workspace]);
    expect(listed.entries.find((item) => item.id === ENTRY_ID)).toMatchObject({ activatable: true });

    const dry = await activatePlaybookEntry(workspace, ENTRY_ID, { now: 4_000 });
    expect(dry.outcome).toBe("dry-run");
    const activated = await activatePlaybookEntry(workspace, ENTRY_ID, { now: 4_000, apply: true });
    expect(activated.outcome).toBe("activated");
    if (activated.outcome !== "activated") throw new Error("unreachable");
    expect(activated.entry.status).toBe("active");
    expect((await buildEvolveReport(workspace, 4_500)).playbook.activatable).not.toContain(ENTRY_ID);

    const injection = await prepareEvolutionInjection({
      workspace, sessionId: "after", taskContent: "修复 parser 的报错", now: 5_000,
    });
    expect(injection.note).toContain("passing controlled experiment");
  });

  it("没有因果证据时 --apply 也拒绝，状态保持 candidate", async () => {
    const workspace = await tempWorkspace();
    const entry = candidateEntry(workspace);
    await appendPlaybookEvents(workspace, [addOp(entry)]);
    const refused = await activatePlaybookEntry(workspace, ENTRY_ID, { now: 2_000, apply: true });
    expect(refused.outcome).toBe("refused");
    expect((await loadPlaybook(workspace)).entries[0]!.status).toBe("candidate");
    expect((await buildEvolveReport(workspace, 2_000)).playbook.activatable).not.toContain(ENTRY_ID);
    const listed = await runEvolveActivateList(["--workspace", workspace]);
    expect(listed.entries.find((item) => item.id === ENTRY_ID)?.activatable).toBe(false);
  });
});

describe("激活 CLI", () => {
  it("默认 dry-run，--apply 才写", async () => {
    const workspace = await tempWorkspace();
    const entry = withCausal(candidateEntry(workspace), 0.2);
    await appendPlaybookEvents(workspace, [addOp(entry)]);

    const dry = await runEvolveActivate([ENTRY_ID, "--workspace", workspace]);
    expect(dry.result.outcome).toBe("dry-run");
    expect((await loadPlaybook(workspace)).entries[0]!.status).toBe("candidate");

    const applied = await runEvolveActivate([ENTRY_ID, "--workspace", workspace, "--apply"]);
    expect(applied.result.outcome).toBe("activated");
    expect((await loadPlaybook(workspace)).entries[0]!.status).toBe("active");
  });
});
