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
    setGoal: vi.fn(async (_request: unknown): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
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

  it("同 id 的两场 run 各持自己的代际与运行旗，先收束的那场不会留下假运行", async () => {
    const { actions, agent, deps } = harness();
    const keyA = runKey("/a", "same");
    const keyB = runKey("/b", "same");
    let finishA: (value: { ok: boolean }) => void = () => undefined;
    let finishB: (value: { ok: boolean }) => void = () => undefined;
    agent.run.mockImplementation((request: unknown) => {
      const workspace = (request as { workspace?: string }).workspace;
      return new Promise<{ ok: boolean }>((resolve) => {
        if (workspace === "/a") finishA = resolve;
        else finishB = resolve;
      });
    });

    const pendingA = actions.sendTo("same", "/a", "run A");
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    const pendingB = actions.sendTo("same", "/b", "run B");
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(2));
    expect(deps.runGen.current.get(keyA)).toBe(1);
    expect(deps.runGen.current.get(keyB)).toBe(1);

    finishA({ ok: true });
    await pendingA;
    await vi.waitFor(() => expect(deps.runningSet.current.has(keyA)).toBe(false));
    expect(deps.runningSet.current.has(keyB)).toBe(true);

    finishB({ ok: true });
    await pendingB;
    expect(deps.runningSet.current.size).toBe(0);
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
    expect(agent.setGoal).toHaveBeenCalledWith({ sessionId: "current", workspace: "/workspace", objective: "finish this task" });
    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "current", message: "finish this task" }));
    expect(agent.createSession).not.toHaveBeenCalled();
  });

  it("首页 /goal：目标写进新建会话自己的工作区（主进程不许按启动工作区找会话）", async () => {
    const { actions, agent } = harness(null);
    actions.sendWithGoal("/goal finish this task", []);
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledTimes(1));
    expect(agent.setGoal).toHaveBeenCalledWith({ sessionId: "created", workspace: "/workspace", objective: "finish this task" });
  });

  it("⌘↩ 打在 /goal 上：先占住队首再等 setGoal，旧轮收束也派不走老队首", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current");
    deps.runningSet.current.add(key);
    deps.sendQueue.current.set(key, [{ id: 1, text: "old queued", attachments: [] }]);
    let release: (value: { ok: boolean; error?: string }) => void = () => undefined;
    agent.setGoal.mockImplementationOnce(() => new Promise<{ ok: boolean; error?: string }>((resolve) => { release = resolve; }));

    const prepared = actions.sendWithGoal("/goal finish this task", [], true, true);
    expect(prepared, "准备 Promise 是调用方延后打断的唯一依据").toBeInstanceOf(Promise);
    // setGoal 未回：这条已占住队首（blocked），但还不能派。
    expect(deps.sendQueue.current.get(key)?.map((i) => [i.text, i.blocked === true])).toEqual([
      ["finish this task", true],
      ["old queued", false],
    ]);
    // 旧轮在此刻自然收束：收束链看到占位队首 ⇒ 停一拍，老消息不许先走。
    deps.runningSet.current.delete(key);
    actions.resumeQueue();
    await writesDone(deps);
    expect(agent.run).not.toHaveBeenCalled();

    release({ ok: true });
    await expect(prepared).resolves.toBe("started");
    // 起跑的是这条目标，老队首排在它后面（drain 照常续派，次序不许颠倒）。
    await vi.waitFor(() => expect(agent.run.mock.calls.map(([r]) => (r as { message: string }).message)).toEqual(["finish this task", "old queued"]));
    expect(deps.sendQueue.current.get(key)).toEqual([]);
  });

  it("⌘↩ 的 /goal 与旧轮并行：落定后仍在跑 ⇒ 返回 queued（调用方才打断），这条排在老队首前", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current");
    deps.runningSet.current.add(key);
    deps.sendQueue.current.set(key, [{ id: 1, text: "old queued", attachments: [] }]);
    let release: (value: { ok: boolean; error?: string }) => void = () => undefined;
    agent.setGoal.mockImplementationOnce(() => new Promise<{ ok: boolean; error?: string }>((resolve) => { release = resolve; }));

    const prepared = actions.sendWithGoal("/goal finish this task", [], true, true);
    release({ ok: true });
    await expect(prepared).resolves.toBe("queued");
    expect(agent.run).not.toHaveBeenCalled();
    expect(deps.sendQueue.current.get(key)?.map((i) => [i.text, i.blocked === true])).toEqual([
      ["finish this task", false],
      ["old queued", false],
    ]);
  });

  it("setGoal 等待期间已经有别的轮接上 ⇒ 返回 started，不打断那条新轮", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current");
    deps.runningSet.current.add(key);
    deps.runGen.current.set(key, 1);
    deps.sendQueue.current.set(key, [{ id: 1, text: "old queued", attachments: [] }]);
    let release: (value: { ok: boolean; error?: string }) => void = () => undefined;
    agent.setGoal.mockImplementationOnce(() => new Promise<{ ok: boolean; error?: string }>((resolve) => { release = resolve; }));

    const prepared = actions.sendWithGoal("/goal finish this task", [], true, true);
    // 用户手动「立即」发另一条（或收束链接上了这条）：新一轮开始，runGen 前进。
    deps.runGen.current.set(key, 2);
    release({ ok: true });
    // 不是 queued ⇒ 调用方不会对这条新轮发 cancel。
    await expect(prepared).resolves.toBe("started");
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("setGoal 失败：撤掉占位、把老队首续上，整条命令还回输入框", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current");
    deps.runningSet.current.add(key);
    deps.sendQueue.current.set(key, [{ id: 1, text: "old queued", attachments: [] }]);
    let release: (value: { ok: boolean; error?: string }) => void = () => undefined;
    agent.setGoal.mockImplementationOnce(() => new Promise<{ ok: boolean; error?: string }>((resolve) => { release = resolve; }));

    const prepared = actions.sendWithGoal("/goal finish this task", [], true, true);
    deps.runningSet.current.delete(key); // 旧轮在等待期间收束
    release({ ok: false, error: "目标写不进去" });
    await expect(prepared).resolves.toBe("failed");
    expect(deps.setDraftRestore).toHaveBeenCalledWith({ forSession: "current", forWorkspace: "/workspace", text: "/goal finish this task", attachments: [], seq: 1 });
    // 占位撤掉后不能把队列留在「队首被挡」的死角：老队首照常续派。
    await vi.waitFor(() => expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({ message: "old queued" })));
    expect(deps.sendQueue.current.get(key)).toEqual([]);
  });

  it("空闲的 /goal：返回 started（没有可打断的旧轮，调用方不该把这条自己刚起跑的 run 杀掉）", async () => {
    const { actions, agent } = harness();
    await expect(actions.sendWithGoal("/goal finish this task", [], true, true)).resolves.toBe("started");
    expect(agent.run).toHaveBeenCalledTimes(1);
  });

  it("setGoal 失败：整条 /goal 命令还回输入框，不把目标原文当普通消息跑掉", async () => {
    const { actions, agent, deps } = harness();
    agent.setGoal.mockResolvedValueOnce({ ok: false, error: "目标写不进去" });
    await expect(actions.sendWithGoal("/goal finish this task", [], true, true)).resolves.toBe("failed");
    expect(agent.run).not.toHaveBeenCalled();
    expect(deps.setLastError).toHaveBeenCalledWith(expect.stringContaining("目标写不进去"), "current", "/workspace");
    expect(deps.setDraftRestore).toHaveBeenCalledWith({ forSession: "current", forWorkspace: "/workspace", text: "/goal finish this task", attachments: [], seq: 1 });
  });

  it("空闲的 /goal 失败：没占位就不替用户点「继续发送」，既有队列原样", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current");
    deps.sendQueue.current.set(key, [{ id: 1, text: "old queued", attachments: [] }]);
    agent.setGoal.mockResolvedValueOnce({ ok: false, error: "目标写不进去" });
    await expect(actions.sendWithGoal("/goal finish this task", [], true, true)).resolves.toBe("failed");
    await writesDone(deps);
    expect(agent.run).not.toHaveBeenCalled();
    expect(deps.sendQueue.current.get(key)?.map((i) => i.text)).toEqual(["old queued"]);
  });

  it("首页 /goal：会话建好之后 setGoal 失败 ⇒ 整条命令还回草稿，不跑普通消息", async () => {
    const { agent, deps, render } = harness(null);
    deps.activeWorkspace = null;
    agent.setGoal.mockResolvedValueOnce({ ok: false, error: "目标写不进去" });
    const actions = render();
    // 首页分支没有会话可等待 ⇒ 与普通消息一样返回 undefined（调用方当场打断）。
    expect(actions.sendWithGoal("/goal finish this task", [])).toBeUndefined();
    await vi.waitFor(() => expect(agent.setGoal).toHaveBeenCalledTimes(1));
    expect(agent.run).not.toHaveBeenCalled();
    expect(deps.setDraftRestore).toHaveBeenCalledWith({ forSession: "created", forWorkspace: "/workspace", text: "/goal finish this task", attachments: [], seq: 1 });
  });

  it("creation failure restores the home draft and does not start a run", async () => {
    const { actions, agent, deps } = harness(null);
    agent.createSession.mockRejectedValueOnce(new Error("cannot create"));
    await actions.send("keep this draft");
    expect(agent.run).not.toHaveBeenCalled();
    expect(deps.setDraftRestore).toHaveBeenCalledWith({ forSession: null, forWorkspace: "/workspace", text: "keep this draft", attachments: [], seq: 1 });
    expect(deps.setPendingSend).toHaveBeenLastCalledWith(false);
  });

  it("restores the first draft when the host explicitly did not admit it (external attachment rejected)", async () => {
    const { actions, agent, deps } = harness();
    const attachments = [{ path: "/Users/ze/Desktop/report.pdf", kind: "file" as const, explicit: true }];
    const error = "项目外附件未通过外部引用审批（已拒绝）；本轮未开始";
    agent.run.mockResolvedValueOnce({ ok: false, accepted: false, error });
    await actions.send("read the attachment", attachments);
    expect(deps.setLastError).toHaveBeenCalledWith(error, "current", "/workspace");
    expect(deps.setDraftRestore).toHaveBeenCalledWith({
      forSession: "current",
      forWorkspace: "/workspace",
      text: "read the attachment",
      attachments,
      seq: 1,
    });
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
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("目标工作区不匹配", "same", "/other-ws"));
    expect(agent.runCancel).toHaveBeenCalledWith("same", "/other-ws");
    expect(agent.run).not.toHaveBeenCalled(); expect(agent.queueSet).not.toHaveBeenCalled();
    expect(deps.sendQueue.current.get(key)).toEqual(items);
  });
  // 第 1082 页：停止/取消的 IPC **拒绝**（通道异常/窗口销毁/main 抛错）也要说出来——
  // 952/1073/1080 同族。resolve-{ok:false} 已 surfaced（上一格），同文件 resumeQueueFor 的
  // reject 也接 setLastError；唯独 cancelRunHeal 的 .catch(() => undefined) 把拒绝吞了：
  // 用户点停止、run 照跑、界面毫无反应，正是业主实测过的「点了像没点」。
  it("a rejected cancel (IPC throw) surfaces a stop failure instead of silently doing nothing", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/other-ws", "same");
    const items = [{ id: 1, text: "keep this queued", attachments: [] }];
    deps.sendQueue.current.set(key, items); deps.runningSet.current.add(key);
    agent.runCancel.mockRejectedValueOnce(new Error("IPC channel closed"));
    actions.cancelRunHeal("same", "/other-ws");
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("停止失败：IPC channel closed", "same", "/other-ws"));
    expect(agent.runCancel).toHaveBeenCalledWith("same", "/other-ws");
    // 拒绝与 resolve-{ok:false} 同口径：不续队列、不派发、不丢队首。
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

