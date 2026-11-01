import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunQueue } from "../src/renderer/state/run-queue";
import { runKey } from "../src/renderer/state/session-identity";
import type { QueuedSend } from "../src/renderer/send-queue";

type Deps = Parameters<typeof useRunQueue>[0];
const ref = <T,>(current: T) => ({ current });

// Run the actual hook; only the process boundary is replaced. The requests emitted
// there determine which persisted conversation receives the user's next message.
function harness(sessionId: string | null = "current") {
  const agent = {
    createSession: vi.fn(async () => ({ id: "created", workspace: "/workspace" })),
    run: vi.fn(async (_request: unknown): Promise<{ ok: boolean; error?: string; aborted?: boolean; accepted?: boolean }> => ({ ok: true })),
    runSteer: vi.fn(async (_sessionId: string, _text: string) => ({ ok: true })),
    runCancel: vi.fn(async (_sessionId: string): Promise<{ ok: boolean; error?: string; code?: "workspace_mismatch" }> => ({ ok: true })),
    setGoal: vi.fn(async (_request: unknown) => ({ ok: true })),
    queueSet: vi.fn(async (_sessionId: string, _items: unknown, _workspace?: string): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
    sessionPrefsSet: vi.fn(async (_sessionId: string, _prefs: unknown, _workspace?: string) => ({ ok: true })),
  };
  vi.stubGlobal("window", { agent });
  const sendQueue = ref(new Map<string, QueuedSend[]>());
  const deps: Deps = {
    setQueueLocal: (key: string, list: QueuedSend[]) => { sendQueue.current.set(key, list); }, queueWrites: ref(new Map()), queueDirty: ref(new Set()), setLastError: vi.fn(),
    sendQueue, setStoppedIds: vi.fn(), runningSet: ref(new Set()),
    lastDeltaAt: ref(new Map()), runGen: ref(new Map()), runStartBySession: ref(new Map()),
    force: vi.fn(), thinkingBySession: ref(new Map([[runKey("/workspace", "current"), "high"]])), pendingThinking: "medium",
    modeRef: ref("default"), selections: ref(new Map([[runKey("/workspace", "current"), "chosen-model"]])),
    activeId: sessionId, activeIdRef: ref(sessionId), editCtxRef: ref(null), setEditCtx: vi.fn(),
    askById: ref(new Map()), setLastNotice: vi.fn(), queueSeq: ref(0), setPendingSend: vi.fn(),
    activeWorkspace: "/workspace", setActiveWorkspace: vi.fn(), activate: vi.fn(),
    refreshSessions: vi.fn(async () => undefined), setDraftRestore: vi.fn(),
    draftRestoreSeq: ref(0), compactNow: vi.fn(),
    eventsRef: ref([{ type: "user_message", content: "original request" }]),
  };
  let actions: ReturnType<typeof useRunQueue>;
  function Probe() { actions = useRunQueue(deps); return null; }
  const render = () => { renderToStaticMarkup(createElement(Probe)); return actions!; };
  return { agent, deps, render, actions: render() };
}

afterEach(() => vi.unstubAllGlobals());

describe("send keeps the active conversation", () => {
  it("reports a refused background run instead of claiming it started", async () => {
    const { agent, actions } = harness();
    agent.run.mockResolvedValueOnce({ ok: false, error: "同名会话被其他工作区的执行占用" });
    expect(await actions.sendTo("same", "/b", "continue B")).toEqual({ outcome: "failed", error: "同名会话被其他工作区的执行占用" });
    expect(agent.runSteer).not.toHaveBeenCalled();
  });
  it("sends the addressed workspace's model and thinking for a same-id background conversation", async () => {
    const { agent, deps, render } = harness("same");
    deps.activeWorkspace = "/a";
    deps.selections.current = new Map([[runKey("/a", "same"), "model-a"], [runKey("/b", "same"), "model-b"]]);
    deps.thinkingBySession.current = new Map([[runKey("/a", "same"), "high"], [runKey("/b", "same"), "low"]]);
    await render().sendTo("same", "/b", "continue B");
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "same", workspace: "/b", model: "model-b", thinking: "low" }));
  });

  it("appends consecutive idle messages using the current model and thinking selection", async () => {
    const { actions, agent, deps } = harness();
    await actions.send("follow up");
    await actions.send("another follow up");
    expect(agent.run.mock.calls.map(([request]) => request)).toEqual([
      { message: "follow up", mode: "default", sessionId: "current", workspace: "/workspace", model: "chosen-model", thinking: "high" },
      { message: "another follow up", mode: "default", sessionId: "current", workspace: "/workspace", model: "chosen-model", thinking: "high" },
    ]);
    expect(agent.createSession).not.toHaveBeenCalled();
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it("creates once from home, then appends the next message to that conversation", async () => {
    const { agent, deps, render } = harness(null);
    deps.activeWorkspace = null;
    await render().send("first");
    expect(agent.createSession).toHaveBeenCalledTimes(1);
    expect(deps.setActiveWorkspace).toHaveBeenCalledWith("/workspace");
    expect(deps.activate).toHaveBeenCalledWith("created");
    expect(agent.sessionPrefsSet).toHaveBeenCalledWith("created", { thinking: "medium" }, "/workspace");
    deps.activeId = deps.activeIdRef.current = "created";
    deps.activeWorkspace = "/workspace";
    await render().send("second");
    expect(agent.createSession).toHaveBeenCalledTimes(1);
    expect(agent.run.mock.calls.map(([request]) => request)).toEqual([
      { message: "first", mode: "default", sessionId: "created", workspace: "/workspace", model: undefined, thinking: "medium" },
      { message: "second", mode: "default", sessionId: "created", workspace: "/workspace", model: undefined, thinking: "medium" },
    ]);
  });

  it("starts the first run under the workspace returned by createSession", async () => {
    const { agent, deps, render } = harness(null);
    deps.activeWorkspace = null;
    let release: (value: { ok: boolean }) => void = () => undefined;
    agent.run.mockImplementationOnce(() => new Promise<{ ok: boolean }>((resolve) => { release = resolve; }));

    const pending = render().send("first");
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    expect(deps.setActiveWorkspace).toHaveBeenCalledWith("/workspace");
    expect(deps.runningSet.current.has(runKey("/workspace", "created"))).toBe(true);
    expect(deps.runningSet.current.has("created")).toBe(false);

    release({ ok: true });
    await pending;
    expect(deps.runningSet.current.size).toBe(0);
  });

  it("handleRetryLast reruns inside the current conversation", async () => {
    const { actions, agent } = harness();
    actions.handleRetryLast();
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "current", message: "original request" }));
    expect(agent.createSession).not.toHaveBeenCalled();
  });

  it("sets /goal and starts its run on the same existing conversation", async () => {
    const { actions, agent } = harness();
    actions.sendWithGoal("/goal finish this task", []);
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    expect(agent.setGoal).toHaveBeenCalledWith({ sessionId: "current", objective: "finish this task" });
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "current", message: "finish this task" }));
    expect(agent.createSession).not.toHaveBeenCalled();
  });

  it("creation failure restores the home draft and does not start a run", async () => {
    const { actions, agent, deps } = harness(null);
    agent.createSession.mockRejectedValueOnce(new Error("cannot create"));
    await actions.send("keep this draft");
    expect(agent.run).not.toHaveBeenCalled();
    expect(deps.setDraftRestore).toHaveBeenCalledWith({ forSession: null, text: "keep this draft", attachments: [], seq: 1 });
    expect(deps.setPendingSend).toHaveBeenLastCalledWith(false);
  });
});

