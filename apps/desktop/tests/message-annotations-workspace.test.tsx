import "./helpers/dom-host-install";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ElementNode } from "./helpers/dom-host";
import type { AgentApi } from "../../../src/main/ipc-protocol";
import { useMessageAnnotations } from "../src/renderer/useMessageAnnotations";

type Pins = Awaited<ReturnType<AgentApi["listMessagePins"]>>;
type Resolver = (pins: Pins) => void;

function Probe(props: {
  sessionId: string | null;
  workspace: string | null;
  onError: (message: string, sessionId?: string) => void;
}): React.JSX.Element {
  const marks = useMessageAnnotations(props.sessionId, props.workspace, props.onError);
  return (
    <div>
      <span data-pins>{JSON.stringify([...marks.pinnedEventIds])}</span>
      <span data-busy>{String(marks.pinBusy({ eventId: 1 }))}</span>
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

describe("useMessageAnnotations workspace identity", () => {
  it("同 id 切工作区时旧根的置顶立刻不可见，加载也只认新根", async () => {
    const pending = new Map<string, Resolver>();
    (globalThis.window as unknown as { agent: unknown }).agent = {
      listFeedback: async () => [],
      listMessagePins: (_sessionId: string, workspace?: string) => new Promise<Pins>((resolve) => {
        if (workspace === undefined) throw new Error("测试要求显式 workspace");
        pending.set(workspace, resolve);
      }),
    } satisfies Partial<AgentApi>;

    const host = globalThis.document.createElement("div") as unknown as ElementNode;
    (globalThis.document.body as unknown as ElementNode).appendChild(host);
    let root: Root = null as unknown as Root;
    const onError = (): void => undefined;
    await act(async () => {
      root = createRoot(host as unknown as HTMLElement);
      root.render(<Probe sessionId="same" workspace="/a" onError={onError} />);
    });
    try {
      const node = (attr: string): ElementNode => {
        const found = nodes(host).find((n) => n.getAttribute(attr) !== null);
        if (found === undefined) throw new Error("missing " + attr);
        return found;
      };
      await act(async () => { pending.get("/a")?.([{ eventId: 1 }]); });
      expect(node("data-pins").textContent ?? "").toBe('["#1"]');
      expect(node("data-busy").textContent ?? "").toBe("false");

      await act(async () => {
        root.render(<Probe sessionId="same" workspace="/b" onError={onError} />);
      });
      // /b 的快照还没回：不能继续展示 /a 的置顶，也不能允许对旧值直接提交。
      expect(node("data-pins").textContent ?? "").toBe("[]");
      expect(node("data-busy").textContent ?? "").toBe("true");

      await act(async () => { pending.get("/b")?.([{ eventId: 2 }]); });
      expect(node("data-pins").textContent ?? "").toBe('["#2"]');
      expect(node("data-busy").textContent ?? "").toBe("false");
    } finally {
      act(() => { root.unmount(); });
      host.parentNode?.removeChild(host);
    }
  });
});
