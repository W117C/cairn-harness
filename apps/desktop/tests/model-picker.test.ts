import { describe, expect, it } from "vitest";
import { flattenModels } from "../src/renderer/components/ModelPicker";
import { formatTokens } from "../src/renderer/components/TokenPanel";
import type { ProviderInfo } from "../../../src/main/ipc-protocol";

// Step 1 勘定（src/main/provider-runtime.ts:22 + src/providers/registry.ts:13）：
// ProviderInfo = { kind, provider, model, modelId, models, keyConfigured }；
// ProviderModelInfo extends ModelSpec = { id, provider, model, tier, ctxWindow } + capability。
// 任务书骨架里的 `as never` 按真形收窄；ProviderInfo 层没有 capability（在 model 上），
// demo 的 provider 是「demo（冻结剧本，非真实模型）」（buildProviderInfo 原样）。
const demoInfo: ProviderInfo = {
  kind: "demo",
  provider: "demo（冻结剧本，非真实模型）",
  model: "mock-script",
  modelId: null,
  models: [],
  keyConfigured: false,
};

const openaiInfo: ProviderInfo = {
  kind: "openai",
  provider: "OpenAI",
  model: "gpt-4o",
  modelId: "openai-standard",
  models: [
    {
      id: "openai-standard",
      provider: "openai",
      model: "gpt-4o",
      tier: "standard",
      ctxWindow: 128_000,
      capability: {
        modelId: "openai-standard",
        provider: "openai",
        availability: "unverified",
        thinking: { supported: false, values: ["off"], default: "off" },
        attachments: { text: true, image: false },
      },
    },
  ],
  keyConfigured: true,
};

describe("flattenModels", () => {
  it("demo 常驻首项，provider→models 两级铺平", () => {
    const opts = flattenModels([demoInfo, openaiInfo]);
    expect(opts[0]).toMatchObject({ registryId: null, label: "演示" });
    expect(opts[1]).toMatchObject({ registryId: "openai-standard", provider: "openai" });
  });

  it("入参无 demo 条目 demo 仍常驻；真模型按 spec.id 去重（ProviderInfo.models 是全量表，多条目不重复铺）", () => {
    const opts = flattenModels([openaiInfo, openaiInfo]);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({ registryId: null, label: "演示" });
    expect(opts[1]).toMatchObject({ registryId: "openai-standard", label: "gpt-4o" });
  });
});

describe("formatTokens", () => {
  it("过 1000 显 k 一位小数，未过原样；0 与 999 不造假", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(3_100)).toBe("3.1k");
    expect(formatTokens(1_000_000)).toBe("1000.0k");
  });
});