describe("sendTo for preview sessions", () => {
  it("idle target in another workspace runs under that workspace, not the active one", async () => {
    const { actions, agent, deps } = harness();
    let release: (value: { ok: boolean }) => void = () => undefined;
    agent.run.mockImplementationOnce(() => new Promise<{ ok: boolean }>((resolve) => { release = resolve; }));

    const pending = actions.sendTo("other", "/other-ws", "continue there", [], { running: false });
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "other", message: "continue there" }));
    expect(deps.runningSet.current.has(runKey("/other-ws", "other"))).toBe(true);
    expect(deps.runningSet.current.has(runKey("/workspace", "other"))).toBe(false);

    release({ ok: true });
    await expect(pending).resolves.toEqual({ outcome: "started" });
  });

  it("running target steers; a rejected steer falls back to the shared queue", async () => {
    const { actions, agent, deps } = harness();
    agent.runSteer.mockResolvedValueOnce({ ok: false });

    const queued = await actions.sendTo("other", "/other-ws", "queued while running", [], { running: true });
    expect(queued.outcome).toBe("queued");
    expect(agent.runSteer).toHaveBeenCalledWith("other", "queued while running", "/other-ws");
    expect(deps.sendQueue.current.get(runKey("/other-ws", "other"))).toHaveLength(1);
    expect(deps.sendQueue.current.get(runKey("/workspace", "current"))).toBeUndefined();

    const steered = await actions.sendTo("other", "/other-ws", "goes into the run", [], { running: true });
    expect(steered.outcome).toBe("steered");
  });

  it("“already running” from a stale idle hint falls back to steer instead of losing the text", async () => {
    const { actions, agent } = harness();
    agent.run.mockResolvedValueOnce({ ok: false, error: "session already running or being deleted" });

    const result = await actions.sendTo("other", "/other-ws", "do not lose me", [], { running: false });
    expect(result.outcome).toBe("steered");
    expect(agent.runSteer).toHaveBeenCalledWith("other", "do not lose me", "/other-ws");
  });
});

