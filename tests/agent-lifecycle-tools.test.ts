import { describe, expect, it } from "vitest";
import { gateToolSpecs } from "../src/agent/session-provider";
import {
  createAgentLifecycleTools,
  type AgentLifecycleHost,
} from "../src/tools/agent-lifecycle";
import type {
  AgentReceipt,
  AgentRecord,
  AgentRuntime,
  AgentWaitResult,
} from "../src/agent/runtime-types";
import { INJECTED_TOOLS } from "../src/agent/tool-surface";
import { workerToolSpecs } from "../src/agent/worker-shell-tools";
import { workerToolTable } from "../src/agent/orchestrator-config";

function record(id: string, over: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    workspace: "/workspace",
    sessionId: "session-1",
    task: "inspect",
    mode: "read",
    status: "running",
    currentRunId: "run-1",
    runIds: ["run-1"],
    fence: "f1",
    createdAt: 1,
    updatedAt: 2,
    usage: { inputTokens: 1, outputTokens: 2 },
    ...over,
  };
}

class FakeRuntime implements AgentRuntime {
  readonly id: string;
  readonly records: AgentRecord[];
  readonly sends: Array<{ id: string; message: { id: string; text: string }; fence?: string }> = [];
  readonly resumes: Array<{ id: string; fence: string }> = [];
  readonly closes: string[] = [];

  constructor(id: string, records: AgentRecord[] = []) {
    this.id = id;
    this.records = records;
  }

  async spawn(): Promise<AgentRecord> {
    throw new Error("not used");
  }

  async send(id: string, message: { id: string; text: string }, fence?: string): Promise<AgentReceipt> {
    this.sends.push({ id, message, fence });
    const known = this.records.some((item) => item.id === id);
    return known
      ? {
          ok: true,
          threadId: id,
          runId: "run-1",
          messageId: message.id,
          duplicate: this.sends.filter((item) => item.id === id && item.message.id === message.id).length > 1,
        }
      : { ok: false, threadId: id, messageId: message.id, duplicate: false, reason: "unknown agent thread" };
  }

  async wait(): Promise<AgentWaitResult> {
    return { rows: this.records, timedOut: [], unknown: [] };
  }

  async resume(id: string, fence: string): Promise<AgentRecord> {
    this.resumes.push({ id, fence });
    const found = this.records.find((item) => item.id === id);
    if (found === undefined) throw new Error("unknown agent thread");
    if (found.fence !== fence) throw new Error("stale fence");
    return { ...found, status: "running" };
  }

  async close(id: string): Promise<AgentReceipt> {
    this.closes.push(id);
    const known = this.records.some((item) => item.id === id);
    return known
      ? { ok: true, threadId: id, runId: "run-1", duplicate: false }
      : { ok: false, threadId: id, duplicate: false, reason: "unknown agent thread" };
  }

  async list(): Promise<AgentRecord[]> {
    return this.records;
  }

  async cancel(): Promise<AgentReceipt[]> {
    return [];
  }
}

