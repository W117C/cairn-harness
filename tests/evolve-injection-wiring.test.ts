import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initSettingsStore, runAgent } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";
import { projectEpisode, type EpisodeRecord } from "../src/agent/evolve/episode";
import { newExperience, type ExperienceEntry, type PlaybookOp } from "../src/agent/evolve/playbook";
import { readAssignment } from "../src/main/evolve/assignment-store";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { appendGlobalPlaybookEvents, globalEvolveStopPath } from "../src/main/evolve/global-playbook-store";
import { appendEpisode } from "../src/main/evolve/episode-store";
import { prepareEvolutionInjection } from "../src/main/evolve/runtime";

// 生产装配点的端到端判卷：evolve 检索上下文必须带**本轮可见工具名**与任务里点到的路径。
// 缺口原状：prepareEvolutionInjection 支持 toolNames/paths，但 agent-runner 只递 taskContent
// ⇒ on-path 经验永远不命中（context.paths 空），on-tool 只剩关键词兜底。
// 这一格走真 runAgent + 真 session provider（stub fetch 只换字节来源），断言 system prompt。

let dir = "";
const globalDirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
  await Promise.all(globalDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  dir = "";
});

function addOp(entry: ExperienceEntry): PlaybookOp {
  return { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
}

async function workspace(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "evolve-wiring-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("CAIRN_API_KEY", "offline-test-key");
  return dir;
}

async function capturedSystem(ws: string, message: string): Promise<string> {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: unknown }> });
    return new Response("data: "
      + JSON.stringify({ choices: [{ delta: { content: "TASK_COMPLETED" }, finish_reason: "stop" }] })
      + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }));
  await runAgent({ workspace: ws, message, mode: "default", logPath: join(ws, "session.jsonl") });
  expect(requests.length).toBeGreaterThan(0);
  const system = requests[0]!.messages.find((row) => row.role === "system");
  return String(system?.content ?? "");
}

type EntrySeed = Omit<Parameters<typeof newExperience>[0], "now" | "status" | "evidenceEpisodes" | "expiresAt">;

function activeEntry(workspace: string, seed: EntrySeed): ExperienceEntry {
  return newExperience({
    status: "active",
    evidenceEpisodes: ["ep_1"],
    now: 1_000,
    expiresAt: null, // 真实 runAgent 用当前钟；固定 1970 时间戳建条目会让它当场过期
    ...seed,
    scope: { ...seed.scope, workspace },
  });
}

it("on-path 与 on-tool 经验在真实装配点命中；工具面无此名则不命中", async () => {
  const ws = await workspace();
  const pathEntry = activeEntry(ws, {
    kind: "warning",
    scope: { workspace: ws, pathGlobs: ["src/**"] },
    trigger: { when: "on-path", keywords: ["src/**"] },
    body: "PATH_SCOPED_MEMORY",
  });
  const toolEntry = activeEntry(ws, {
    kind: "strategy",
    scope: { workspace: ws, toolchain: ["edit_file"] },
    trigger: { when: "on-tool", signal: "edit_file" },
    body: "TOOL_SCOPED_MEMORY",
  });
  const absentTool = activeEntry(ws, {
    kind: "strategy",
    scope: { workspace: ws, toolchain: ["web_search"] },
    trigger: { when: "on-tool", signal: "web_search" },
    body: "ABSENT_TOOL_MEMORY",
  });
  await appendPlaybookEvents(ws, [pathEntry, toolEntry, absentTool].map(addOp));

  const system = await capturedSystem(ws, "修复 src/parser.test.ts 的解析报错");
  expect(system).toContain("PATH_SCOPED_MEMORY");
  expect(system).toContain("TOOL_SCOPED_MEMORY");
  expect(system).not.toContain("ABSENT_TOOL_MEMORY");

  // 基线注入（无实验）也要归因：收束时的 Episode 才有「注入了哪几条」。
  const stamp = await readAssignment(ws, "session");
  expect(stamp).toMatchObject({ experimentId: null, arm: "none" });
  expect([...(stamp?.injectedExperienceIds ?? [])].sort()).toEqual([pathEntry.id, toolEntry.id].sort());
});

function successEpisode(workspace: string, id: string, ts: number, injected: string[]): EpisodeRecord {
  const meta = { type: "session_meta", ts } as unknown as AgentEvent;
  const user = { type: "user_message", content: "修解析器" } as AgentEvent;
  const usage = { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent;
  const verify = { type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 1, results: [] } as AgentEvent;
  return projectEpisode({
    events: [meta, user, verify, usage],
    workspace,
    sessionId: id,
    logPath: join(workspace, id + ".jsonl"),
    observedAt: ts,
    assignment: {
      source: "sidecar", experimentId: null, arm: "none", propensity: null,
      policyVersion: "evolve-v1", injectedExperienceIds: injected, injectedChars: 10,
    },
  });
}

function redEpisode(workspace: string, id: string, ts: number): EpisodeRecord {
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
    sessionId: id,
    logPath: join(workspace, id + ".jsonl"),
    observedAt: ts,
  });
}

