// 激活门的全局作用域那一条（第 998 页）。
// 旧写法：`scope.workspace === "*"` 一律阻断，理由是"当前门无法跨库核验（fail-closed）"。
// 但跨库核验自第 911–912 页就存在（`globalize.verifyGlobalEvidence`：≥3 个 workspace、Episode 真在、
// outcome 非 unknown）。那句万能阻断于是干了两件坏事：①把能走通的路永久堵死（业主显式晋升过的条目
// 与没晋升的在这道门前没有区别）；②对读者**说不清真实边界**——"没人验"与"验不过"与"验不了"是三件事。
// 本文件钉的就是这三种话各归其位，以及门、报告、CLI 三个面共用同一份核验。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newExperience, type ExperienceEntry, type PlaybookOp } from "../src/agent/evolve/playbook";
import { EPISODE_VERSION, type EpisodeRecord } from "../src/agent/evolve/episode";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents, loadPlaybook } from "../src/main/evolve/playbook-store";
import { activatePlaybookEntry, activationBlockers } from "../src/main/evolve/activation";
import { buildEvolveReport } from "../src/main/evolve/report";
import { runEvolveActivateList } from "../scripts/evolve-activate";

const dirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function globalEntry(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return newExperience({
    id: "exp_0123456789abcdef",
    kind: "strategy",
    scope: { workspace: "*" },
    trigger: { when: "always" },
    body: "GATE_LESSON：跨项目适用",
    status: "dormant",
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt: null,
    ...overrides,
  });
}

function withCausal(entry: ExperienceEntry, riskDiff: number | null): ExperienceEntry {
  return {
    ...entry,
    confidence: { ...entry.confidence, causal: { trials: 20, riskDiff, ci95: riskDiff === null ? null : [riskDiff / 2, riskDiff] } },
  };
}

/** 三个真证据库，各有一条可读、可测（final 非 unknown）的 Episode。 */
async function threeEvidenceWorkspaces(): Promise<{ workspace: string; episodeId: string }[]> {
  const out: { workspace: string; episodeId: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const workspace = await tempDir("gate-ev-");
    const episode: EpisodeRecord = {
      v: EPISODE_VERSION,
      id: "ep_gate_" + String(i),
      ts: 3_000 + i,
      workspace,
      sessionId: "s-gate-" + String(i),
      task: { signature: "sig", class: "debug", intentExcerpt: "修解析器", tokens: ["修", "解析器"] },
      run: { startEventId: 5, endEventId: 9, logPath: join(workspace, "s.jsonl"), logSha256: null },
      assembly: { harnessRev: null, configDigest: null, model: null, provider: null, tier: null },
      outcome: { verify: "none", judge: "unknown", user: "unknown", final: "success" },
      cost: { tokensIn: 0, tokensOut: 0, mainTokens: 0, workerTokens: 0, requests: 0, usd: null, durationMs: null, toolCalls: 0 },
      evidence: {
        verifyCauses: {}, failedToolCalls: 0, stuckSignals: [], touchedPaths: [],
        toolNames: [], toolSequence: [], diffDigest: null,
      },
      assignment: {
        source: "sidecar", experimentId: null, arm: "none", propensity: null,
        policyVersion: "p", injectedExperienceIds: [], injectedChars: 0,
      },
    };
    await mkdir(workspace, { recursive: true });
    await appendEpisode(workspace, episode);
    out.push({ workspace, episodeId: episode.id });
  }
  return out;
}

/** `globalEvidence` 是晋升路径写上的字段，不是 `newExperience` 的入参——只能构造后再挂。 */
function withGlobalEvidence(entry: ExperienceEntry, refs: { workspace: string; episodeId: string }[]): ExperienceEntry {
  return { ...entry, globalEvidence: refs, evidence: { ...entry.evidence, episodes: refs.map((r) => r.episodeId) } };
}

async function playbookWith(entry: ExperienceEntry): Promise<string> {
  const workspace = await tempDir("gate-ws-");
  const op: PlaybookOp = { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
  await appendPlaybookEvents(workspace, [op]);
  return workspace;
}

describe("激活门：全局作用域的三种话", () => {
  const codes = (blocks: { code: string }[]) => blocks.map((b) => b.code);

  it("没带核验结果 ⇒ 仍阻断，但说的是「这次没验」，不是「验不了」", () => {
    const blocks = activationBlockers(globalEntry(), [globalEntry()], 2_000);
    expect(codes(blocks)).toContain("global-scope");
    const detail = blocks.find((b) => b.code === "global-scope")?.detail ?? "";
    expect(detail).toContain("没带跨库核验结果");
    expect(detail).not.toContain("无法跨库核验");
  });

  it("核验过了 ⇒ 不再因全局作用域阻断；其余门一条不放过", () => {
    const entry = withCausal(globalEntry(), null); // 缺对照组结论：no-causal 必须还在
    const blocks = activationBlockers(entry, [entry], 2_000, {
      globalCheck: { ok: true, reason: "", workspaces: 3, episodes: 3, normalized: [] },
    });
    expect(codes(blocks)).not.toContain("global-scope");
    expect(codes(blocks)).toContain("no-causal");
  });

  it("核验没过 ⇒ 用核验给出的实测理由，不再套用万能阻断", () => {
    const entry = globalEntry();
    const blocks = activationBlockers(entry, [entry], 2_000, {
      globalCheck: {
        ok: false, reason: "全局晋升需要 ≥3 个 workspace 的证据（当前 2）", workspaces: 2, episodes: 0, normalized: [],
      },
    });
    const detail = blocks.find((b) => b.code === "global-scope")?.detail ?? "";
    expect(detail).toContain("（当前 2）");
    expect(detail).not.toContain("没带跨库核验结果");
  });

  it("端到端：三个真证据库的全局条目，激活门放它到 dry-run", async () => {
    const evidence = await threeEvidenceWorkspaces();
    const entry = withGlobalEvidence(withCausal(globalEntry(), 0.25), evidence);
    const workspace = await playbookWith(entry);
    const result = await activatePlaybookEntry(workspace, entry.id, { now: 4_000 });
    expect(result.outcome).toBe("dry-run");
    if (result.outcome === "refused") throw new Error("不该被拒：" + JSON.stringify(result.blockers));
  });

  it("端到端反向：证据只有两个库 ⇒ 照样拒，且理由给的是实测数", async () => {
    const evidence = (await threeEvidenceWorkspaces()).slice(0, 2);
    const entry = withGlobalEvidence(withCausal(globalEntry(), 0.25), evidence);
    const workspace = await playbookWith(entry);
    const result = await activatePlaybookEntry(workspace, entry.id, { now: 4_000 });
    expect(result.outcome).toBe("refused");
    if (result.outcome !== "refused") return;
    const block = result.blockers.find((b) => b.code === "global-scope");
    expect(block?.detail).toContain("（当前 2）");
  });

  it("报告与 CLI 两个面读的是同一份核验（不各写一套「为什么不行」）", async () => {
    const evidence = await threeEvidenceWorkspaces();
    const entry = withGlobalEvidence(withCausal(globalEntry(), 0.25), evidence);
    const workspace = await playbookWith(entry);
    const report = await buildEvolveReport(workspace, 4_000);
    expect(report.activationCandidates.map((c) => c.id)).toContain(entry.id);
    const list = await runEvolveActivateList(["--workspace", workspace]);
    const row = list.entries.find((e) => e.id === entry.id);
    expect(row?.activatable).toBe(true);
    expect((await loadPlaybook(workspace)).entries.length).toBe(1);
  });
});
