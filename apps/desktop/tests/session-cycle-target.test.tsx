import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useSessionOps } from "../src/renderer/state/sessions";

function harness(workspace: string | null = "/b") {
  const noop = vi.fn();
  const openSession = vi.fn();
  const deps: Parameters<typeof useSessionOps>[0] = {
    activeId: "same", activeIdRef: { current: "same" }, activeWorkspaceRef: { current: workspace },
    sessions: [{ id: "same", workspace: "/a", lines: 1, mtimeMs: 3 }, { id: "same", workspace: "/b", lines: 1, mtimeMs: 2 }, { id: "third", workspace: "/c", lines: 1, mtimeMs: 1 }],
    refreshSessions: async () => undefined, activate: noop, openSession, setLastError: noop, setLastNotice: noop,
    setDraftRemap: noop, draftRemapSeq: { current: 0 }, setEvents: noop, setQueueLoading: noop, openSeq: { current: 0 },
    touchWorkspace: noop, runningSet: { current: new Set() }, setArchiveConfirm: noop, setDeleteConfirm: noop,
  };
  let ops: ReturnType<typeof useSessionOps>;
  function Probe() { ops = useSessionOps(deps); return null; }
  renderToStaticMarkup(createElement(Probe));
  return { ops: ops!, openSession };
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
