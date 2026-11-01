import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { newExperience } from "../src/agent/evolve/playbook";
import { parseReflectDelta } from "../src/agent/evolve/operators";
import { projectEpisode } from "../src/agent/evolve";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { appendPlaybookEvents, loadPlaybook } from "../src/main/evolve/playbook-store";
import { loadCandidate } from "../src/main/evolve/candidate-store";
import { recordReflectDelta } from "../src/main/evolve/reflect-operator";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

function entry() {
  return newExperience({
    id: "exp_0123456789abcdef",
    kind: "warning",
    scope: { workspace: "/w" },
    trigger: { when: "always" },
    body: "第一句。第二句。",
    evidenceEpisodes: ["ep_0"],
    status: "active",
    now: 1_000,
  });
}

function reflection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    targetId: "exp_0123456789abcdef",
    body: "第一句。第二句！",
    reason: "失败轨迹显示第二句需要更明确的收尾",
    evidence: ["ep_1"],
    ...overrides,
  };
}

function input(reflectionValue: unknown, evidenceEpisodes = ["ep_0", "ep_1"]) {
  return {
    workspace: "/w",
    entry: entry(),
    evidenceEpisodes,
    reflection: reflectionValue,
    now: 2_000,
  };
}

describe("reflect-delta 算子", () => {
  it("合法 delta 产出新的 candidate entry 与候选档案（不修改原条目）", () => {
    const result = parseReflectDelta(input(reflection()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.refusals.join("；"));
    expect(result.entry.status).toBe("candidate");
    expect(result.entry.id).not.toBe("exp_0123456789abcdef");
    expect(result.entry.body).toBe("第一句。第二句！");
    expect(result.entry.evidence.episodes).toEqual(["ep_0", "ep_1"]);
    expect(result.candidate.operator).toBe("reflect-delta");
    expect(result.candidate.target.id).toBe(result.entry.id);
    expect(result.candidate.body).toBe(result.entry.body);
    expect(result.candidate.status).toBe("draft");
  });

  it("伪造证据 / target 不一致 / 无 reason 均拒绝", () => {
    const fabricated = parseReflectDelta(input(reflection({ evidence: ["ep_999"] })));
    expect(fabricated.ok).toBe(false);
    if (!fabricated.ok) expect(fabricated.refusals.join("\n")).toContain("证据");

    const wrongTarget = parseReflectDelta(input(reflection({ targetId: "exp_ffffffffffffffff" })));
    expect(wrongTarget.ok).toBe(false);
    if (!wrongTarget.ok) expect(wrongTarget.refusals.join("\n")).toContain("target");

    const noReason = parseReflectDelta(input(reflection({ reason: "" })));
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.refusals.join("\n")).toContain("reason");
  });

  it("整段重写超过 30% 拒绝；TCB 路径拒绝", () => {
    const rewrite = parseReflectDelta(input(reflection({ body: "完全不同的另一段长文本，长度明显超过百分之三十的阈值" })));
    expect(rewrite.ok).toBe(false);
    if (!rewrite.ok) expect(rewrite.refusals.join("\n")).toContain("30");

    const tcb = parseReflectDelta(input(reflection({ body: "先改 src/permissions 再改业务" })));
    expect(tcb.ok).toBe(false);
    if (!tcb.ok) expect(tcb.refusals.join("\n")).toContain("受信");
  });
});

describe("reflect-delta 落库", () => {
  it("真实 Episode 证据 → 新 candidate entry + 候选档案；重复幂等", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "evolve-reflect-"));
    workspaces.push(workspace);
    const events: AgentEvent[] = [
      { type: "user_message", content: "修复 parser 的报错" } as AgentEvent,
      { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent,
    ];
    const episode = projectEpisode({
      events, workspace, sessionId: "s1", logPath: join(workspace, "events.jsonl"), observedAt: 1_000,
    });
    await appendEpisode(workspace, episode);
    const target = newExperience({
      id: "exp_0123456789abcdef",
      kind: "warning",
      scope: { workspace },
      trigger: { when: "always" },
      body: "第一句。第二句。",
      evidenceEpisodes: [episode.id],
      status: "active",
      now: 1_000,
    });
    await appendPlaybookEvents(workspace, [{ v: 1, op: "add", ts: 1_000, entry: target, evidence: [], reason: "test" }]);
    const reflection = {
      targetId: target.id,
      body: "第一句。第二句！",
      reason: "失败轨迹显示第二句需要更明确的收尾",
      evidence: [episode.id],
    };

    const first = await recordReflectDelta({ workspace, targetId: target.id, reflection, now: 2_000 });
    expect(first.outcome).toBe("created");
    const playbook = await loadPlaybook(workspace);
    expect(playbook.entries).toHaveLength(2);
    const created = playbook.entries.find((entry) => entry.status === "candidate");
    expect(created?.body).toBe("第一句。第二句！");
    expect(first.candidate?.target.id).toBe(created?.id);
    expect((await loadCandidate(workspace, first.candidate!.id))?.status).toBe("draft");

    const second = await recordReflectDelta({ workspace, targetId: target.id, reflection, now: 3_000 });
    expect(second.outcome).toBe("existing");
    expect((await loadPlaybook(workspace)).entries).toHaveLength(2);
  });
});
