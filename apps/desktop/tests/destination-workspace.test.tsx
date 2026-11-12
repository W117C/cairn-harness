import "./helpers/dom-host-install";
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ElementNode } from "./helpers/dom-host";
import type { AppDestination } from "../src/renderer/app-controls";
import { DestinationWorkspace } from "../src/renderer/panes/DestinationWorkspace";

describe("DestinationWorkspace", () => {
  it("keeps the chat tree mounted but inert while a durable page is visible", () => {
    const html = renderToStaticMarkup(
      <DestinationWorkspace
        destination="plugins"
        renderPage={(destination) => <div>{destination}-page</div>}
      >
        <div>chat-state</div>
      </DestinationWorkspace>,
    );

    expect(html).toContain("chat-state");
    expect(html).toContain('class="chat-workspace"');
    expect(html).toContain('data-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-label="插件"');
    expect(html).toContain('data-destination-page="plugins"');
    expect(html).toContain("plugins-page");
  });

  it("leaves chat active and visible on its default destination", () => {
    const html = renderToStaticMarkup(
      <DestinationWorkspace destination="chat" renderPage={() => null}>
        <div>chat-state</div>
      </DestinationWorkspace>,
    );

    expect(html).toContain('data-hidden="false"');
    expect(html).not.toContain("inert");
    expect(html).not.toContain("destination-page");
  });
});

// 真挂载那一面（第 1058 页）：上面两条走 SSR，只盖到「聊天树隐藏」这一支；
// 已访问过的 durable 页被切走后**仍挂着**（keep-alive），那一支的 inert 此前无人判。
// 而 inert 是布尔 attribute：本仓装的是 React 18.3.1，传 `true` 会被整个丢掉（只留一条 warning），
// 传空串才真落到 DOM ⇒ 必须按「属性在不在」判，不能按源码里写没写 inert 判。
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

async function mountWorkspace(initial: AppDestination) {
  const host = globalThis.document.createElement("div") as unknown as ElementNode;
  (globalThis.document.body as unknown as ElementNode).appendChild(host);
  let root: Root = null as unknown as Root;
  const page = (destination: AppDestination) => (
    <DestinationWorkspace
      destination={destination}
      renderPage={(d) => <div>{d}-page</div>}
    >
      <div>chat-state</div>
    </DestinationWorkspace>
  );
  await act(async () => { root = createRoot(host as unknown as HTMLElement); root.render(page(initial)); });
  return {
    host,
    async go(destination: AppDestination): Promise<void> {
      await act(async () => { root.render(page(destination)); });
    },
    find(selector: (node: ElementNode) => boolean): ElementNode {
      const hit = elementNodes(host).find(selector);
      if (hit === undefined) throw new Error("目标节点不在挂载树里");
      return hit;
    },
    unmount(): void {
      act(() => { root.unmount(); });
      host.parentNode?.removeChild(host);
    },
  };
}

const pageNode = (destination: string) => (node: ElementNode): boolean =>
  node.getAttribute("data-destination-page") === destination;
const chatNode = (node: ElementNode): boolean => node.className === "chat-workspace";

describe("DestinationWorkspace · 隐藏面 inert（真挂载）", () => {
  it("切走后仍挂着的 durable 页带 inert，当前页不带", async () => {
    const w = await mountWorkspace("plugins");
    try {
      await w.go("memory");
      const parked = w.find(pageNode("plugins"));
      const current = w.find(pageNode("memory"));
      expect(parked.getAttribute("data-hidden")).toBe("true");
      expect(parked.hasAttribute("inert")).toBe(true);
      expect(current.getAttribute("data-hidden")).toBe("false");
      expect(current.hasAttribute("inert")).toBe(false);
      // keep-alive：切走不等于卸载，页内状态还在。
      expect(parked.textContent).toContain("plugins-page");
      expect(w.find(chatNode).hasAttribute("inert")).toBe(true);
    } finally {
      w.unmount();
    }
  });

  it("回到对话时聊天树解除 inert，两个 durable 页都带上", async () => {
    const w = await mountWorkspace("plugins");
    try {
      await w.go("memory");
      await w.go("chat");
      const chat = w.find(chatNode);
      expect(chat.getAttribute("data-hidden")).toBe("false");
      expect(chat.hasAttribute("inert")).toBe(false);
      expect(chat.textContent).toContain("chat-state");
      for (const destination of ["plugins", "memory"]) {
        const parked = w.find(pageNode(destination));
        expect(parked.getAttribute("data-hidden")).toBe("true");
        expect(parked.hasAttribute("inert")).toBe(true);
      }
    } finally {
      w.unmount();
    }
  });
});
