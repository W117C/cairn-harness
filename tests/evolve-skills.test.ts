import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { projectEpisode, type EpisodeRecord } from "../src/agent/evolve";
import { skillCandidates } from "../src/agent/evolve/skills";
import { retirementFindings, retirementOps } from "../src/agent/evolve/retirement";
import { newExperience } from "../src/agent/evolve/playbook";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { loadPlaybook } from "../src/main/evolve/playbook-store";
import { seedSkillCandidates } from "../src/main/evolve/skill-synthesis";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-skills-"));
  workspaces.push(workspace);
  return workspace;
}

function episode(workspace: string, sessionId: string, success: boolean, tools = ["read_file", "edit_file"]): EpisodeRecord {
  const events: AgentEvent[] = [
    { type: "user_message", content: "修复 parser 的报错" } as AgentEvent,
    ...tools.flatMap((name, index) => [
      { type: "tool_call", id: "t" + String(index), name, args: { path: "src/parser.ts" } } as AgentEvent,
      { type: "tool_result", callId: "t" + String(index), ok: true, output: "ok" } as AgentEvent,
    ]),
    (success
      ? { type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 1, results: [] }
      : {
        type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 1,
        results: [{ command: "pnpm test", ok: false, output: "fail" }], cause: "code",
      }) as AgentEvent,
    { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent,
  ];
  return projectEpisode({
    events,
    workspace,
    sessionId,
    logPath: join(workspace, "sessions", sessionId + ".jsonl"),
    observedAt: 2_000,
  });
}

describe("技能合成", () => {
  it("同签名成功 Episode ≥3 才产出 strategy 候选；失败不算", () => {
    const workspace = "/w";
    const episodes = [
      episode(workspace, "s1", true),
      episode(workspace, "s2", true),
      episode(workspace, "s3", true),
      episode(workspace, "s4", false),
    ];
    const candidates = skillCandidates(episodes, { now: 3_000 });
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.entry.kind).toBe("strategy");
    expect(candidate.entry.status).toBe("candidate");
    expect(candidate.entry.scope.taskClass).toBe("debug");
    expect(candidate.entry.trigger.when).toBe("on-task-class");
    expect(candidate.entry.evidence.episodes).toHaveLength(3);
    expect(candidate.entry.body).toContain("read_file(path)");
    expect(candidate.entry.body).toContain("edit_file(path)");

    expect(skillCandidates([episodes[0]!, episodes[1]!], { now: 3_000 })).toHaveLength(0);
    expect(skillCandidates([episodes[0]!, episodes[1]!], { now: 3_000, minEpisodes: 2 })).toHaveLength(1);
  });

  it("不同工具序列分组，不混成一条", () => {
    const workspace = "/w";
    const a = [episode(workspace, "a1", true), episode(workspace, "a2", true), episode(workspace, "a3", true)];
    const b = [
      episode(workspace, "b1", true, ["grep", "edit_file"]),
      episode(workspace, "b2", true, ["grep", "edit_file"]),
      episode(workspace, "b3", true, ["grep", "edit_file"]),
    ];
    expect(skillCandidates([...a, ...b], { now: 3_000 })).toHaveLength(2);
  });

  it("落 playbook 为 candidate，重复调用幂等", async () => {
    const workspace = await tempWorkspace();
    for (let i = 0; i < 3; i += 1) {
      await appendEpisode(workspace, episode(workspace, "s" + String(i), true));
    }
    const first = await seedSkillCandidates(workspace, { now: 3_000 });
    expect(first.proposed).toBe(1);
    expect(first.added).toBe(1);
    const loaded = await loadPlaybook(workspace);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]!.status).toBe("candidate");

    const second = await seedSkillCandidates(workspace, { now: 4_000 });
    expect(second.added).toBe(0);
    expect(second.skippedExisting).toBe(1);
  });
});

describe("退役与冲突", () => {
  it("过期条目产出 retire；冲突 active 产出 deprecate", () => {
    const now = 10_000;
    const expired = newExperience({
      kind: "warning",
      scope: { workspace: "/w" },
      trigger: { when: "always" },
      body: "expired",
      status: "active",
      evidenceEpisodes: ["ep_1"],
      now: 1_000,
      expiresAt: now - 1,
    });
    const a = newExperience({
      kind: "warning", scope: { workspace: "/w" }, trigger: { when: "always" }, body: "A",
      status: "active", evidenceEpisodes: ["ep_1"], now: 1_000,
    });
    const b = newExperience({
      kind: "strategy", scope: { workspace: "/w" }, trigger: { when: "always" }, body: "B",
      status: "active", evidenceEpisodes: ["ep_2"], now: 1_000,
    });
    const findings = retirementFindings([expired, a, b], now);
    expect(findings.filter((item) => item.reason === "expired").map((item) => item.id)).toEqual([expired.id]);
    expect(findings.filter((item) => item.reason === "conflict")).toHaveLength(2);

    const ops = retirementOps(findings, now);
    expect(ops.find((op) => op.op === "retire" && op.id === expired.id)).toBeTruthy();
    expect(ops.filter((op) => op.op === "deprecate")).toHaveLength(2);
  });
});
