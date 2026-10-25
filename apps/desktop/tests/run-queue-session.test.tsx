import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunQueue } from "../src/renderer/state/run-queue";

type Deps = Parameters<typeof useRunQueue>[0];
const ref = <T,>(current: T) => ({ current });

// Run the actual hook; only the process boundary is replaced. The requests emitted
// there determine which persisted conversation receives the user's next message.
function harness(sessionId: string | null = "current") {
  const agent = {
    createSession: vi.fn(async () => ({ id: "created", workspace: "/workspace" })),
    run: vi.fn(async (_request: unknown) => ({ ok: true })),
    setGoal: vi.fn(async (_request: unknown) => ({ ok: true })),
  };
  vi.stubGlobal("window", { agent });
  const deps: Deps = {
    setQueueLocal: vi.fn(), queueWrites: ref(new Map()), setLastError: vi.fn(),
    sendQueue: ref(new Map()), setStoppedIds: vi.fn(), runningSet: ref(new Set()),
    lastDeltaAt: ref(new Map()), runGen: ref(new Map()), runStartBySession: ref(new Map()),
    force: vi.fn(), thinkingBySession: ref(new Map([["current", "high"]])), pendingThinking: "medium",
    modeRef: ref("default"), selections: ref(new Map([["current", "chosen-model"]])),
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
  it("appends consecutive idle messages using the current model and thinking selection", async () => {
    const { actions, agent, deps } = harness();
    await actions.send("follow up");
    await actions.send("another follow up");
    expect(agent.run.mock.calls.map(([request]) => request)).toEqual([
      { message: "follow up", mode: "default", sessionId: "current", model: "chosen-model", thinking: "high" },
      { message: "another follow up", mode: "default", sessionId: "current", model: "chosen-model", thinking: "high" },
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
    deps.activeId = deps.activeIdRef.current = "created";
    deps.activeWorkspace = "/workspace";
    await render().send("second");
    expect(agent.createSession).toHaveBeenCalledTimes(1);
    expect(agent.run.mock.calls.map(([request]) => request)).toEqual([
      { message: "first", mode: "default", sessionId: "created", model: undefined, thinking: "medium" },
      { message: "second", mode: "default", sessionId: "created", model: undefined, thinking: "medium" },
    ]);
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
