import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/events";
import {
  assignmentFromEvents,
  classifyTask,
  outcomeSourceOf,
  projectEpisode,
  type ProjectEpisodeInput,
} from "../src/agent/evolve";
import {
  appendEpisode,
  episodesIndexPathFor,
  episodesPathFor,
  formatEpisodeSummary,
  loadEpisodes,
  recordEpisode,
  summarizeEpisodes,
  writeEpisodeIndex,
} from "../src/main/evolve/episode-store";
import { emitPostRunReadings } from "../src/main/post-run-readings";

const workspaces: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

const meta = { type: "session_meta", ts: 1_000 } as unknown as AgentEvent;
const user = { type: "user_message", content: "修复 parser 的报错，并跑测试" } as AgentEvent;
const readCall = { type: "tool_call", id: "t1", name: "read_file", args: { path: "src/parser.ts" } } as AgentEvent;
const readResult = { type: "tool_result", callId: "t1", ok: true, output: "source" } as AgentEvent;
const editCall = { type: "tool_call", id: "t2", name: "edit_file", args: { path: "src/parser.ts" } } as AgentEvent;
const editResult = { type: "tool_result", callId: "t2", ok: true, output: "ok", change: "modified" } as AgentEvent;
const verifyRed = {
  type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 2,
  results: [{ command: "pnpm test", ok: false, output: "fail" }], cause: "code",
} as AgentEvent;
const verifyGreen = {
  type: "verify_result", callId: "v2", ok: true, attempt: 2, maxAttempts: 2,
  results: [{ command: "pnpm test", ok: true, output: "ok" }],
} as AgentEvent;
const mainUsage = { type: "usage", inputTokens: 100, outputTokens: 20, model: "deepseek-v4.1" } as AgentEvent;
const workerUsage = { type: "usage", inputTokens: 50, outputTokens: 10, agent_id: "w1", model: "deepseek-v4.1" } as AgentEvent;

function baseEvents(): AgentEvent[] {
  return [meta, user, readCall, readResult, editCall, editResult, verifyRed, verifyGreen, mainUsage, workerUsage];
}

function input(events: AgentEvent[], overrides: Partial<ProjectEpisodeInput> = {}): ProjectEpisodeInput {
  return {
    events,
    workspace: "/w",
    sessionId: "s1",
    logPath: "/w/events.jsonl",
    observedAt: 2_000,
    startedAt: 1_000,
    endedAt: 1_500,
    ...overrides,
  };
}

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-episode-"));
  workspaces.push(workspace);
  return workspace;
}

async function writeLog(workspace: string, events: AgentEvent[]): Promise<{ logPath: string; raw: string }> {
  const logPath = join(workspace, "events.jsonl");
  const raw = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await writeFile(logPath, raw, "utf8");
  return { logPath, raw };
}