describe("workspace scoped run controls", () => {
  it("the main composer includes its workspace when steering", async () => {
    const { actions, agent, deps } = harness();
    deps.runningSet.current.add(runKey("/workspace", "current"));
    await actions.send("for this project");
    expect(agent.runSteer).toHaveBeenCalledWith("current", "for this project", "/workspace");
  });
  it("a refused cancel does not dequeue or dispatch the target project's messages", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/other-ws", "same");
    const items = [{ id: 1, text: "keep this queued", attachments: [] }];
    deps.sendQueue.current.set(key, items); deps.runningSet.current.add(key);
    agent.runCancel.mockResolvedValueOnce({ ok: false, error: "目标工作区不匹配", code: "workspace_mismatch" });
    actions.cancelRunHeal("same", "/other-ws");
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("目标工作区不匹配", "same"));
    expect(agent.runCancel).toHaveBeenCalledWith("same", "/other-ws");
    expect(agent.run).not.toHaveBeenCalled(); expect(agent.queueSet).not.toHaveBeenCalled();
    expect(deps.sendQueue.current.get(key)).toEqual(items);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function writesDone(deps: Deps) {
  while (deps.queueWrites.current.size > 0) await Promise.all([...deps.queueWrites.current.values()]);
}
const queued = (id: number): QueuedSend => ({ id, text: `queued ${id}`, attachments: [] });

describe("queue persistence before dispatch", () => {
  it("does not execute before the dequeue save is acknowledged; failure keeps the head", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), head = queued(1);
    deps.sendQueue.current.set(key, [head]);
    const save = deferred<{ ok: boolean; error?: string }>();
    agent.queueSet.mockImplementationOnce(() => save.promise);
    try {
      actions.resumeQueue();
      await vi.waitFor(() => expect(agent.queueSet).toHaveBeenCalledTimes(1));
      expect(agent.run).not.toHaveBeenCalled();
    } finally { save.resolve({ ok: false, error: "disk full" }); await writesDone(deps); }
    expect(deps.sendQueue.current.get(key)).toEqual([head]);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("preserves a failed head together with messages appended during its save", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), head = queued(1), tail = queued(2), added = queued(3);
    deps.sendQueue.current.set(key, [head, tail]);
    const save = deferred<{ ok: boolean; error?: string }>();
    agent.queueSet.mockImplementationOnce(() => save.promise);
    actions.resumeQueue();
    await vi.waitFor(() => expect(agent.queueSet).toHaveBeenCalledTimes(1));
    actions.setQueueFor("current", [...(deps.sendQueue.current.get(key) ?? []), added], "/workspace");
    save.resolve({ ok: false, error: "disk full" }); await writesDone(deps);
    expect(deps.sendQueue.current.get(key)).toEqual([head, tail, added]);
    expect(agent.queueSet).toHaveBeenLastCalledWith("current", [head, tail, added].map(({ text, attachments }) => ({ text, attachments })), "/workspace");
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("stops automatic draining after a save failure and retries only on explicit resume", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), head = queued(1);
    const firstRun = deferred<{ ok: boolean }>();
    agent.run.mockImplementationOnce(() => firstRun.promise);
    const sending = actions.send("first message");
    agent.queueSet.mockResolvedValueOnce({ ok: false, error: "disk full" });
    actions.setQueueFor("current", [head], "/workspace"); await writesDone(deps);
    firstRun.resolve({ ok: true }); await sending;
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(deps.sendQueue.current.get(key)).toEqual([head]);
    actions.resumeQueue();
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(2));
    await writesDone(deps);
    expect(agent.run).toHaveBeenLastCalledWith(expect.objectContaining({ message: head.text }));
  });

  it("repeated resume during a pending save reserves only one drain", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"); deps.sendQueue.current.set(key, [queued(1), queued(2)]);
    const save = deferred<{ ok: boolean }>(), firstRun = deferred<{ ok: boolean }>();
    agent.queueSet.mockImplementationOnce(() => save.promise); agent.run.mockImplementationOnce(() => firstRun.promise);
    actions.resumeQueue(); actions.resumeQueue();
    await vi.waitFor(() => expect(agent.queueSet).toHaveBeenCalledTimes(1));
    try { expect(agent.run).not.toHaveBeenCalled(); }
    finally { save.resolve({ ok: true }); }
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    actions.resumeQueue(); expect(agent.run).toHaveBeenCalledTimes(1);
    firstRun.resolve({ ok: true });
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(2)); await writesDone(deps);
    expect(agent.run.mock.calls.map(([r]) => (r as { message: string }).message)).toEqual(["queued 1", "queued 2"]);
  });

  it("restores a queue message only when the host explicitly did not accept it", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), head = queued(1); deps.sendQueue.current.set(key, [head]);
    agent.run.mockResolvedValueOnce({ ok: false, accepted: false, error: "target occupied" });
    actions.resumeQueue();
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("target occupied", "current")); await writesDone(deps);
    expect(deps.sendQueue.current.get(key)).toEqual([head]);
    expect(agent.queueSet).toHaveBeenLastCalledWith("current", [{ text: head.text, attachments: [] }], "/workspace");
  });

  it("does not requeue an accepted message when execution fails", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), tail = queued(2); deps.sendQueue.current.set(key, [queued(1), tail]);
    agent.run.mockResolvedValueOnce({ ok: false, accepted: true, error: "tool failed" });
    actions.resumeQueue();
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("tool failed", "current")); await writesDone(deps);
    expect(deps.sendQueue.current.get(key)).toEqual([tail]);
    expect(agent.run).toHaveBeenCalledTimes(1);
  });

  it("a rejected queue write is handled without losing the head or dispatching", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), head = queued(1); deps.sendQueue.current.set(key, [head]);
    agent.queueSet.mockRejectedValueOnce(new Error("IPC write unavailable"));
    actions.resumeQueue(); await writesDone(deps);
    expect(deps.sendQueue.current.get(key)).toEqual([head]);
    expect(deps.queueDirty.current.has(key)).toBe(true);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("cancellation before admission restores the message and stops instead of retrying in a loop", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), head = queued(1); deps.sendQueue.current.set(key, [head]);
    agent.run.mockResolvedValueOnce({ ok: false, accepted: false, aborted: true, error: "cancelled before admission" });
    actions.resumeQueue();
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalled()); await writesDone(deps);
    expect(deps.sendQueue.current.get(key)).toEqual([head]); expect(agent.run).toHaveBeenCalledTimes(1);
  });
});
