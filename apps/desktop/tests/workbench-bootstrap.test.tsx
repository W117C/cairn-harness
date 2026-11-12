// 第 1112 页：workbench 启动面 hook 的行为判卷——设置首读落到四个 sink，模板目录落地。
import "./helpers/dom-host-install";
import { afterEach, describe, expect, it } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ElementNode } from "./helpers/dom-host";
import { useWorkbenchBootstrap } from "../src/renderer/state/use-workbench-bootstrap";

function Probe(): React.JSX.Element {
  const [mode, setMode] = useState("default");
  const [theme, setTheme] = useState("system");
  const [ctrl, setCtrl] = useState(false);
  const [text, setText] = useState("md");
  const [ui, setUi] = useState("2");
  const [error, setError] = useState("");
  const { templates } = useWorkbenchBootstrap({
    setMode,
    setThemePref: setTheme,
    setCtrlTabCycle: setCtrl,
    setTextSize: setText,
    setUiSize: setUi,
    setLastError: setError,
  });
  return (
    <div>
      <span data-mode>{mode}</span><span data-theme>{theme}</span><span data-ctrl>{String(ctrl)}</span>
      <span data-text>{text}</span><span data-ui>{ui}</span><span data-templates>{templates.map((t) => t.name).join(",")}</span>
      <span data-error>{error}</span>
    </div>
  );
}

function find(host: ElementNode, attr: string): ElementNode {
  const walk = (node: ElementNode): ElementNode | null => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.getAttribute(attr) !== null) return child;
      const hit = walk(child);
      if (hit !== null) return hit;
    }
    return null;
  };
  const hit = walk(host);
  if (hit === null) throw new Error("missing " + attr);
  return hit;
}

afterEach(() => {
  (globalThis.window as unknown as { agent?: unknown }).agent = undefined;
});

describe("useWorkbenchBootstrap", () => {
  it("首读设置与模板目录落地", async () => {
    (globalThis.window as unknown as { agent: Record<string, unknown> }).agent = {
      getSettings: async () => ({ mode: "acceptEdits", theme: "dark", ctrlTabCycle: true, textSize: "lg", uiSize: "3" }),
      projectTemplates: async () => [{ id: "t1", name: "静态页", description: "d", runKind: "static" }],
    };
    const host = globalThis.document.createElement("div") as unknown as ElementNode;
    (globalThis.document.body as unknown as ElementNode).appendChild(host);
    let root: Root = null as unknown as Root;
    await act(async () => {
      root = createRoot(host as unknown as HTMLElement);
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    try {
      expect(find(host, "data-mode").textContent).toBe("acceptEdits");
      expect(find(host, "data-theme").textContent).toBe("dark");
      expect(find(host, "data-ctrl").textContent).toBe("true");
      expect(find(host, "data-text").textContent).toBe("lg");
      expect(find(host, "data-ui").textContent).toBe("3");
      expect(find(host, "data-templates").textContent).toBe("静态页");
      expect(find(host, "data-error").textContent).toBe("");
    } finally {
      act(() => { root.unmount(); });
      host.parentNode?.removeChild(host);
    }
  });
});