describe("Episode 投影", () => {
  it("把一次 run 折成任务/结局/成本/证据/分配", () => {
    const episode = projectEpisode(input(baseEvents()));

    expect(episode.v).toBe(1);
    expect(episode.task.class).toBe("debug");
    expect(episode.task.intentExcerpt).toContain("修复 parser");
    expect(episode.task.tokens).toContain("parser");
    expect(episode.outcome).toEqual({ verify: "green", judge: "unknown", user: "unknown", final: "success" });
    expect(episode.cost).toMatchObject({
      tokensIn: 150, tokensOut: 30, mainTokens: 120, workerTokens: 60,
      requests: 2, usd: null, durationMs: 500, toolCalls: 2,
    });
    expect(episode.evidence.verifyCauses).toEqual({ code: 1 });
    expect(episode.evidence.failedToolCalls).toBe(0);
    expect(episode.evidence.touchedPaths).toEqual(["src/parser.ts"]);
    expect(episode.evidence.toolSequence).toEqual(["read_file(path)", "edit_file(path)"]);
    expect(episode.assignment).toMatchObject({
      source: "absent", experimentId: null, arm: "none", injectedExperienceIds: [], injectedChars: 0,
    });
    expect(episode.run).toMatchObject({ startEventId: 2, endEventId: 10, logPath: "/w/events.jsonl", logSha256: null });
    expect(episode.task.signature).toMatch(/^[0-9a-f]{16}$/u);
  });

  it("隐藏判据优先于 verify；verify 缺席不折成成功", () => {
    expect(projectEpisode(input(baseEvents(), { judge: "fail" })).outcome.final).toBe("failure");
    expect(projectEpisode(input(baseEvents(), { judge: "pass" })).outcome.final).toBe("success");

    const noVerify = projectEpisode(input([meta, user, mainUsage]));
    expect(noVerify.outcome).toEqual({ verify: "none", judge: "unknown", user: "unknown", final: "unknown" });
    expect(noVerify.cost.mainTokens).toBe(120);
    expect(noVerify.cost.usd).toBeNull();
  });

  it("worker 子流不替父会话表态，用量单列", () => {
    const workerVerify = {
      type: "verify_result", callId: "wv", ok: false, attempt: 1, maxAttempts: 1,
      results: [{ command: "pnpm test", ok: false, output: "worker fail" }], agent_id: "w1",
    } as AgentEvent;
    const workerCall = { type: "tool_call", id: "wt", name: "run_shell", args: {}, agent_id: "w1" } as AgentEvent;
    const episode = projectEpisode(input([meta, user, workerVerify, workerCall, workerUsage]));

    expect(episode.outcome.verify).toBe("none");
    expect(episode.outcome.final).toBe("unknown");
    expect(episode.evidence.verifyCauses).toEqual({});
    expect(episode.cost.toolCalls).toBe(0);
    expect(episode.cost.mainTokens).toBe(0);
    expect(episode.cost.workerTokens).toBe(60);
  });

  it("session_meta.evolve 的分配可读；坏形状 fail-closed 为 none", () => {
    const stamped = {
      type: "session_meta",
      evolve: {
        experimentId: "ex1", arm: "treatment", propensity: 0.2, policyVersion: "evolve-v1",
        injectedExperienceIds: ["exp_a"], injectedChars: 42,
      },
    } as unknown as AgentEvent;
    expect(assignmentFromEvents([stamped])).toEqual({
      source: "meta", experimentId: "ex1", arm: "treatment", propensity: 0.2,
      policyVersion: "evolve-v1", injectedExperienceIds: ["exp_a"], injectedChars: 42,
    });
    expect(projectEpisode(input([stamped, user, mainUsage])).assignment.source).toBe("meta");

    const bad = { type: "session_meta", evolve: { arm: "nope" } } as unknown as AgentEvent;
    expect(assignmentFromEvents([bad])).toEqual({
      source: "invalid", experimentId: null, arm: "none", propensity: null,
      policyVersion: "evolve-v1", injectedExperienceIds: [], injectedChars: 0,
    });
  });

  it("任务分类与签名稳定（同输入同输出）", () => {
    expect(classifyTask("修复 parser 的报错")).toBe("debug");
    expect(classifyTask("重构 parser")).toBe("refactor");
    expect(classifyTask("补一个单元测试")).toBe("test");
    expect(classifyTask("改一下侧栏样式")).toBe("ui");
    expect(classifyTask("解释一下为什么失败")).toBe("debug");
    expect(classifyTask("调研一下竞品")).toBe("research");
    expect(classifyTask("更新部署脚本")).toBe("ops");
    expect(classifyTask("加一个导出函数")).toBe("edit");
    expect(classifyTask("")).toBe("other");

    const a = projectEpisode(input(baseEvents()));
    const b = projectEpisode(input(baseEvents()));
    expect(a.task.signature).toBe(b.task.signature);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^ep_[0-9a-f]{16}$/u);
  });
});