it("同一会话上一跑的 verify 红信号让 on-signal 经验在续聊时命中", async () => {
  const ws = await workspace();
  const entry = activeEntry(ws, {
    kind: "warning",
    scope: { workspace: ws },
    trigger: { when: "on-signal", signal: "verify:red" },
    body: "VERIFY_RED_MEMORY",
  });
  await appendPlaybookEvents(ws, [entry].map(addOp));
  await appendEpisode(ws, redEpisode(ws, "conv", Date.now() - 1_000));

  const hit = await prepareEvolutionInjection({
    workspace: ws, sessionId: "conv", taskContent: "修解析器", now: Date.now(),
  });
  expect(hit.note).toContain("VERIFY_RED_MEMORY");
  const miss = await prepareEvolutionInjection({
    workspace: ws, sessionId: "other", taskContent: "修解析器", now: Date.now(),
  });
  expect(miss.note).not.toContain("VERIFY_RED_MEMORY");
});

it("续聊的上一跑信号真的进 system prompt", async () => {
  const ws = await workspace();
  const entry = activeEntry(ws, {
    kind: "warning",
    scope: { workspace: ws },
    trigger: { when: "on-signal", signal: "verify:red" },
    body: "VERIFY_RED_MEMORY",
  });
  await appendPlaybookEvents(ws, [entry].map(addOp));
  await appendEpisode(ws, redEpisode(ws, "session", Date.now() - 1_000));

  const system = await capturedSystem(ws, "修复 src/parser.test.ts 的解析报错");
  expect(system).toContain("VERIFY_RED_MEMORY");
});

it("观测账进入下一次注入的排序标签", async () => {
  const ws = await workspace();
  const good = activeEntry(ws, {
    kind: "strategy", scope: { workspace: ws }, trigger: { when: "always" }, body: "GOOD_EXPERIENCE",
  });
  await appendPlaybookEvents(ws, [good].map(addOp));

  const first = await prepareEvolutionInjection({
    workspace: ws, sessionId: "obs", taskContent: "修解析器", now: Date.now(),
  });
  expect(first.note).toContain("GOOD_EXPERIENCE");
  const stamp = await readAssignment(ws, "obs");
  expect([...(stamp?.injectedExperienceIds ?? [])].sort()).toEqual([good.id]);

  for (const n of [1, 2]) {
    await appendEpisode(ws, successEpisode(ws, "obs" + String(n), Date.now() + n, [good.id]));
  }
  const second = await prepareEvolutionInjection({
    workspace: ws, sessionId: "obs-next", taskContent: "修解析器", now: Date.now() + 10,
  });
  expect(second.note).toMatch(/\[strategy｜观测 2\/2\]/u);
});

it("任务没点路径时 on-path 经验不注入", async () => {
  const ws = await workspace();
  await appendPlaybookEvents(ws, [activeEntry(ws, {
    kind: "warning",
    scope: { workspace: ws, pathGlobs: ["src/**"] },
    trigger: { when: "on-path", keywords: ["src/**"] },
    body: "PATH_SCOPED_MEMORY",
  })].map(addOp));

  const system = await capturedSystem(ws, "修复解析器的报错");
  expect(system).not.toContain("PATH_SCOPED_MEMORY");
});

it("全局经验真的进 system prompt；STOP 停注；本地同 id 优先", async () => {
  const ws = await workspace();
  const globalHome = await mkdtemp(join(tmpdir(), "evolve-wiring-global-"));
  globalDirs.push(globalHome);
  vi.stubEnv("CAIRN_EVOLVE_HOME", globalHome);

  const id = "exp_abcdef0123456789";
  const globalEntry = newExperience({
    id,
    kind: "strategy",
    scope: { workspace: "*" },
    trigger: { when: "always" },
    body: "GLOBAL_E2E_MEMORY",
    status: "active",
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt: null,
  });
  await appendGlobalPlaybookEvents([{ v: 1, op: "add", ts: 1_000, entry: globalEntry, evidence: [], reason: "test" }]);

  const system = await capturedSystem(ws, "修解析器");
  expect(system).toContain("GLOBAL_E2E_MEMORY");
  const stamp = await readAssignment(ws, "session");
  expect(stamp?.injectedExperienceIds).toContain(id);

  await writeFile(globalEvolveStopPath(), "", "utf8");
  const frozenSystem = await capturedSystem(ws, "修解析器");
  expect(frozenSystem).not.toContain("GLOBAL_E2E_MEMORY");
  await rm(globalEvolveStopPath(), { force: true });

  // 本地同 id：运行时本地优先，全局正文不再注入（与 loadBaselineState 的合并口径一致）。
  const local = newExperience({
    id,
    kind: "strategy",
    scope: { workspace: ws },
    trigger: { when: "always" },
    body: "LOCAL_WINS_MEMORY",
    status: "active",
    evidenceEpisodes: ["ep_local"],
    now: 1_000,
    expiresAt: null,
  });
  await appendPlaybookEvents(ws, [addOp(local)]);
  const localSystem = await capturedSystem(ws, "修解析器");
  expect(localSystem).toContain("LOCAL_WINS_MEMORY");
  expect(localSystem).not.toContain("GLOBAL_E2E_MEMORY");
});
