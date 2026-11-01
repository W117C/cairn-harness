import { describe, expect, it } from "vitest";
import type { EpisodeRecord } from "../src/agent/evolve/episode";
import { observationalStatsOf } from "../src/agent/evolve/episode";
import { previousRunSignals } from "../src/agent/evolve/shadow";
import {
  applyObservationalStats,
  newExperience,
  retrieveExperiences,
  type RetrievalContext,
} from "../src/agent/evolve/playbook";
import { applyUserFeedback } from "../src/main/evolve/episode-store";

const NOW = 1_700_000_000_000;

function episode(over: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return {
    id: "ep_1",
    ts: NOW,
    workspace: "/ws",
    sessionId: "s1",
    task: { signature: "sig", class: "debug", intentExcerpt: "修解析器", tokens: ["修", "解析器"] },
    run: { startEventId: 5, endEventId: 9, logPath: "/ws/s1.jsonl", logSha256: null },
    assembly: { harnessRev: null, configDigest: null, model: null, provider: null, tier: null },
    outcome: { verify: "none", judge: "unknown", user: "unknown", final: "success" },
    cost: { tokensIn: 0, tokensOut: 0, mainTokens: 0, workerTokens: 0, requests: 0, usd: null, durationMs: null, toolCalls: 0 },
    evidence: { verifyCauses: {}, failedToolCalls: 0, stuckSignals: [], touchedPaths: [], toolNames: [], toolSequence: [], diffDigest: null },
    assignment: {
      source: "sidecar", experimentId: null, arm: "none", propensity: null,
      policyVersion: "evolve-v1", injectedExperienceIds: ["exp_a"], injectedChars: 10,
    },
    ...over,
  } as EpisodeRecord;
}

function entry(id: string, body: string, signal = "cost-high") {
  return newExperience({
    id,
    kind: "strategy",
    scope: { workspace: "/ws" },
    trigger: { when: "on-signal", signal },
    body,
    status: "active",
    evidenceEpisodes: ["ep_seed"],
    now: NOW - 1_000,
    expiresAt: null,
  });
}

function ctx(): RetrievalContext {
  return {
    workspace: "/ws", taskClass: "debug", tokens: ["解析器"],
    signals: ["cost-high", "goal-drift"], toolNames: [], paths: [], now: NOW,
  };
}

