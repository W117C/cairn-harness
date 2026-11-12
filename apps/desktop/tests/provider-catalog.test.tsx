// Provider 目录 hook（第 1096 页从 workbench.ts 拆出）的行为判卷：
// 成功时 providerInfo / providerKeys / configuredProviders 同步落地；
// 失败时 providerInfo 落 null 并出声、providerKeys 落 null（未知，不是空），不把失败折成默认值。
import "./helpers/dom-host-install";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ElementNode } from "./helpers/dom-host";
import { fire } from "./helpers/dom-host";
import { useProviderCatalog } from "../src/renderer/state/use-provider-catalog";

const noop = (): void => {};

function elementNodes(root: ElementNode): ElementNode[] {
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

function Probe(props: { onNotice: (message: string) => void }): React.JSX.Element {
  const { providerInfo, providerKeys, refreshProviderInfo, refreshProviderKeys, configuredProviders } = useProviderCatalog(props.onNotice);
  return (
    <div>
      <span data-info>{providerInfo?.kind ?? "null"}</span>
      <span data-keys>{providerKeys === null ? "null" : [...providerKeys.stored, ...providerKeys.envProviders].join(",")}</span>
      <span data-configured>{configuredProviders === undefined ? "unknown" : [...configuredProviders].join(",")}</span>
      <button onClick={() => { void refreshProviderInfo(); void refreshProviderKeys(); }}>refresh</button>
    </div>
  );
}

async function mountProbe(onNotice: (message: string) => void): Promise<{ host: ElementNode; unmount: () => void }> {
  const host = globalThis.document.createElement("div") as unknown as ElementNode;
  (globalThis.document.body as unknown as ElementNode).appendChild(host);
  let root: Root = null as unknown as Root;
  await act(async () => {
    root = createRoot(host as unknown as HTMLElement);
    root.render(<Probe onNotice={onNotice} />);
  });
  return {
    host,
    unmount(): void {
      act(() => { root.unmount(); });
      host.parentNode?.removeChild(host);
    },
  };
}

afterEach(() => {
  (globalThis.window as unknown as { agent?: unknown }).agent = undefined;
});

describe("useProviderCatalog（第 1096 页）", () => {
  it("刷新成功：目录、key 状态与 configuredProviders 一起落地", async () => {
    (globalThis.window as unknown as { agent: Record<string, unknown> }).agent = {
      getProviderInfo: async () => ({
        kind: "demo",
        providers: [],
        provider: "demo",
        model: "demo",
        modelId: null,
        models: [],
        keyConfigured: true,
      }),
      providerKeyStatus: async () => ({ available: true, stored: ["glm"], envActive: true, envProviders: ["openai"] }),
    };
    const w = await mountProbe(noop);
    try {
      const button = elementNodes(w.host).find((node) => node.tagName === "BUTTON");
      expect(button).toBeDefined();
      await act(async () => {
        fire(button as ElementNode, "onClick");
        await Promise.resolve();
        await Promise.resolve();
      });
      const byAttr = (attr: string): string | undefined => elementNodes(w.host).find((node) => node.getAttribute(attr) !== null)?.textContent;
      expect(byAttr("data-info")).toBe("demo");
      expect(byAttr("data-keys")).toBe("glm,openai");
      expect(byAttr("data-configured")).toBe("glm,openai");
    } finally {
      w.unmount();
    }
  });

  it("刷新失败：目录 null + 可见通知，key 状态 null（未知不是空）", async () => {
    const notices: string[] = [];
    (globalThis.window as unknown as { agent: Record<string, unknown> }).agent = {
      getProviderInfo: async () => { throw new Error("目录坏了"); },
      providerKeyStatus: async () => { throw new Error("key 坏了"); },
    };
    const w = await mountProbe((message) => notices.push(message));
    try {
      const button = elementNodes(w.host).find((node) => node.tagName === "BUTTON");
      expect(button).toBeDefined();
      await act(async () => {
        fire(button as ElementNode, "onClick");
        await Promise.resolve();
        await Promise.resolve();
      });
      const byAttr = (attr: string): string | undefined => elementNodes(w.host).find((node) => node.getAttribute(attr) !== null)?.textContent;
      expect(byAttr("data-info")).toBe("null");
      expect(byAttr("data-keys")).toBe("null");
      expect(byAttr("data-configured")).toBe("unknown");
      expect(notices).toEqual(["主会话模型目录不可用：目录坏了"]);
    } finally {
      w.unmount();
    }
  });
});
