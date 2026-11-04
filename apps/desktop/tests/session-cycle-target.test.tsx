import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionOps } from "../src/renderer/state/sessions";
import { runKey } from "../src/renderer/state/session-identity";

function harness(workspace: string | null = "/b") {
  const noop = vi.fn();
  const openSession = vi.fn();
  const deps: Parameters<typeof useSessionOps>[0] = {
    activeId: "same", activeIdRef: { current: "same" }, activeWorkspaceRef: { current: workspace },
    sessions: [{ id: "same", workspace: "/a", lines: 1, mtimeMs: 3 }, { id: "same", workspace: "/b", lines: 1, mtimeMs: 2 }, { id: "third", workspace: "/c", lines: 1, mtimeMs: 1 }],
    refreshSessions: async () => undefined, activate: noop, openSession, setLastError: noop, setLastNotice: noop,
    setDraftRemap: noop, draftRemapSeq: { current: 0 }, setEvents: noop, setSessionView: noop, setQueueLoading: noop, openSeq: { current: 0 },
    touchWorkspace: noop, runningSet: { current: new Set() }, setArchiveConfirm: noop, setDeleteConfirm: noop,
  };
  let ops: ReturnType<typeof useSessionOps>;
  function Probe() { ops = useSessionOps(deps); return null; }
  renderToStaticMarkup(createElement(Probe));
  return { ops: ops!, openSession, deps };
}

describe("同名会话的循环切换", () => {
  it("下一项从活动工作区那一条算起", () => {
    const { ops, openSession } = harness();
    expect(ops.cycleSession(1)).toBe(true);
    expect(openSession).toHaveBeenCalledWith("third", "/c");
  });
  it("上一项携带明确工作区，不能按同名 id 找第一个", () => {
    const { ops, openSession } = harness();
    expect(ops.cycleSession(-1)).toBe(true);
    expect(openSession).toHaveBeenCalledWith("same", "/a");
  });
});

describe("同名会话的删除目标", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("停止和重试都使用确认的工作区，保留窗口里另一个同名会话", async () => {
    const { ops, openSession, deps } = harness();
    const target = deps.sessions[0]!;
    deps.runningSet.current.add(runKey(target.workspace, target.id));
    const runCancel = vi.fn(async () => ({ ok: true }));
    const deleteSession = vi.fn(async () => ({ currentSession: null }))
      .mockRejectedValueOnce(new Error("会话正在运行，先停止再删除"));
    vi.stubGlobal("window", { agent: { runCancel, deleteSession } });

    await ops.doDeleteSession(target.id, target);

    expect(runCancel).toHaveBeenCalledExactlyOnceWith("same", "/a");
    expect(deleteSession.mock.calls).toEqual([["same", "/a"], ["same", "/a"]]);
    expect(deps.runningSet.current.has(runKey("/a", "same"))).toBe(false);
    expect(deps.activate).not.toHaveBeenCalled();
    expect(openSession).not.toHaveBeenCalled();
  });

  it("删除当前会话时按同一工作区打开返回的后继会话", async () => {
    const { ops, openSession, deps } = harness();
    deps.sessions.push({ id: "next", workspace: "/b", lines: 1, mtimeMs: 4 });
    const deleteSession = vi.fn(async () => ({ currentSession: "next" }));
    vi.stubGlobal("window", { agent: { deleteSession } });

    await ops.doDeleteSession("same", deps.sessions[1]);

    expect(deleteSession).toHaveBeenCalledExactlyOnceWith("same", "/b");
    expect(openSession).toHaveBeenCalledExactlyOnceWith("next", "/b");
  });
});
