// 第 1151 页：ProviderSection 的供应商标签/自定义列表/编辑项按输入记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("ProviderSection 派生记忆", () => {
  it("providerLabel/customs/editingEntry useMemo", () => {
    expect(src).toContain("const providerLabel = useMemo(() => props.providers.find((p) => p.id === provider)?.label ?? provider, [props.providers, provider]);");
    expect(src).toContain("const customs = useMemo(() => props.providers.filter((p) => p.custom), [props.providers]);");
    expect(src).toContain("const editingEntry = useMemo(() => activeCustom !== null ? customEntries.find((e) => e.id === activeCustom) ?? null : null, [customEntries, activeCustom]);");
  });
});
