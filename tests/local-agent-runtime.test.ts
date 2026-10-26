import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalAgentRuntime,
  type LocalAgentRuntime,
  type LocalAgentOrchestrator,
} from "../src/agent/local-agent-runtime";
import { projectAgentThreads } from "../src/agent/agent-thread-projector";
import { Orchestrator, type WorkerModel } from "../src/agent/orchestrator";
import { createEventLog, type AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import type { GlmMessage } from "../src/providers/glm";
import type { SpawnArgs } from "../src/agent/orchestrator-types";
import type { ToolResult } from "../src/tools/base";

class FakeOrchestrator implements LocalAgentOrchestrator {
  spawns: Array<{ args: SpawnArgs; ctx: { callId?: string; threadId?: string; fence?: string } }> = [];
  followUps: Array<{ agentId: string; messageId: string; text: string; threadId?: string; fence?: string }> = [];
  events: AgentEvent[] = [];
  rows = new Map<string, { status: string; summary: string }>();
  private sequence = 0;

  async spawn(args: SpawnArgs, ctx: { callId?: string; threadId?: string; fence?: string }): Promise<ToolResult> {
    this.spawns.push({ args, ctx });
    const id = "run-" + String(++this.sequence);
    this.rows.set(id, { status: "running", summary: "" });
    return { ok: true, output: JSON.stringify({ agent_id: id }) };
  }

  async followUp(
    agentId: string,
    messageId: string,
    text: string,
    threadId?: string,
    fence?: string,
  ): Promise<{ ok: boolean; duplicate?: boolean; reason?: string }> {
    this.followUps.push({ agentId, messageId, text, threadId, fence });
    this.rows.set(agentId, { status: "running", summary: this.rows.get(agentId)?.summary ?? "" });
    return { ok: true };
  }

  async waitForAgents(ids: readonly string[], _timeoutMs: number): Promise<{
    rows: Array<{ agent_id: string; status: string; summary: string }>;
    timedOut: string[];
  }> {
    return {
      rows: ids.map((id) => ({
        agent_id: id,
        status: this.rows.get(id)?.status ?? "unknown",
        summary: this.rows.get(id)?.summary ?? "",
      })),
      timedOut: [],
    };
  }

  resumeAgent(agentId: string): boolean {
    if (!this.rows.has(agentId)) return false;
    this.rows.set(agentId, { status: "running", summary: this.rows.get(agentId)?.summary ?? "" });
    return true;
  }

  cancelAgent(agentId: string): boolean {
    const row = this.rows.get(agentId);
    if (!row || ["done", "failed", "cancelled"].includes(row.status)) return false;
    this.rows.set(agentId, { ...row, status: "cancelled" });
    return true;
  }

  async appendProtocol(event: AgentEvent): Promise<void> {
    this.events.push(event);
  }

  finish(agentId: string, summary: string, status = "done"): void {
    this.rows.set(agentId, { status, summary });
  }

  wait(agentId: string, status: string): void {
    this.rows.set(agentId, { status, summary: this.rows.get(agentId)?.summary ?? "" });
  }
}

describe("createLocalAgentRuntime", () => {
  it("delivers two follow-ups to one active thread and is idempotent by message id", async () => {
    const driver = new FakeOrchestrator();
    const runtime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });

    const first = await runtime.send(spawned.id, { id: "m1", text: "look left" }, "f1");
    const duplicate = await runtime.send(spawned.id, { id: "m1", text: "look left" }, "f1");
    const second = await runtime.send(spawned.id, { id: "m2", text: "look right" }, "f1");

    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(second.ok).toBe(true);
    expect(driver.followUps).toHaveLength(2);
    expect(driver.followUps.map((item) => item.messageId)).toEqual(["m1", "m2"]);
    expect(driver.followUps.every((item) => item.threadId === spawned.id)).toBe(true);
  });

  it("starts a continuation run after done while preserving the logical thread id", async () => {
    const driver = new FakeOrchestrator();
    const runtime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });
    const firstRunId = spawned.currentRunId!;
    driver.finish(firstRunId, "first summary");
    await runtime.wait([spawned.id], { timeoutMs: 10 });

    const receipt = await runtime.send(spawned.id, { id: "m3", text: "continue with tests" });
    const snapshot = await runtime.list();
    expect(receipt.duplicate).toBe(false);
    expect(driver.spawns).toHaveLength(2);
    expect(driver.spawns[1]?.ctx.threadId).toBe(spawned.id);
    expect(String(driver.spawns[1]?.args.task)).toContain("first summary");
    expect(String(driver.spawns[1]?.args.task)).toContain("continue with tests");
    expect(snapshot[0]?.runIds).toHaveLength(2);
  });

  it("starts a continuation when the executor finished before the runtime observed it", async () => {
    const driver = new FakeOrchestrator();
    const runtime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });
    const firstRunId = spawned.currentRunId!;
    driver.finish(firstRunId, "first summary from executor");

    const receipt = await runtime.send(spawned.id, { id: "m-fresh", text: "continue now" });

    expect(receipt.ok).toBe(true);
    expect(driver.spawns).toHaveLength(2);
    expect(String(driver.spawns[1]?.args.task)).toContain("first summary from executor");
    expect(String(driver.spawns[1]?.args.task)).toContain("continue now");
  });

  it("refreshes list_agents from executor state without a prior wait", async () => {
    const driver = new FakeOrchestrator();
    const runtime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });
    driver.finish(spawned.currentRunId!, "completed");

    const snapshot = await runtime.list();

    expect(snapshot[0]).toMatchObject({ status: "done", summary: "completed" });
  });

  it("rejects a stale resume fence", async () => {
    const driver = new FakeOrchestrator();
    const runtime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });
    driver.wait(spawned.currentRunId!, "waiting_input");

    await expect(runtime.resume(spawned.id, "stale")).rejects.toThrow(/fence/i);
    await expect(runtime.resume(spawned.id, "f1")).resolves.toMatchObject({
      id: spawned.id,
      status: "running",
    });
  });

  it("close confirms executor stop and is idempotent", async () => {
    const driver = new FakeOrchestrator();
    const runtime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });

    const first = await runtime.close(spawned.id);
    const second = await runtime.close(spawned.id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
  });

  it("exposes a stable thread id in the spawn receipt while preserving the raw spawn result and args", async () => {
    const driver = new FakeOrchestrator();
    const runtime: LocalAgentRuntime = createLocalAgentRuntime(driver);
    const spawned = await runtime.spawnWithReceipt(
      { threadId: "thread-a", task: "inspect", mode: "read", fence: "f1" },
      { task: "inspect", mode: "read", role: "review", tier: "strong", depends_on: ["upstream"] },
    );

    expect(spawned.record?.id).toBe("thread-a");
    expect(spawned.result.ok).toBe(true);
    expect(JSON.parse(spawned.result.output)).toMatchObject({
      agent_id: "run-1",
      run_id: "run-1",
      thread_id: "thread-a",
    });
    expect(driver.spawns[0]?.args).toMatchObject({
      role: "review",
      tier: "strong",
      depends_on: ["upstream"],
    });
  });
});