describe("interrupt send goes to the head of the queue", () => {
  it("⌘↩（front）排在老消息前面，并把这个次序落盘", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current");
    const old = { id: 7, text: "更早排的那条", attachments: [] };
    deps.sendQueue.current.set(key, [old]);
    deps.runningSet.current.add(key);
    await actions.send("现在就要发", [], true, true);
    // 内存表：新消息在队首（收束链 takeQueuedHead 先派它）
    expect(deps.sendQueue.current.get(key)?.map((i) => i.text)).toEqual(["现在就要发", "更早排的那条"]);
    await writesDone(deps);
    // 落盘次序与内存一致（重启恢复后仍先发这一条）
    expect(agent.queueSet).toHaveBeenLastCalledWith("current", [
      { text: "现在就要发", attachments: [] },
      { text: "更早排的那条", attachments: [] },
    ], "/workspace");
    expect(agent.run).not.toHaveBeenCalled(); // 运行中只入队，不在这一刻起跑
  });

  it("配对：普通「加入队列」仍排队尾（front 不是默认行为）", async () => {
    const { actions, deps } = harness();
    const key = runKey("/workspace", "current");
    deps.sendQueue.current.set(key, [{ id: 7, text: "更早排的那条", attachments: [] }]);
    deps.runningSet.current.add(key);
    await actions.send("按顺序排", [], true);
    expect(deps.sendQueue.current.get(key)?.map((i) => i.text)).toEqual(["更早排的那条", "按顺序排"]);
  });
});

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
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("target occupied", "current", "/workspace")); await writesDone(deps);
    expect(deps.sendQueue.current.get(key)).toEqual([head]);
    expect(agent.queueSet).toHaveBeenLastCalledWith("current", [{ text: head.text, attachments: [] }], "/workspace");
  });

  it("does not requeue an accepted message when execution fails", async () => {
    const { actions, agent, deps } = harness();
    const key = runKey("/workspace", "current"), tail = queued(2); deps.sendQueue.current.set(key, [queued(1), tail]);
    agent.run.mockResolvedValueOnce({ ok: false, accepted: true, error: "tool failed" });
    actions.resumeQueue();
    await vi.waitFor(() => expect(deps.setLastError).toHaveBeenCalledWith("tool failed", "current", "/workspace")); await writesDone(deps);
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