describe("Evolve 观测账", () => {
  it("中途提醒的经验也进观测账（与起点注入取并集、同场去重）", () => {
    const evidence = {
      verifyCauses: {}, failedToolCalls: 0, stuckSignals: [], touchedPaths: [],
      toolNames: [], toolSequence: [], diffDigest: null, nudgedExperienceIds: ["exp_nudge"],
    };
    const nudged = episode({
      assignment: {
        source: "sidecar", experimentId: null, arm: "none", propensity: null,
        policyVersion: "p", injectedExperienceIds: [], injectedChars: 0,
      },
      evidence,
      outcome: { verify: "none", judge: "unknown", user: "unknown", final: "success" },
    });
    expect(observationalStatsOf([nudged]).get("exp_nudge")).toMatchObject({ trials: 1, successes: 1 });
  });

  it("同场同条只记一次；未知结局只更新 lastUsedAt、不进 trials", () => {    const stats = observationalStatsOf([
      episode({ id: "e1", ts: NOW, outcome: { verify: "none", judge: "unknown", user: "unknown", final: "success" },
        assignment: { source: "sidecar", experimentId: null, arm: "none", propensity: null, policyVersion: "p", injectedExperienceIds: ["exp_a", "exp_a"], injectedChars: 1 } }),
      episode({ id: "e2", ts: NOW + 10, outcome: { verify: "none", judge: "unknown", user: "unknown", final: "failure" } }),
      episode({ id: "e3", ts: NOW + 20, outcome: { verify: "none", judge: "unknown", user: "unknown", final: "unknown" } }),
    ]);
    expect(stats.get("exp_a")).toEqual({ trials: 2, successes: 1, failures: 1, lastUsedAt: NOW + 20 });
  });

  it("用户踩过而判卷未知的场次进 failure；判卷/验证仍压过用户", () => {
    const down = applyUserFeedback(
      [episode({ outcome: { verify: "none", judge: "unknown", user: "unknown", final: "unknown" } })],
      [{ sessionId: "s1", eventId: 6, rating: "down", at: new Date(NOW).toISOString() }] as never,
    );
    expect(observationalStatsOf(down).get("exp_a")).toMatchObject({ trials: 1, successes: 0, failures: 1 });
    const green = applyUserFeedback(
      [episode({ outcome: { verify: "green", judge: "unknown", user: "unknown", final: "success" } })],
      [{ sessionId: "s1", eventId: 6, rating: "down", at: new Date(NOW).toISOString() }] as never,
    );
    expect(observationalStatsOf(green).get("exp_a")).toMatchObject({ trials: 1, successes: 1, failures: 0 });
  });

  it("同一会话只取最新一跑的信号；不同会话不串", () => {
    const evidence = { verifyCauses: { code: 1 }, failedToolCalls: 1, stuckSignals: [], touchedPaths: [], toolNames: [], toolSequence: [], diffDigest: null };
    const older = episode({
      id: "e_old", ts: NOW, sessionId: "s1",
      outcome: { verify: "green", judge: "unknown", user: "unknown", final: "success" },
    });
    const newer = episode({
      id: "e_new", ts: NOW + 10, sessionId: "s1", evidence,
      outcome: { verify: "red", judge: "unknown", user: "unknown", final: "failure" },
    });
    expect(previousRunSignals([newer, older], "s1")).toEqual(expect.arrayContaining(["verify:red", "verify-cause:code"]));
    expect(previousRunSignals([newer, older], "s2")).toEqual([]);
    expect(previousRunSignals([newer, older], "")).toEqual([]);
  });

  it("叠加只改 observational 与 lastUsedAt，不改原条目", () => {
    const a = entry("exp_aaaaaaaaaaaaaaaa", "A");
    const b = entry("exp_bbbbbbbbbbbbbbbb", "B");
    const applied = applyObservationalStats([a, b], new Map([
      ["exp_aaaaaaaaaaaaaaaa", { trials: 2, successes: 2, failures: 0, lastUsedAt: NOW }],
      ["exp_bbbbbbbbbbbbbbbb", { trials: 0, successes: 0, failures: 0, lastUsedAt: NOW + 5 }],
    ]));
    expect(a.confidence.observational).toEqual({ trials: 0, successes: 0, failures: 0 });
    expect(applied[0]!.confidence.observational).toEqual({ trials: 2, successes: 2, failures: 0 });
    expect(applied[0]!.lastUsedAt).toBe(NOW);
    expect(applied[1]!.confidence.observational).toEqual({ trials: 0, successes: 0, failures: 0 });
    expect(applied[1]!.lastUsedAt).toBe(NOW + 5);
  });

  it("观测成功率进入排序：预算只留一条时选中的是成功那条", () => {
    const good = entry("exp_aaaaaaaaaaaaaaaa", "成功策略", "cost-high");
    const bad = entry("exp_bbbbbbbbbbbbbbbb", "失败策略", "goal-drift");
    const applied = applyObservationalStats([good, bad], new Map([
      ["exp_aaaaaaaaaaaaaaaa", { trials: 2, successes: 2, failures: 0, lastUsedAt: NOW }],
      ["exp_bbbbbbbbbbbbbbbb", { trials: 2, successes: 0, failures: 2, lastUsedAt: NOW }],
    ]));
    const result = retrieveExperiences(applied, ctx(), { maxEntries: 1 });
    expect(result.selected.map((item) => item.body)).toEqual(["成功策略"]);
  });
});