describe("agent lifecycle tool surface", () => {
  it("exposes all four tools only on the main subagent face", () => {
    const names = ["send_agent", "list_agents", "resume_agent", "close_agent"];
    const auto = new Set(gateToolSpecs("auto").map((spec) => spec.function.name));
    const readOnly = new Set(gateToolSpecs("read-only").map((spec) => spec.function.name));
    const workerRead = new Set(workerToolSpecs("read").map((spec) => spec.function.name));
    const workerWrite = new Set(workerToolSpecs("write").map((spec) => spec.function.name));

    for (const name of names) {
      expect(auto.has(name), name).toBe(true);
      expect(readOnly.has(name), name).toBe(false);
      expect(workerRead.has(name), name).toBe(false);
      expect(workerWrite.has(name), name).toBe(false);
      expect(workerToolTable("read", true), name).not.toContain(name);
      expect(workerToolTable("write", true), name).not.toContain(name);
      expect(INJECTED_TOOLS.some((item) => item.name === name), name).toBe(true);
    }
  });

  it("send_agent delegates to AgentRuntime and is idempotent by message id", async () => {
    const runtime = new FakeRuntime("session-a", [record("thread-a")]);
    const tools = createAgentLifecycleTools(() => runtime);

    const first = await tools.send_agent!.run(
      { thread_id: "thread-a", message_id: "m1", message: "inspect the parser", fence: "f1" },
      { workspace: "/workspace", callId: "call-1" },
    );
    const duplicate = await tools.send_agent!.run(
      { thread_id: "thread-a", message_id: "m1", message: "inspect the parser", fence: "f1" },
      { workspace: "/workspace", callId: "call-2" },
    );

    expect(first.ok, first.output).toBe(true);
    expect(JSON.parse(first.output)).toMatchObject({ ok: true, threadId: "thread-a", duplicate: false });
    expect(JSON.parse(duplicate.output)).toMatchObject({ ok: true, threadId: "thread-a", duplicate: true });
    expect(runtime.sends).toEqual([
      { id: "thread-a", message: { id: "m1", text: "inspect the parser" }, fence: "f1" },
      { id: "thread-a", message: { id: "m1", text: "inspect the parser" }, fence: "f1" },
    ]);
  });

  it("uses the tool call id as the default message idempotency key", async () => {
    const runtime = new FakeRuntime("session-a", [record("thread-a")]);
    const tools = createAgentLifecycleTools(() => runtime);

    const result = await tools.send_agent!.run(
      { thread_id: "thread-a", message: "continue" },
      { workspace: "/workspace", callId: "call-stable" },
    );

    expect(result.ok, result.output).toBe(true);
    expect(runtime.sends[0]?.message.id).toBe("call-stable");
  });

  it("lists, resumes, and closes through the same runtime", async () => {
    const runtime = new FakeRuntime("session-a", [record("thread-a", { status: "waiting" })]);
    const tools = createAgentLifecycleTools(() => runtime);

    const listed = await tools.list_agents!.run({}, { workspace: "/workspace" });
    const resumed = await tools.resume_agent!.run(
      { thread_id: "thread-a", fence: "f1" },
      { workspace: "/workspace" },
    );
    const closed = await tools.close_agent!.run(
      { thread_id: "thread-a" },
      { workspace: "/workspace" },
    );

    expect(JSON.parse(listed.output)).toMatchObject([{ id: "thread-a", status: "waiting" }]);
    expect(JSON.parse(resumed.output)).toMatchObject({ id: "thread-a", status: "running" });
    expect(JSON.parse(closed.output)).toMatchObject({ ok: true, threadId: "thread-a" });
    expect(runtime.resumes).toEqual([{ id: "thread-a", fence: "f1" }]);
    expect(runtime.closes).toEqual(["thread-a"]);
  });

  it("cannot target a thread owned by another session runtime", async () => {
    const runtimeA = new FakeRuntime("session-a", [record("thread-a")]);
    const runtimeB = new FakeRuntime("session-b");
    let current: AgentRuntime = runtimeA;
    const host: AgentLifecycleHost = { current: () => current };
    const tools = createAgentLifecycleTools(host.current);

    const sentA = await tools.send_agent!.run(
      { thread_id: "thread-a", message_id: "m1", message: "continue" },
      { workspace: "/workspace" },
    );
    current = runtimeB;
    const sentB = await tools.send_agent!.run(
      { thread_id: "thread-a", message_id: "m2", message: "wrong session" },
      { workspace: "/workspace" },
    );

    expect(sentA.ok, sentA.output).toBe(true);
    expect(sentB.ok).toBe(false);
    expect(JSON.parse(sentB.output)).toMatchObject({ ok: false, reason: "unknown agent thread" });
    expect(runtimeA.sends).toHaveLength(1);
    expect(runtimeB.sends).toHaveLength(1);
  });

  it("fails closed when no current runtime is wired", async () => {
    const tools = createAgentLifecycleTools(() => null);
    const result = await tools.list_agents!.run({}, { workspace: "/workspace" });
    expect(result).toMatchObject({ ok: false });
    expect(result.output).toContain("AgentRuntime");
  });

  it("passes resume failures back as a visible tool result", async () => {
    const runtime = new FakeRuntime("session-a", [record("thread-a")]);
    const tools = createAgentLifecycleTools(() => runtime);
    const result = await tools.resume_agent!.run(
      { thread_id: "thread-a", fence: "stale" },
      { workspace: "/workspace" },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("stale fence");
  });
});
