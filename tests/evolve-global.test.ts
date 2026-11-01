import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { EPISODE_VERSION, projectEpisode, type EpisodeRecord } from "../src/agent/evolve/episode";
import { newExperience, type PlaybookOp } from "../src/agent/evolve/playbook";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import {
  appendGlobalPlaybookEvents,
  globalEvolveStopPath,
  globalPlaybookPath,
  loadGlobalPlaybook,
} from "../src/main/evolve/global-playbook-store";
import {
  globalizeExperience,
  listGlobalExperiences,
  reactivateGlobalExperience,
  revokeGlobalExperience,
  verifyGlobalEvidence,
  type GlobalEvidenceRef,
} from "../src/main/evolve/globalize";
import { baselineEvolutionNote, prepareEvolutionInjection } from "../src/main/evolve/runtime";
import { buildEvolveReport, formatEvolveReport } from "../src/main/evolve/report";
import {
  runEvolveGlobalize,
  runEvolveGlobalizeActivate,
  runEvolveGlobalizeFreeze,
  runEvolveGlobalizeList,
  runEvolveGlobalizeRevoke,
} from "../scripts/evolve-globalize";

const dirs: string[] = [];
let globalHome = "";
beforeEach(async () => {
  globalHome = await mkdtemp(join(tmpdir(), "evolve-global-home-"));
  process.env.CAIRN_EVOLVE_HOME = globalHome;
});
afterEach(async () => {
  delete process.env.CAIRN_EVOLVE_HOME;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await rm(globalHome, { recursive: true, force: true }).catch(() => {});
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 造一个可测 Episode（verify 绿 ⇒ final success），返回 id。 */
async function workspaceWithEpisode(): Promise<{ workspace: string; episodeId: string }> {
  const workspace = await tempDir("evolve-global-ws-");
  const ts = Date.now();
  const events: AgentEvent[] = [
    { type: "session_meta", ts } as AgentEvent,
    { type: "user_message", content: "修解析器" } as AgentEvent,
    { type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 1, results: [] } as AgentEvent,
    { type: "usage", inputTokens: 1, outputTokens: 1 } as AgentEvent,
  ];
  const episode = projectEpisode({
    events,
    workspace,
    sessionId: "s-" + workspace,
    logPath: join(workspace, "s.jsonl"),
    observedAt: ts,
  });
  await appendEpisode(workspace, episode);
  return { workspace, episodeId: episode.id };
}

async function sourceWithActive(
  body = "GLOBAL_LESSON：跨项目适用",
  expiresAt: number | null = null,
): Promise<{ workspace: string; entryId: string }> {
  const workspace = await tempDir("evolve-global-src-");
  const entry = newExperience({
    id: "exp_0123456789abcdef",
    kind: "strategy",
    scope: { workspace },
    trigger: { when: "always" },
    body,
    status: "active",
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt,
  });
  const op: PlaybookOp = { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
  await appendPlaybookEvents(workspace, [op]);
  return { workspace, entryId: entry.id };
}

async function threeEvidence(): Promise<GlobalEvidenceRef[]> {
  const refs: GlobalEvidenceRef[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { workspace, episodeId } = await workspaceWithEpisode();
    refs.push({ workspace, episodeId });
  }
  return refs;
}

/** 一场「注入了这条且失败」的 Episode（观测账只认 assignment 里的 id）。 */
function injectedFailure(workspace: string, experienceId: string, index: number): EpisodeRecord {
  return {
    v: EPISODE_VERSION,
    id: "ep_neg_" + String(index),
    ts: 3_000 + index,
    workspace,
    sessionId: "s-neg-" + String(index),
    task: { signature: "sig", class: "debug", intentExcerpt: "修解析器", tokens: ["修", "解析器"] },
    run: { startEventId: 5, endEventId: 9, logPath: join(workspace, "s.jsonl"), logSha256: null },
    assembly: { harnessRev: null, configDigest: null, model: null, provider: null, tier: null },
    outcome: { verify: "none", judge: "unknown", user: "unknown", final: "failure" },
    cost: {
      tokensIn: 0, tokensOut: 0, mainTokens: 0, workerTokens: 0,
      requests: 0, usd: null, durationMs: null, toolCalls: 0,
    },
    evidence: {
      verifyCauses: {}, failedToolCalls: 0, stuckSignals: [], touchedPaths: [],
      toolNames: [], toolSequence: [], diffDigest: null,
    },
    assignment: {
      source: "sidecar", experimentId: null, arm: "none", propensity: null,
      policyVersion: "p", injectedExperienceIds: [experienceId], injectedChars: 10,
    },
  };
}

describe("全局晋升", () => {
  it("≥3 workspace 可测证据 ⇒ dry-run 不写、apply 写全局账；其他 workspace 注入可用", async () => {
    const source = await sourceWithActive();
    const evidence = await threeEvidence();
    expect(await verifyGlobalEvidence(evidence)).toMatchObject({ ok: true, workspaces: 3, episodes: 3 });

    const dry = await globalizeExperience(source.workspace, source.entryId, evidence, { now: 2_000 });
    expect(dry.outcome).toBe("dry-run");
    expect((await loadGlobalPlaybook()).entries).toHaveLength(0);

    const applied = await globalizeExperience(source.workspace, source.entryId, evidence, { now: 2_000, apply: true });
    expect(applied.outcome).toBe("globalized");
    if (applied.outcome !== "globalized") throw new Error("unreachable");
    expect(applied.entry.scope.workspace).toBe("*");
    expect(applied.entry.status).toBe("active");
    expect(applied.entry.globalEvidence).toHaveLength(3);
    expect((await loadGlobalPlaybook()).entries).toHaveLength(1);

    const other = evidence[0]!.workspace;
    expect(await baselineEvolutionNote({ workspace: other, taskContent: "修解析器", toolNames: ["read_file"], now: 3_000 }))
      .toContain("GLOBAL_LESSON");
    expect((await prepareEvolutionInjection({
      workspace: other, sessionId: "s", taskContent: "修解析器", toolNames: ["read_file"], now: 3_000,
    })).note).toContain("GLOBAL_LESSON");

    const report = await buildEvolveReport(source.workspace, 3_000);
    expect(report.frozen).toBe(false);
    expect(report.global.frozen).toBe(false);
    expect(report.global.total).toBe(1);
    expect(report.global.byStatus).toEqual({ active: 1 });
    expect(report.global.entries).toEqual([
      expect.objectContaining({
        id: source.entryId, status: "active", kind: "strategy", workspaces: 3, evidence: 4,
      }),
    ]);
    expect(formatEvolveReport(report)).toContain("全局经验");
    expect(formatEvolveReport(report)).toContain("GLOBAL_LESSON");

    for (let i = 0; i < 5; i += 1) {
      await appendEpisode(other, injectedFailure(other, source.entryId, i));
    }
    const observed = await buildEvolveReport(other, 3_500);
    expect(observed.global.entries[0]).toMatchObject({ trials: 5, successes: 0 });
    expect(observed.global.findings).toEqual([
      expect.objectContaining({ id: source.entryId, reason: "negative" }),
    ]);
    expect(formatEvolveReport(observed)).toContain("本库观测 0/5");

    expect((await listGlobalExperiences())[0]?.status).toBe("active");
    const dryRevoke = await revokeGlobalExperience(source.entryId, { now: 4_000 });
    expect(dryRevoke.outcome).toBe("dry-run");
    const revoked = await revokeGlobalExperience(source.entryId, { now: 4_000, apply: true });
    expect(revoked.outcome).toBe("revoked");
    expect((await loadGlobalPlaybook()).entries[0]?.status).toBe("dormant");
    expect(await baselineEvolutionNote({ workspace: other, taskContent: "修解析器", toolNames: ["read_file"], now: 5_000 }))
      .not.toContain("GLOBAL_LESSON");

    const afterRevoke = await buildEvolveReport(source.workspace, 5_000);
    expect(afterRevoke.global.entries[0]?.status).toBe("dormant");
    expect(afterRevoke.global.byStatus).toEqual({ dormant: 1 });
    expect(formatEvolveReport(afterRevoke)).toContain("dormant×1");
    expect((await buildEvolveReport(other, 5_000)).global.findings).toEqual([]);

    // 恢复门：冻结拒绝 → 解冻 → 复核证据 → active；注入与负证据体检都回来。
    await writeFile(globalEvolveStopPath(), "", "utf8");
    expect((await reactivateGlobalExperience(source.entryId, { now: 6_000, apply: true })).outcome).toBe("frozen");
    await rm(globalEvolveStopPath(), { force: true });
    const dryActivate = await reactivateGlobalExperience(source.entryId, { now: 6_000 });
    expect(dryActivate.outcome).toBe("dry-run");
    const revived = await reactivateGlobalExperience(source.entryId, { now: 6_000, apply: true });
    expect(revived.outcome).toBe("reactivated");
    expect((await loadGlobalPlaybook()).entries[0]?.status).toBe("active");
    expect(await baselineEvolutionNote({ workspace: other, taskContent: "修解析器", toolNames: ["read_file"], now: 7_000 }))
      .toContain("GLOBAL_LESSON");
    expect((await buildEvolveReport(other, 7_000)).global.findings).toEqual([
      expect.objectContaining({ id: source.entryId, reason: "negative" }),
    ]);
    expect((await reactivateGlobalExperience(source.entryId, { now: 8_000, apply: true })).outcome).toBe("refused");
  });

  it("证据不足/缺失/不可测都拒绝；同 id 不重复写；全局 STOP 冻结", async () => {
    const source = await sourceWithActive();
    const two = await threeEvidence();
    expect((await verifyGlobalEvidence(two.slice(0, 2))).ok).toBe(false);
    const missing = await verifyGlobalEvidence([...two.slice(0, 2), { workspace: two[2]!.workspace, episodeId: "ep_nope" }]);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("不存在");

    const three = await threeEvidence();
    const first = await globalizeExperience(source.workspace, source.entryId, three, { now: 2_000, apply: true });
    expect(first.outcome).toBe("globalized");
    const again = await globalizeExperience(source.workspace, source.entryId, three, { now: 2_000, apply: true });
    expect(again.outcome).toBe("refused");
    expect(again.outcome === "refused" ? again.reason : "").toContain("全局账已有同 id");

    await writeFile(globalEvolveStopPath(), "", "utf8");
    const frozen = await globalizeExperience(source.workspace, source.entryId, three, { now: 2_000, apply: true });
    expect(frozen.outcome).toBe("frozen");
    const revokeFrozen = await revokeGlobalExperience(source.entryId, { now: 2_000, apply: true });
    expect(revokeFrozen.outcome).toBe("frozen");

    // workspace STOP 与全局 STOP 是两把锁：全局冻结只挡全局账，不改本库报告冻结位。
    const frozenReport = await buildEvolveReport(source.workspace, 2_000);
    expect(frozenReport.frozen).toBe(false);
    expect(frozenReport.global.frozen).toBe(true);
    expect((await runEvolveGlobalizeList()).frozen).toBe(true);

    const unfrozen = await runEvolveGlobalizeFreeze(false);
    expect(unfrozen.frozen).toBe(false);
    expect((await runEvolveGlobalizeList()).frozen).toBe(false);
    const refrozen = await runEvolveGlobalizeFreeze(true);
    expect(refrozen.frozen).toBe(true);
    expect((await revokeGlobalExperience(source.entryId, { now: 2_000, apply: true })).outcome).toBe("frozen");
    expect((await runEvolveGlobalizeFreeze(false)).frozen).toBe(false);
  });

  it("全局账坏行只丢一条，报告里出声且不伪造条目", async () => {
    await writeFile(globalPlaybookPath(), "{not json}\n", "utf8");
    const workspace = await tempDir("evolve-global-badline-");
    const report = await buildEvolveReport(workspace, 1_000);
    expect(report.global.total).toBe(0);
    expect(report.global.badLines).toBe(1);
    expect(formatEvolveReport(report)).toContain("坏行 1");
  });

  it("CLI：dry-run 解析证据；list/revoke 走全局账", async () => {
    const source = await sourceWithActive();
    const evidence = await threeEvidence();
    const args = [
      source.entryId,
      "--workspace", source.workspace,
      "--evidence", evidence.map((ref) => ref.workspace + ":" + ref.episodeId).join(","),
    ];
    const out = await runEvolveGlobalize(args);
    expect(out.applied).toBe(false);
    expect(out.result.outcome).toBe("dry-run");
    expect((await loadGlobalPlaybook()).entries).toHaveLength(0);
    expect((await runEvolveGlobalizeList()).entries).toHaveLength(0);

    const applied = await runEvolveGlobalize([...args, "--apply"]);
    expect(applied.result.outcome).toBe("globalized");
    expect((await runEvolveGlobalizeList()).entries[0]?.status).toBe("active");

    const rival = newExperience({
      id: "exp_2222222222222222",
      kind: "warning",
      scope: { workspace: "*" },
      trigger: { when: "always" },
      body: "GLOBAL_RIVAL：同触发",
      status: "active",
      evidenceEpisodes: ["ep_rival"],
      now: 1_000,
      expiresAt: null,
    });
    await appendGlobalPlaybookEvents([{ v: 1, op: "add", ts: 1_000, entry: rival, evidence: [], reason: "test" }]);
    const conflicted = await runEvolveGlobalizeList();
    expect(conflicted.findings.map((finding) => finding.reason)).toEqual(["conflict", "conflict"]);

    const revoked = await runEvolveGlobalizeRevoke(["revoke", source.entryId, "--apply"]);
    expect(revoked.result.outcome).toBe("revoked");
    expect((await runEvolveGlobalizeList()).entries.find((entry) => entry.id === source.entryId)?.status).toBe("dormant");
    expect((await runEvolveGlobalizeList()).findings).toEqual([]);
    const activated = await runEvolveGlobalizeActivate(["activate", source.entryId, "--apply"]);
    expect(activated.result.outcome).toBe("reactivated");
    expect((await runEvolveGlobalizeList()).entries[0]?.status).toBe("active");
  });

  it("全局条目过期 ⇒ 报告体检为 expired，且不再注入", async () => {
    const source = await sourceWithActive("EXPIRED_GLOBAL：过期不再用", 1_500);
    const evidence = await threeEvidence();
    const applied = await globalizeExperience(source.workspace, source.entryId, evidence, { now: 2_000, apply: true });
    expect(applied.outcome).toBe("globalized");
    const other = evidence[0]!.workspace;
    const report = await buildEvolveReport(other, 3_000);
    expect(report.global.findings).toEqual([
      expect.objectContaining({ id: source.entryId, reason: "expired" }),
    ]);
    expect(formatEvolveReport(report)).toContain("expired");
    expect(await baselineEvolutionNote({
      workspace: other, taskContent: "修解析器", toolNames: ["read_file"], now: 3_000,
    })).not.toContain("EXPIRED_GLOBAL");
  });

  it("全局与本地同触发冲突 ⇒ 全局体检点名全局条目（不混作本地冲突）", async () => {
    const source = await sourceWithActive();
    const evidence = await threeEvidence();
    const applied = await globalizeExperience(source.workspace, source.entryId, evidence, { now: 2_000, apply: true });
    expect(applied.outcome).toBe("globalized");
    const other = evidence[0]!.workspace;
    const local = newExperience({
      id: "exp_1111111111111111",
      kind: "strategy",
      scope: { workspace: other },
      trigger: { when: "always" },
      body: "LOCAL_LESSON：同触发",
      status: "active",
      evidenceEpisodes: ["ep_local"],
      now: 1_000,
      expiresAt: null,
    });
    await appendPlaybookEvents(other, [{ v: 1, op: "add", ts: 1_000, entry: local, evidence: [], reason: "test" }]);

    const report = await buildEvolveReport(other, 3_000);
    expect(report.playbook.conflicts).toBe(0);
    expect(report.global.findings).toEqual([
      expect.objectContaining({ id: source.entryId, reason: "conflict" }),
    ]);
    expect(report.global.findings[0]?.detail).toContain("exp_1111111111111111");
  });

  it("证据库的观测跨库汇总；本库=证据库时不双计", async () => {
    const source = await sourceWithActive();
    const evidence = await threeEvidence();
    const applied = await globalizeExperience(source.workspace, source.entryId, evidence, { now: 2_000, apply: true });
    expect(applied.outcome).toBe("globalized");
    const evidenceWs = evidence[0]!.workspace;
    for (let i = 0; i < 5; i += 1) {
      await appendEpisode(evidenceWs, injectedFailure(evidenceWs, source.entryId, 100 + i));
    }

    const fresh = await tempDir("evolve-global-cross-");
    const cross = await buildEvolveReport(fresh, 3_000);
    expect(cross.global.entries[0]).toMatchObject({
      trials: 0, successes: 0, evidenceTrials: 5, evidenceSuccesses: 0,
    });
    expect(cross.global.findings).toEqual([
      expect.objectContaining({ id: source.entryId, reason: "negative" }),
    ]);
    expect(formatEvolveReport(cross)).toContain("证据库观测 0/5");

    const same = await buildEvolveReport(evidenceWs, 3_000);
    expect(same.global.entries[0]).toMatchObject({
      trials: 5, successes: 0, evidenceTrials: 0, evidenceSuccesses: 0,
    });
    expect(same.global.findings[0]?.detail).toContain("观测 0/5");
    expect(same.global.findings[0]?.detail).not.toContain("0/10");
  });

  it("全局恢复复核证据：证据 workspace 丢了就拒绝，条目保持 dormant", async () => {
    const source = await sourceWithActive();
    const evidence = await threeEvidence();
    const applied = await globalizeExperience(source.workspace, source.entryId, evidence, { now: 2_000, apply: true });
    expect(applied.outcome).toBe("globalized");
    expect((await revokeGlobalExperience(source.entryId, { now: 3_000, apply: true })).outcome).toBe("revoked");

    await rm(evidence[0]!.workspace, { recursive: true, force: true });
    const revived = await reactivateGlobalExperience(source.entryId, { now: 4_000, apply: true });
    expect(revived.outcome).toBe("refused");
    expect(revived.outcome === "refused" ? revived.reason : "").toContain("不存在");
    expect((await loadGlobalPlaybook()).entries[0]?.status).toBe("dormant");
  });
});
