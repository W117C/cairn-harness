// 自进化的用户证据（2026-10-30）：赞/踩此前只落 feedback sidecar，Episode 的 outcome.user 恒 unknown，
// 实验分析还把这类 episode 当「未知」丢掉。本判卷钉：反馈按 run 窗口覆盖 outcome，并按**录制时同一
// 优先级**重算 final（判卷/验证压过用户）；撤回（none）回到 unknown。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import type { EpisodeRecord } from "../src/agent/evolve/episode";
import { projectEpisode } from "../src/agent/evolve/episode";
import { FeedbackStore } from "../src/main/feedback";
import {
  applyUserFeedback,
  appendEpisode,
  feedbackPathFor,
  loadEpisodesWithUserFeedback,
} from "../src/main/evolve/episode-store";
import { buildEvolveReport } from "../src/main/evolve/report";

const AT = (n: number): string => new Date(1_700_000_000_000 + n * 1000).toISOString();

function episode(over: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return {
    id: "ep_unit",
    ts: 1_700_000_000_000,
    workspace: "/ws",
    sessionId: "s1",
    task: { signature: "sig", class: "test", intentExcerpt: "修测试", tokens: ["修", "测试"] },
    run: { startEventId: 5, endEventId: 9, logPath: "/ws/s1.jsonl", logSha256: null },
    assembly: { harnessRev: null, configDigest: null, model: null, provider: null, tier: null },
    outcome: { verify: "none", judge: "unknown", user: "unknown", final: "unknown" },
    cost: { tokensIn: 0, tokensOut: 0, mainTokens: 0, workerTokens: 0, requests: 0, usd: null, durationMs: null, toolCalls: 0 },
    evidence: { verifyCauses: {}, failedToolCalls: 0, stuckSignals: [], touchedPaths: [], toolNames: [], toolSequence: [], diffDigest: null },
    assignment: { source: "absent", experimentId: null, arm: "none", propensity: null, policyVersion: "p", injectedExperienceIds: [], injectedChars: 0 },
    ...over,
  } as EpisodeRecord;
}

const feedback = (eventId: number, rating: "up" | "down" | "none", at: string, over: Record<string, unknown> = {}) => ({
  sessionId: "s1", eventId, rating, at, ...over,
});

describe("applyUserFeedback（纯覆盖）", () => {
  it("窗口内的赞/踩改 user 并按同一优先级重算 final；窗口外不动", () => {
    const [up] = applyUserFeedback([episode()], [feedback(6, "up", AT(1))] as never);
    expect(up!.outcome).toMatchObject({ user: "accepted", final: "success" });
    const [down] = applyUserFeedback([episode()], [feedback(9, "down", AT(1))] as never);
    expect(down!.outcome).toMatchObject({ user: "rejected", final: "failure" });
    const [outside] = applyUserFeedback([episode()], [feedback(10, "up", AT(1))] as never);
    expect(outside!.outcome).toMatchObject({ user: "unknown", final: "unknown" });
  });

  it("同一场多条反馈以时间最新为准；none 撤回回 unknown", () => {
    const [later] = applyUserFeedback([episode()], [feedback(6, "up", AT(1)), feedback(7, "down", AT(2))] as never);
    expect(later!.outcome.user).toBe("rejected");
    const [revoked] = applyUserFeedback([episode()], [feedback(6, "down", AT(1)), feedback(6, "none", AT(2))] as never);
    expect(revoked!.outcome).toMatchObject({ user: "unknown", final: "unknown" });
  });

  it("判卷/验证压过用户：judge pass 不因踩变失败；green 同理", () => {
    const judged = episode({ outcome: { verify: "none", judge: "pass", user: "unknown", final: "success" } });
    const [a] = applyUserFeedback([judged], [feedback(6, "down", AT(1))] as never);
    expect(a!.outcome).toMatchObject({ user: "rejected", final: "success" });
    const verified = episode({ outcome: { verify: "green", judge: "unknown", user: "unknown", final: "success" } });
    const [b] = applyUserFeedback([verified], [feedback(6, "down", AT(1))] as never);
    expect(b!.outcome).toMatchObject({ user: "rejected", final: "success" });
  });

  it("跨会话指针（eventRef）与空 run 不接受映射（不张冠李戴）", () => {
    const ref = feedback(6, "up", AT(1), { eventRef: { sessionId: "ancestor", eventId: 3 } });
    const [a] = applyUserFeedback([episode()], [ref] as never);
    expect(a!.outcome.user).toBe("unknown");
    const empty = episode({ run: { startEventId: 0, endEventId: 0, logPath: "/ws/s1.jsonl", logSha256: null } });
    const [b] = applyUserFeedback([empty], [feedback(0, "up", AT(1))] as never);
    expect(b!.outcome.user).toBe("unknown");
  });
});

let ws = "";
beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), "evolve-user-feedback-")); });
afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

describe("loadEpisodesWithUserFeedback / buildEvolveReport（真文件）", () => {
  const events: AgentEvent[] = [
    { type: "user_message", content: "修一下测试", ts: 1_700_000_000_000 },
    { type: "assistant_message", content: "修好了", ts: 1_700_000_001_000 },
  ] as AgentEvent[];

  async function seedEpisode(): Promise<EpisodeRecord> {
    const logPath = join(ws, "s1.jsonl");
    await mkdir(join(ws, ".agent", "sessions"), { recursive: true });
    const ep = projectEpisode({ events, workspace: ws, sessionId: "s1", logPath, observedAt: 1_700_000_002_000 });
    await appendEpisode(ws, ep);
    return ep;
  }

  it("赞 ⇒ 下一条读回 accepted/success；报告 byOutcome 与 unknownReasons.user 同步", async () => {
    const ep = await seedEpisode();
    await new FeedbackStore(feedbackPathFor(ws)).append({ sessionId: "s1", eventId: 2, rating: "up" });
    const loaded = await loadEpisodesWithUserFeedback(ws);
    expect(loaded.episodes.find((x) => x.id === ep.id)?.outcome).toMatchObject({ user: "accepted", final: "success" });
    const report = await buildEvolveReport(ws, 1_700_000_003_000);
    expect(report.episodes.byOutcome).toEqual({ success: 1, failure: 0, unknown: 0 });
    expect(report.episodes.unknownReasons.user).toBe(0);
  });

  it("踩 ⇒ failure；撤回（none）⇒ 回到 unknown（报告也回到未知面）", async () => {
    const ep = await seedEpisode();
    const store = new FeedbackStore(feedbackPathFor(ws));
    await store.append({ sessionId: "s1", eventId: 2, rating: "down" });
    expect((await loadEpisodesWithUserFeedback(ws)).episodes.find((x) => x.id === ep.id)?.outcome.final).toBe("failure");
    await store.append({ sessionId: "s1", eventId: 2, rating: "none" });
    const loaded = await loadEpisodesWithUserFeedback(ws);
    expect(loaded.episodes.find((x) => x.id === ep.id)?.outcome).toMatchObject({ user: "unknown", final: "unknown" });
  });
});

// 实验分析也走同一条入口（否则用户信号只影响报告、不影响实验裁决）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
it("实验分析从带反馈的 Episode 入口读（不绕过用户证据）", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/main/evolve/experiment-store.ts", import.meta.url)), "utf8");
  expect(src).toContain("loadEpisodesWithUserFeedback");
  expect(src).not.toContain("loadEpisodes(workspace)");
});
