import { describe, expect, it } from "vitest";
import { projectAgentThreads } from "../src/agent/agent-thread-projector";
import type { AgentEvent } from "../src/events";

function spawn(agentId: string, threadId: string, ts: number, fence = "f1"): AgentEvent {
  return {
    type: "agent_spawned",
    agent_id: agentId,
    thread_id: threadId,
    fence,
    parent_event_id: 1,
    mode: "read",
    task: "task " + agentId,
    max_turns: 8,
    permission_mode: "read-only",
    ts,
  };
}

function status(agentId: string, threadId: string, value: "running" | "done" | "failed" | "cancelled", ts: number, fence = "f1"): AgentEvent {
  return {
    type: "agent_status",
    agent_id: agentId,
    thread_id: threadId,
    fence,
    status: value,
    ts,
  };
}

function result(agentId: string, threadId: string, summary: string, ts: number, fence = "f1"): AgentEvent {
  return {
    type: "agent_result",
    agent_id: agentId,
    thread_id: threadId,
    fence,
    status: "done",
    summary,
    artifacts: {},
    usage: { inputTokens: 3, outputTokens: 2 },
    tool_stats: {},
    ts,
  };
}

describe("projectAgentThreads", () => {
  it("accumulates multiple runs under one stable logical thread", () => {
    const snapshot = projectAgentThreads([
      spawn("run-1", "thread-1", 1, "f1"),
      status("run-1", "thread-1", "done", 2, "f1"),
      result("run-1", "thread-1", "first pass", 3, "f1"),
      spawn("run-2", "thread-1", 4, "f2"),
      status("run-2", "thread-1", "running", 5, "f2"),
    ], "/ws", "session-1");

    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]).toMatchObject({
      id: "thread-1",
      workspace: "/ws",
      sessionId: "session-1",
      status: "running",
      currentRunId: "run-2",
      runIds: ["run-1", "run-2"],
      fence: "f2",
      summary: "first pass",
    });
  });

  it("deduplicates message ids and sorts out-of-order source events", () => {
    const snapshot = projectAgentThreads([
      {
        type: "agent_message",
        agent_id: "run-1",
        thread_id: "thread-1",
        message_id: "m-1",
        kind: "report",
        text: "first copy",
        ts: 30,
      },
      spawn("run-1", "thread-1", 10),
      {
        type: "agent_message",
        agent_id: "run-1",
        thread_id: "thread-1",
        message_id: "m-2",
        kind: "progress",
        text: "earlier",
        ts: 20,
      },
      {
        type: "agent_message",
        agent_id: "run-1",
        thread_id: "thread-1",
        message_id: "m-1",
        kind: "report",
        text: "duplicate copy",
        ts: 31,
      },
    ], "/ws", "session-1");

    expect(snapshot.messages.map((message) => message.id)).toEqual(["m-2", "m-1"]);
    expect(snapshot.messages.find((message) => message.id === "m-1")?.text).toBe("first copy");
  });

  it("does not let a late result from an older run overwrite the current run", () => {
    const snapshot = projectAgentThreads([
      spawn("run-1", "thread-1", 1, "f1"),
      status("run-1", "thread-1", "running", 2, "f1"),
      spawn("run-2", "thread-1", 3, "f2"),
      status("run-2", "thread-1", "running", 4, "f2"),
      status("run-1", "thread-1", "failed", 5, "f1"),
      result("run-1", "thread-1", "late stale result", 6, "f1"),
    ], "/ws", "session-1");

    expect(snapshot.threads[0]).toMatchObject({
      id: "thread-1",
      status: "running",
      currentRunId: "run-2",
      fence: "f2",
    });
    expect(snapshot.threads[0]?.summary).not.toBe("late stale result");
    expect(snapshot.anomalies).toContain("late-result:run-1");
  });

  it("falls back to agent id as the logical id for legacy logs", () => {
    const snapshot = projectAgentThreads([
      {
        type: "agent_spawned",
        agent_id: "legacy-1",
        parent_event_id: 1,
        mode: "read",
        task: "legacy",
        max_turns: 4,
        permission_mode: "read-only",
        ts: 1,
      },
    ], "/ws", "session-1");
    expect(snapshot.threads[0]?.id).toBe("legacy-1");
    expect(snapshot.threads[0]?.runIds).toEqual(["legacy-1"]);
  });
});