describe("Episode 存储", () => {
  it("append 幂等；坏行只丢一条；重复 id 读侧去重", async () => {
    const workspace = await tempWorkspace();
    const episode = projectEpisode(input(baseEvents(), { workspace, logPath: join(workspace, "events.jsonl") }));

    expect((await appendEpisode(workspace, episode)).written).toBe(true);
    expect((await appendEpisode(workspace, episode)).written).toBe(false);

    const path = episodesPathFor(workspace);
    const raw = (await readFile(path, "utf8")) + JSON.stringify(episode) + "\n{bad json}\n";
    await writeFile(path, raw, "utf8");

    const loaded = await loadEpisodes(workspace);
    expect(loaded.episodes).toHaveLength(1);
    expect(loaded.duplicateIds).toBe(1);
    expect(loaded.badLines).toBe(1);
  });

  it("summary 把 unknown 与不可定价分开报", async () => {
    const workspace = await tempWorkspace();
    const known = projectEpisode(input(baseEvents(), { workspace, logPath: join(workspace, "events.jsonl") }));
    const unknown = projectEpisode(input([meta, user, mainUsage], { workspace, logPath: join(workspace, "unknown.jsonl") }));
    await appendEpisode(workspace, known);
    await appendEpisode(workspace, unknown);

    const summary = summarizeEpisodes(await loadEpisodes(workspace));
    expect(summary.total).toBe(2);
    expect(summary.byOutcome).toEqual({ success: 1, failure: 0, unknown: 1 });
    expect(summary.byOutcomeSource).toEqual({ judge: 0, verify: 1, user_feedback: 0, unmeasured: 1 });
    expect(summary.measuredRate).toBe(0.5);
    expect(outcomeSourceOf({ judge: "pass", verify: "red", user: "rejected" })).toBe("judge");
    expect(outcomeSourceOf({ judge: "unknown", verify: "green", user: "rejected" })).toBe("verify");
    expect(outcomeSourceOf({ judge: "unknown", verify: "none", user: "accepted" })).toBe("user_feedback");
    expect(outcomeSourceOf({ judge: "unknown", verify: "none", user: "unknown" })).toBe("unmeasured");
    expect(summary.unknownReasons.judge).toBe(2);
    expect(summary.unknownReasons.verify).toBe(1);
    expect(summary.cost.unpricedRuns).toBe(2);
    expect(summary.byClass.debug).toBe(2);

    const text = formatEpisodeSummary(summary);
    expect(text).toContain("Episode");
    expect(text).toContain("unknown");
    expect(text).toContain("不可定价");
  });

  it("index 原子落盘且可读", async () => {
    const workspace = await tempWorkspace();
    await appendEpisode(workspace, projectEpisode(input(baseEvents(), { workspace, logPath: join(workspace, "events.jsonl") })));

    const result = await writeEpisodeIndex(workspace);
    expect(result.path).toBe(episodesIndexPathFor(workspace));
    const parsed = JSON.parse(await readFile(result.path, "utf8")) as { v: number; summary: { total: number } };
    expect(parsed.v).toBe(1);
    expect(parsed.summary.total).toBe(1);
  });

  it("recordEpisode 计算日志哈希并幂等", async () => {
    const workspace = await tempWorkspace();
    const { logPath, raw } = await writeLog(workspace, baseEvents());

    const first = await recordEpisode({ events: baseEvents(), workspace, sessionId: "s1", logPath });
    expect(first.written).toBe(true);
    expect(first.episode.run.logSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.episode.run.startEventId).toBe(2);
    expect(first.episode.run.endEventId).toBe(10);
    expect(await readFile(logPath, "utf8")).toBe(raw);

    const second = await recordEpisode({ events: baseEvents(), workspace, sessionId: "s1", logPath });
    expect(second.written).toBe(false);
    expect(second.episode.id).toBe(first.episode.id);
  });
});

describe("收束接线", () => {
  it("收束时写 Episode，旧 evolution 行为不变", async () => {
    const workspace = await tempWorkspace();
    const { logPath, raw } = await writeLog(workspace, baseEvents());
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((message) => { warnings.push(String(message)); });

    await emitPostRunReadings({ logPath, workspace, sessionId: "s1" });

    const loaded = await loadEpisodes(workspace);
    expect(loaded.episodes).toHaveLength(1);
    expect(loaded.episodes[0]!.sessionId).toBe("s1");
    expect(loaded.episodes[0]!.outcome.final).toBe("success");
    expect(warnings.filter((message) => message.startsWith("[evolve]"))).toEqual([]);
    expect(await readFile(logPath, "utf8")).toBe(raw);
  });

  it("Episode 落盘失败只出声，不阻塞旧收尾", async () => {
    const workspace = await tempWorkspace();
    const { logPath } = await writeLog(workspace, baseEvents());
    await writeFile(join(workspace, ".agent"), "preserve this file", "utf8");
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((message) => { warnings.push(String(message)); });

    await expect(emitPostRunReadings({ logPath, workspace, sessionId: "s1" })).resolves.toBeUndefined();

    expect(warnings.some((message) => message.startsWith("[evolve]"))).toBe(true);
    expect(warnings.some((message) => message.startsWith("[evolution]"))).toBe(true);
    expect(await readFile(join(workspace, ".agent"), "utf8")).toBe("preserve this file");
  });

  it("session_meta.evolve 进入 Episode", async () => {
    const workspace = await tempWorkspace();
    const stamped = {
      type: "session_meta",
      evolve: {
        experimentId: "ex1", arm: "control", propensity: 0.5, policyVersion: "evolve-v1",
        injectedExperienceIds: [], injectedChars: 0,
      },
    } as unknown as AgentEvent;
    const { logPath } = await writeLog(workspace, [stamped, user, mainUsage]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await emitPostRunReadings({ logPath, workspace, sessionId: "s1" });

    const loaded = await loadEpisodes(workspace);
    expect(loaded.episodes[0]!.assignment).toMatchObject({
      source: "meta", experimentId: "ex1", arm: "control", propensity: 0.5,
    });
  });
});
