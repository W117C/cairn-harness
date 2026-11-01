import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { newExperience, type ExperienceEntry, type PlaybookOp } from "../src/agent/evolve/playbook";
import { projectEpisode } from "../src/agent/evolve/episode";
import { retirementFindings, retirementOps } from "../src/agent/evolve/retirement";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents, loadPlaybook } from "../src/main/evolve/playbook-store";
import { prepareEvolutionInjection } from "../src/main/evolve/runtime";
import { buildEvolveReport } from "../src/main/evolve/report";
import { runEvolveRetire } from "../scripts/evolve-retire";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-retirement-"));
  workspaces.push(workspace);
  return workspace;
}

const ENTRY_ID = "exp_0123456789abcdef";

function activeEntry(workspace: string, overrides: Partial<Parameters<typeof newExperience>[0]> = {}): ExperienceEntry {
  return newExperience({
    id: ENTRY_ID,
    kind: "warning",
    scope: { workspace },
    trigger: { when: "always" },
    body: "这招一直失败",
    status: "active",
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt: null,
    ...overrides,
  });
}

function addOp(entry: ExperienceEntry): PlaybookOp {
  return { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
}

function failureEpisode(workspace: string, sessionId: string, ts: number, injected: string[]) {
  const meta = { type: "session_meta", ts } as unknown as AgentEvent;
  const user = { type: "user_message", content: "修解析器" } as AgentEvent;
  const usage = { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent;
  const verify = {
    type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 1,
    results: [{ command: "pnpm test", ok: false, output: "fail" }], cause: "code",
  } as AgentEvent;
  return projectEpisode({
    events: [meta, user, verify, usage],
    workspace,
    sessionId,
    logPath: join(workspace, sessionId + ".jsonl"),
    observedAt: ts,
    assignment: {
      source: "sidecar", experimentId: null, arm: "none", propensity: null,
      policyVersion: "evolve-v1", injectedExperienceIds: injected, injectedChars: 10,
    },
  });
}

describe("负证据 findings（纯函数）", () => {
  it("active 条目 ≥5 场且成功率 ≤20% ⇒ negative；小样本/高成功率/非 active 不判", () => {
    const entry = activeEntry("/ws");
    const stats = new Map([[ENTRY_ID, { trials: 5, successes: 0 }]]);
    expect(retirementFindings([entry], 2_000, stats).map((item) => item.reason)).toEqual(["negative"]);
    expect(retirementFindings([entry], 2_000, new Map([[ENTRY_ID, { trials: 4, successes: 0 }]]))).toEqual([]);
    expect(retirementFindings([entry], 2_000, new Map([[ENTRY_ID, { trials: 5, successes: 2 }]]))).toEqual([]);
    const shadow = { ...entry, status: "shadow" as const };
    expect(retirementFindings([shadow], 2_000, stats).map((item) => item.reason)).not.toContain("negative");
  });

  it("ops：negative ⇒ dormant；expired ⇒ retire；conflict ⇒ deprecate", () => {
    const entry = activeEntry("/ws");
    const negative = retirementFindings([entry], 2_000, new Map([[ENTRY_ID, { trials: 5, successes: 0 }]]));
    expect(retirementOps(negative, 2_000)).toEqual([
      { v: 1, op: "patch", ts: 2_000, id: ENTRY_ID, fields: { status: "dormant" }, evidence: [], reason: expect.stringContaining("dormant") },
    ]);
    const expired = retirementFindings([{ ...entry, expiresAt: 1_500 }], 2_000);
    expect(retirementOps(expired, 2_000)[0]).toMatchObject({ op: "retire", id: ENTRY_ID });
    const other = activeEntry("/ws", { id: "exp_ffffffffffffffff", body: "另一条" });
    const conflicts = retirementFindings([entry, other], 2_000);
    expect(retirementOps(conflicts, 2_000).map((op) => op.op)).toEqual(["deprecate", "deprecate"]);
  });
});

describe("负证据 → dormant → 停止注入（真文件）", () => {
  it("5 场失败后报告出负证据；--apply 置 dormant，运行时不再注入", async () => {
    const workspace = await tempWorkspace();
    const entry = activeEntry(workspace);
    await appendPlaybookEvents(workspace, [addOp(entry)]);
    for (let i = 0; i < 5; i += 1) {
      await appendEpisode(workspace, failureEpisode(workspace, "f" + String(i), 2_000 + i, [ENTRY_ID]));
    }

    const before = await prepareEvolutionInjection({
      workspace, sessionId: "next", taskContent: "修解析器", now: 3_000,
    });
    expect(before.note).toContain(entry.body);
    expect((await buildEvolveReport(workspace, 3_000)).playbook.negative).toBe(1);
    const report = await buildEvolveReport(workspace, 3_000);
    expect(report.negativeCandidates).toEqual([{
      id: ENTRY_ID, kind: "warning", body: "这招一直失败", trials: 5, successes: 0,
    }]);

    const dry = await runEvolveRetire([workspace]);
    expect(dry.findings.map((item) => item.reason)).toContain("negative");
    expect((await loadPlaybook(workspace)).entries[0]!.status).toBe("active");

    const applied = await runEvolveRetire([workspace, "--apply"]);
    expect(applied.applied).toBe(true);
    expect((await loadPlaybook(workspace)).entries[0]!.status).toBe("dormant");
    const after = await prepareEvolutionInjection({
      workspace, sessionId: "next2", taskContent: "修解析器", now: 4_000,
    });
    expect(after.note).not.toContain(entry.body);
  });
});
