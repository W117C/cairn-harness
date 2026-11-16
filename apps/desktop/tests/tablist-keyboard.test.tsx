// 水平 / 垂直 tablist 的键盘契约（2026-11-16 · 第 1258 页之后）：检查器早就有 roving tabindex +
// 方向键换页，浏览器标签条与供应商列表却只有 role="tab" 的外观——每颗都在 Tab 序里，
// 方向键无反应。这里钉三件事：
//   ① 浏览器标签条（水平）：选中项独享 Tab 停点，←/→ 换页并搬焦点；
//   ② 供应商列表（垂直）：tablist 里只有 tab（分组标签与「添加」按钮留在外面），
//      roving 停点只有一个，↑/↓ 换页；
//   ③ 全应用不再有平行的「组内下标」实现（检查器/窗格标签已并到 radio-nav.ts）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderSection } from "../src/renderer/components/settings/ProviderSection";
import { readAppSurface, readRendererFile } from "./helpers/app-surface";
import { STR } from "../src/renderer/strings";

const providers = [
  { id: "openai", label: "OpenAI", custom: false },
  { id: "deepseek", label: "DeepSeek", custom: false },
] as const;

function renderProvider(keyProvider: string): string {
  return renderToStaticMarkup(
    <ProviderSection
      settings={null}
      status={{ available: true, stored: [], envActive: false }}
      providers={providers}
      models={[]}
      cap={null}
      keyProvider={keyProvider}
      onKeyProviderChange={() => undefined}
      keyInputRef={{ current: null }}
      busy={false}
      onSaveKey={() => undefined}
      onDeleteKey={() => undefined}
      checkMsg={null}
      onCheck={() => undefined}
      onCustomSaved={() => undefined}
      onOpenSearch={() => undefined}
    />,
  );
}

describe("供应商列表 = tablist", () => {
  it("roving tabindex：只有一个 0（选中项），其余 tab 退出 Tab 序", () => {
    const html = renderProvider("openai");
    expect((html.match(/role="tab"/g) ?? []).length).toBe(providers.length);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(providers.length - 1);
  });

  it("tablist 里只有 tab：自定义分组标签与「添加供应商」按钮在 list 外", () => {
    const html = renderProvider("openai");
    const start = html.indexOf('role="tablist"');
    const end = html.indexOf("</div>", start);
    expect(start).toBeGreaterThan(-1);
    const list = html.slice(start, end);
    expect(list).toContain('role="tab"');
    expect(list).not.toContain("pv-add");
    expect(list).not.toContain("pv-list-label");
  });

  it("详情面板由选中的 tab 命名（aria-labelledby 指向真实存在的 tab id）", () => {
    const html = renderProvider("deepseek");
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain('role="tabpanel"');
  });

  it("当前通道不在要 key 的清单里（无选中项）时，第一颗仍可 Tab 到且面板有名字", () => {
    const html = renderProvider("local");
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(0);
    expect(html).not.toContain("aria-labelledby");
    expect(html).toContain(`aria-label="${STR.provider.channelTitle}"`);
  });
});

describe("接线：两处 tablist 共用 tabNavigationTarget", () => {
  it("浏览器标签条：roving 停点 + 方向键换页并搬焦点", () => {
    const dock = readRendererFile("components/PaneDock.tsx");
    expect(dock).toContain("tabIndex={t.key === activeKey ? 0 : -1}");
    expect(dock).toContain("tabNavigationTarget(e.key, tabs.findIndex((x) => x.key === t.key), tabs.length)");
    expect(dock).toContain("querySelectorAll<HTMLElement>('[role=\"tab\"]')[next]?.focus()");
  });

  it("供应商列表：垂直轴换页，内置/自定义两组共用一条方向键序", () => {
    const provider = readRendererFile("components/settings/ProviderSection.tsx");
    expect(provider).toContain('tabNavigationTarget(e.key, absolute, tabCount, "vertical")');
    expect(provider).toContain("onKeyDown={(e) => moveTab(e, i)}");
    expect(provider).toContain("onKeyDown={(e) => moveTab(e, keyedProviders.length + j)}");
  });

  it("组内下标算法只剩 radio-nav.ts 一份", () => {
    const surface = readAppSurface();
    expect(surface).not.toContain("inspectorTabIndexForKey");
    expect(surface).not.toContain("paneTabTargetForKey");
    expect(readRendererFile("radio-nav.ts")).toContain("export function tabNavigationTarget(");
  });
});
