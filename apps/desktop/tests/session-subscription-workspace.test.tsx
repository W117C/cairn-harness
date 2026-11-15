import "./helpers/dom-host-install";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentApi, AgentEvent, AskPayload, ProjectRecord } from "../../../src/main/ipc-protocol";
import type { ElementNode } from "./helpers/dom-host";
import { shouldBufferOpenEvent, useSessionSubscription } from "../src/renderer/state/session-subscription";
import { runKey } from "../src/renderer/state/session-identity";
import type { QueuedSend } from "../src/renderer/send-queue";

const refreshSessions = async (): Promise<void> => undefined;
const refreshProviderInfo = async (): Promise<void> => undefined;
const refreshProviderKeys = async (): Promise<void> => undefined;
type NoticeFn = (message: string, sessionId?: string, workspace?: string | null) => void;

type Runtime = {
  onAsk?: (p: AskPayload) => void;
  onAskDone?: (p: { askId: string; outcome: "approved" | "rejected"; reason: string }) => void;
  askById: { current: Map<string, AskPayload> };
  waitingByAsk: { current: Map<string, string> };
  waitingCounts: { current: Map<string, number> };
  sendQueue: { current: Map<string, QueuedSend[]> };
  setLastNotice: NoticeFn;
};

function Harness(props: { runtime: Runtime }): React.JSX.Element {
  const [asks, setAsks] = useState<ReadonlyMap<string, AskPayload>>(new Map());
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [notice, setRegistryNotice] = useState<string | null>(null);
  const [, force] = useState(0);
  useSessionSubscription({
    refreshSessions,
    refreshProviderInfo,
    refreshProviderKeys,
    setProjects,
    setRegistryNotice,
    knownSessionIds: { current: new Set() },
    refetching: { current: false },
    openPending: { current: null },
    activeIdRef: { current: "same" },
    activeWorkspaceRef: { current: "/active" },
    lastDeltaAt: { current: new Map() },
    runningSet: { current: new Set() },
    outcomes: { current: new Map() },
    force,
    setEvents: () => undefined,
    sendQueue: props.runtime.sendQueue,
    setLastNotice: props.runtime.setLastNotice,
    askById: props.runtime.askById,
    setAskBySid: setAsks,
    waitingByAsk: props.runtime.waitingByAsk,
    waitingCounts: props.runtime.waitingCounts,
  });
  return (
    <div>
      <span data-asks>{JSON.stringify([...asks.keys()])}</span>
      <span data-projects>{String(projects.length)}</span>
      <span data-notice>{notice ?? ""}</span>
      <button data-force onClick={() => force((n) => n + 1)}>force</button>
    </div>
  );
}

function nodes(root: ElementNode): ElementNode[] {
  const out: ElementNode[] = [];
  const walk = (node: ElementNode): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

afterEach(() => {
  (globalThis.window as unknown as { agent?: unknown }).agent = undefined;
});

describe("useSessionSubscription workspace keys", () => {
  it("读盘缓冲只收同一工作区的同名会话事件", () => {
    const open = { id: "same", workspace: "/a" };
    expect(shouldBufferOpenEvent({ sessionId: "same", eventWorkspace: "/a", open })).toBe(true);
    expect(shouldBufferOpenEvent({ sessionId: "same", eventWorkspace: "/b", open })).toBe(false);
    expect(shouldBufferOpenEvent({ sessionId: "other", eventWorkspace: "/a", open })).toBe(false);
    expect(shouldBufferOpenEvent({ sessionId: "same", eventWorkspace: undefined, open })).toBe(true);
    expect(shouldBufferOpenEvent({ sessionId: "same", eventWorkspace: "", open })).toBe(true);
    expect(shouldBufferOpenEvent({ sessionId: "same", eventWorkspace: "/b", open: { id: "same", workspace: null } })).toBe(true);
  });

  it("同 id 的审批卡、等门计数与沉淀守卫都按 workspace + session 分开", async () => {
    const notice = vi.fn();
    const runtime: Runtime = {
      askById: { current: new Map() },
      waitingByAsk: { current: new Map() },
      waitingCounts: { current: new Map() },
      sendQueue: { current: new Map() },
      setLastNotice: notice as unknown as NoticeFn,
    };
    const decide = vi.fn(async () => true);
    (globalThis.window as unknown as { agent: unknown }).agent = {
      listProjects: async () => [],
      onEvent: (_cb: (e: AgentEvent) => void) => () => undefined,
      onAsk: (cb: (p: AskPayload) => void) => { runtime.onAsk = cb; return () => undefined; },
      onAskDone: (cb: (p: { askId: string; outcome: "approved" | "rejected"; reason: string }) => void) => {
        runtime.onAskDone = cb;
        return () => undefined;
      },
      decide,
    } as unknown as AgentApi;

    const host = globalThis.document.createElement("div") as unknown as ElementNode;
    (globalThis.document.body as unknown as ElementNode).appendChild(host);
    let root: Root = null as unknown as Root;
    await act(async () => {
      root = createRoot(host as unknown as HTMLElement);
      root.render(<Harness runtime={runtime} />);
    });
    try {
      const node = (attr: string): ElementNode => {
        const found = nodes(host).find((n) => n.getAttribute(attr) !== null);
        if (found === undefined) throw new Error("missing " + attr);
        return found;
      };
      const keyA = runKey("/a", "same");
      runtime.sendQueue.current.set(keyA, [{ id: 1, text: "waiting", attachments: [] }]);
      await act(async () => {
        runtime.onAsk?.({
          askId: "distill-a",
          tool: "remember",
          args: { trigger: "session_end_distill" },
          sessionId: "same",
          workspace: "/a",
        });
      });
      expect(decide).toHaveBeenCalledWith("distill-a", false);
      expect(notice).toHaveBeenCalledWith(expect.any(String), "same", "/a");
      expect(runtime.askById.current.has(keyA)).toBe(false);

      await act(async () => {
        runtime.onAsk?.({ askId: "ask-a", tool: "run_shell", args: {}, sessionId: "same", workspace: "/a" });
        runtime.onAsk?.({ askId: "ask-b", tool: "run_shell", args: {}, sessionId: "same", workspace: "/b" });
      });
      expect([...runtime.askById.current.keys()].sort()).toEqual([runKey("/a", "same"), runKey("/b", "same")].sort());
      expect(JSON.parse(node("data-asks").textContent ?? "[]").sort()).toEqual([
        runKey("/a", "same"),
        runKey("/b", "same"),
      ].sort());
      expect(runtime.waitingCounts.current.get(keyA)).toBe(1);
      expect(runtime.waitingCounts.current.get(runKey("/b", "same"))).toBe(1);

      await act(async () => {
        runtime.onAskDone?.({ askId: "ask-a", outcome: "approved", reason: "user" });
      });
      expect(runtime.waitingCounts.current.has(keyA)).toBe(false);
      expect(runtime.askById.current.has(runKey("/b", "same"))).toBe(true);
    } finally {
      act(() => { root.unmount(); });
      host.parentNode?.removeChild(host);
    }
  });
});
