// 第 1111 页：会话键控错误/提示条从 workbench 拆出后的行为判卷——按 activeIdRef 的当前 key 读/清，
// 切会话不清别人的条；错误与提示互不串。
import "./helpers/dom-host-install";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ElementNode } from "./helpers/dom-host";
import { fire } from "./helpers/dom-host";
import { useSessionNotices } from "../src/renderer/state/session-notices";

function Probe(props: { idRef: { current: string | null } }): React.JSX.Element {
  const { sessionErrors, setLastError, clearLastError, sessionNotices, setLastNotice, clearLastNotice } = useSessionNotices(props.idRef);
  return (
    <div>
      <span data-errors>{JSON.stringify([...sessionErrors.entries()])}</span>
      <span data-notices>{JSON.stringify([...sessionNotices.entries()])}</span>
      <button data-set-error onClick={() => setLastError("err")}>set err</button>
      <button data-clear-error onClick={clearLastError}>clear err</button>
      <button data-set-notice onClick={() => setLastNotice("notice")}>set notice</button>
      <button data-clear-notice onClick={clearLastNotice}>clear notice</button>
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

describe("useSessionNotices", () => {
  it("按 activeIdRef 当前 key 写入/清除；切会话不清别人的条", async () => {
    const idRef = { current: "s1" } as { current: string | null };
    const host = globalThis.document.createElement("div") as unknown as ElementNode;
    (globalThis.document.body as unknown as ElementNode).appendChild(host);
    let root: Root = null as unknown as Root;
    await act(async () => {
      root = createRoot(host as unknown as HTMLElement);
      root.render(<Probe idRef={idRef} />);
    });
    try {
      const button = (attr: string): ElementNode => {
        const found = nodes(host).find((n) => n.getAttribute(attr) !== null);
        if (found === undefined) throw new Error("missing " + attr);
        return found;
      };
      await act(async () => { fire(button("data-set-error"), "onClick"); });
      expect(button("data-errors").textContent ?? "").toBe('[["s1","err"]]');
      await act(async () => { fire(button("data-set-notice"), "onClick"); });
      expect(button("data-notices").textContent ?? "").toBe('[["s1","notice"]]');
      idRef.current = "s2";
      await act(async () => { fire(button("data-clear-error"), "onClick"); });
      expect(button("data-errors").textContent ?? "").toBe('[["s1","err"]]');
      await act(async () => { fire(button("data-set-error"), "onClick"); });
      expect(button("data-errors").textContent ?? "").toBe('[["s1","err"],["s2","err"]]');
      await act(async () => { fire(button("data-clear-notice"), "onClick"); });
      expect(button("data-notices").textContent ?? "").toBe('[["s1","notice"]]');
    } finally {
      act(() => { root.unmount(); });
      host.parentNode?.removeChild(host);
    }
  });
});