describe("local runtime with the real Orchestrator", () => {
  let work = "";
  let logPath = "";
  const temporaryDirs: string[] = [];

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "local-runtime-"));
    temporaryDirs.push(work);
    logPath = join(work, "events.jsonl");
    await writeFile(logPath, "", "utf8");
    vi.stubEnv("M2D_MEMORY_HOME", join(work, "memory"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("delivers a running follow-up into the next model round under one projected thread", async () => {
    const captures: GlmMessage[][] = [];
    let releaseStart = (): void => {};
    const started = new Promise<void>((resolve) => { releaseStart = resolve; });
    const model: WorkerModel = async function* (messages) {
      await started;
      captures.push(messages);
      if (captures.length === 1) {
        yield { type: "assistant_message", content: "first round" } as ModelOutput;
        yield {
          type: "tool_call",
          id: "inspect-1",
          name: "read_file",
          args: { path: "missing.txt" },
        } as ModelOutput;
        yield { type: "usage", inputTokens: 3, outputTokens: 2 } as ModelOutput;
        return;
      }
      yield {
        type: "assistant_message",
        content: "## 结论\n- follow-up handled\n\n## 证据路径\n- missing.txt\n\n## 风险\n- 无。\n\n## 未决问题\n- 无。",
      } as ModelOutput;
      yield { type: "usage", inputTokens: 4, outputTokens: 3 } as ModelOutput;
    };
    const events: AgentEvent[] = [];
    let runtime: ReturnType<typeof createLocalAgentRuntime> | undefined;
    let spawnedId = "";
    let followUp: Promise<unknown> | undefined;
    const orchestrator = new Orchestrator({
      logPath,
      workspace: work,
      parentMode: "auto",
      modelFor: () => model,
      emit: async (event) => {
        events.push(event);
        await createEventLog(logPath).append(event);
        if (event.type === "tool_call" && event.id === "inspect-1" && followUp === undefined) {
          if (runtime === undefined) throw new Error("runtime was not wired before the first tool call");
          followUp = runtime.send(spawnedId, { id: "follow-1", text: "inspect the next branch" }, "f1");
          await followUp;
        }
      },
    });
    runtime = createLocalAgentRuntime(orchestrator);
    const spawned = await runtime.spawn({ task: "inspect", mode: "read", fence: "f1" });
    spawnedId = spawned.id;
    releaseStart();

    await runtime.wait([spawned.id], { timeoutMs: 10_000 });
    await followUp;

    expect(captures).toHaveLength(2);
    expect(captures[1]?.some((message) => String(message.content).includes("inspect the next branch"))).toBe(true);
    const projected = projectAgentThreads(events, work, "session-1");
    expect(projected.threads.map((thread) => thread.id)).toEqual([spawned.id]);
    expect(projected.anomalies).toEqual([]);
  });

  it("keeps continuation runs in one projected thread and carries the previous summary", async () => {
    const captures: GlmMessage[][] = [];
    let call = 0;
    const model: WorkerModel = async function* (messages) {
      captures.push(messages);
      call++;
      const conclusion = call === 1 ? "first pass" : "second pass";
      yield {
        type: "assistant_message",
        content: "## 结论\n- " + conclusion + "\n\n## 证据路径\n- src/a.ts:1\n\n## 风险\n- 无。\n\n## 未决问题\n- 无。",
      } as ModelOutput;
      yield { type: "usage", inputTokens: 2, outputTokens: 1 } as ModelOutput;
    };
    const events: AgentEvent[] = [];
    const orchestrator = new Orchestrator({
      logPath,
      workspace: work,
      parentMode: "auto",
      modelFor: () => model,
      emit: async (event) => { events.push(event); await createEventLog(logPath).append(event); },
    });
    const runtime = createLocalAgentRuntime(orchestrator);
    const spawned = await runtime.spawn({ task: "inspect repository", mode: "read", fence: "f1" });

    await runtime.wait([spawned.id], { timeoutMs: 10_000 });
    const receipt = await runtime.send(spawned.id, { id: "follow-2", text: "continue with tests" });
    await runtime.wait([spawned.id], { timeoutMs: 10_000 });

    expect(receipt.ok).toBe(true);
    expect(captures).toHaveLength(2);
    const continuation = captures[1]?.map((message) => String(message.content)).join("\n") ?? "";
    expect(continuation).toContain("inspect repository");
    expect(continuation).toContain("first pass");
    expect(continuation).toContain("continue with tests");
    const projected = projectAgentThreads(events, work, "session-1");
    expect(projected.threads).toHaveLength(1);
    expect(projected.threads[0]?.id).toBe(spawned.id);
    expect(projected.threads[0]?.runIds).toHaveLength(2);
    expect(projected.anomalies).toEqual([]);
  });
});

