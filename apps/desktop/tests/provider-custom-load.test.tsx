// 自定义供应商配置读取失败（第 1086 页）：
// 旧实现只在 providerCustomList 成功时 setCustomEntries；失败/拒绝时 customEntries 恒 []，
// 编辑分支的 editingEntry 恒 null ⇒ 右详情永远停在「正在读取配置…」，用户以为一直在加载，
// 实际是 IPC 已经失败。这里用最小 DOM 宿主真挂载：点自定义行 → 让 IPC 拒绝 → 断言错误条出现。
import "./helpers/dom-host-install";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppSettings } from "../../../src/main/ipc-protocol";
import type { ElementNode } from "./helpers/dom-host";
import { fire } from "./helpers/dom-host";
import { ProviderSection } from "../src/renderer/components/settings/ProviderSection";
import { STR } from "../src/renderer/strings";

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

async function mountProvider(): Promise<{ host: ElementNode; unmount: () => void }> {
  const host = globalThis.document.createElement("div") as unknown as ElementNode;
  (globalThis.document.body as unknown as ElementNode).appendChild(host);
  let root: Root = null as unknown as Root;
  await act(async () => {
    root = createRoot(host as unknown as HTMLElement);
    root.render(
      <ProviderSection
        settings={{ provider: "glm" } as unknown as AppSettings}
        status={{ available: true, stored: [], envActive: false }}
        providers={[
          { id: "glm", label: "glm", custom: false },
          { id: "agnes", label: "agnes", custom: true },
        ]}
        models={[]}
        cap={null}
        keyProvider="glm"
        onKeyProviderChange={noop}
        keyInputRef={{ current: null }}
        busy={false}
        onSaveKey={noop}
        onDeleteKey={noop}
        checkMsg={null}
        onCheck={noop}
        onCustomSaved={noop}
        onOpenSearch={noop}
      />,
    );
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

describe("ProviderSection · 自定义配置读取失败（第 1086 页）", () => {
  it("providerCustomList 拒绝 ⇒ 显示错误条，不永远停在「正在读取配置…」", async () => {
    (globalThis.window as unknown as { agent: { providerCustomList: () => Promise<never> } }).agent = {
      providerCustomList: async () => { throw new Error("IPC down"); },
    };
    const w = await mountProvider();
    try {
      const customRow = elementNodes(w.host).find(
        (node) => node.className === "pv-item" && node.textContent.includes("agnes"),
      );
      expect(customRow).toBeDefined();
      await act(async () => {
        fire(customRow as ElementNode, "onClick");
        await Promise.resolve();
        await Promise.resolve();
      });
      const detail = elementNodes(w.host).find((node) => node.className === "pv-detail");
      expect(detail?.textContent).toContain(STR.provider.loadConfigFailedPrefix + "IPC down");
      expect(detail?.textContent).not.toContain(STR.provider.loadingConfig);
    } finally {
      w.unmount();
    }
  });

  it("providerCustomList 回 ok:false ⇒ 也显示错误条（不是静默空态）", async () => {
    (globalThis.window as unknown as { agent: { providerCustomList: () => Promise<unknown> } }).agent = {
      providerCustomList: async () => ({ ok: false, error: "manifest 坏了", entries: [] }),
    };
    const w = await mountProvider();
    try {
      const customRow = elementNodes(w.host).find(
        (node) => node.className === "pv-item" && node.textContent.includes("agnes"),
      );
      expect(customRow).toBeDefined();
      await act(async () => {
        fire(customRow as ElementNode, "onClick");
        await Promise.resolve();
        await Promise.resolve();
      });
      const detail = elementNodes(w.host).find((node) => node.className === "pv-detail");
      expect(detail?.textContent).toContain("manifest 坏了");
      expect(detail?.textContent).not.toContain(STR.provider.loadingConfig);
    } finally {
      w.unmount();
    }
  });

  it("cap 为 null 且 capError 非空 ⇒ 搜索/识图显示读取失败，不显示加载中（第 1090 页）", () => {
    const html = renderToStaticMarkup(
      <ProviderSection
        settings={{ provider: "glm" } as unknown as AppSettings}
        status={{ available: true, stored: [], envActive: false }}
        providers={[{ id: "glm", label: "glm", custom: false }]}
        models={[]}
        cap={null}
        capError="boom"
        keyProvider="glm"
        onKeyProviderChange={noop}
        keyInputRef={{ current: null }}
        busy={false}
        onSaveKey={noop}
        onDeleteKey={noop}
        checkMsg={null}
        onCheck={noop}
        onCustomSaved={noop}
        onOpenSearch={noop}
      />,
    );
    expect(html).toContain(STR.provider.capReadFailedPrefix + "boom");
    expect(html).not.toContain(STR.provider.loadingConfig);
    expect(html).not.toContain(STR.provider.visionLoading);
  });
});

