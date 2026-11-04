// C-21 `ModelPicker` 的判卷。2026-10-06 按 desktop-ui-spec §5.4 重写后重写判据：
// 钉的四件事正是用户实测反馈缺的那四件 —— tier 徽标有**文字**、窗口有人话写法、
// key 未配置要有 fail-visible 提示、演示要诚实标注（不是一句「演示」了事）。
// 2026-11-01 业主裁「不要演示」⇒ 演示**从列表里消失**（它仍是缺省通道，芯片照旧显示它的名字）；
// 组头改说人话标签（ProviderInfo.providers）。
import { describe, expect, it } from "vitest";
import {
  describeSelection,
  flattenModels,
  formatCtxWindow,
  groupModels,
  pickerKeyNotice,
  providerLabelMap,
  shortModelName,
  tierBadge,
} from "../src/renderer/components/ModelPicker";
import { formatTokens } from "../src/renderer/components/format-tokens";
import type { ProviderInfo } from "../../../src/main/ipc-protocol";

function model(id: string, provider: string, model_: string, tier: string, ctxWindow: number) {
  return {
    id,
    provider,
    model: model_,
    tier: tier as "cheap" | "standard" | "strong",
    ctxWindow,
    capability: {
      modelId: id,
      provider,
      availability: "unverified" as const,
      thinking: { supported: false, values: ["off"] as const, default: "off" as const },
      attachments: { text: true, image: false },
    },
  };
}

const info: ProviderInfo = {
  kind: "openai",
  provider: "OpenAI",
  model: "gpt-4o",
  modelId: "openai-standard",
  models: [model("openai-standard", "openai", "gpt-4o", "standard", 128_000), model("deepseek-chat", "deepseek", "deepseek-chat", "standard", 1_000_000)],
  keyConfigured: true,
  providers: [
    { id: "openai", label: "OpenAI", custom: false },
    { id: "deepseek", label: "DeepSeek", custom: true },
  ],
};

const demoInfo: ProviderInfo = {
  kind: "demo",
  provider: "demo（冻结剧本，非真实模型）",
  model: "mock-script",
  modelId: null,
  models: [],
  keyConfigured: false,
  providers: [],
};

describe("档位与窗口的人话写法（规范：徽标必须有文字，不只靠颜色）", () => {
  it("tierBadge 三档有文字，认不出的说「未定档」而不是留空", () => {
    expect(tierBadge("cheap")).toBe("便宜");
    expect(tierBadge("standard")).toBe("标准");
    expect(tierBadge("strong")).toBe("强");
    expect(tierBadge(undefined)).toBe("未定档");
  });

  it("formatCtxWindow：与 formatTokens 同一把尺（k/m）/ 小数 / 缺省给 —（不给 0）", () => {
    expect(formatCtxWindow(1_000_000)).toBe("1.0m");
    expect(formatCtxWindow(128_000)).toBe("128.0k");
    expect(formatCtxWindow(1_500_000)).toBe("1.5m");
    expect(formatCtxWindow(500)).toBe("500");
    expect(formatCtxWindow(undefined)).toBe("—");
    expect(formatCtxWindow(0)).toBe("—");
    // 第 937 页：一条「必须等于 formatTokens」的钉——再有人在这写一套 k/M，这里当场红
    for (const n of [500, 1000, 12_000, 128_000, 999_999, 1_000_000, 1_500_000]) {
      expect(formatCtxWindow(n)).toBe(formatTokens(n));
    }
  });
});

describe("铺平与分组", () => {
  it("「演示」不在列表里（业主 2026-11-01 裁：「不要演示」）；真模型带上 tier 与窗口", () => {
    const options = flattenModels([info]);
    // 演示**不再是可选项**：菜单里不再有这一行（它仍是 app 的缺省通道，芯片照旧显示它的名字）。
    expect(options.some((o) => o.registryId === null)).toBe(false);
    expect(options.map((o) => o.registryId)).toEqual(["openai-standard", "deepseek-chat"]);
    const custom = options.find((o) => o.registryId === "deepseek-chat");
    expect(custom?.provider).toBe("deepseek");
    expect(custom?.tier).toBe("standard");
    expect(custom?.ctxWindow).toBe(1_000_000);
  });

  it("多个 ProviderInfo 里的重复模型只铺一次", () => {
    const options = flattenModels([info, info]);
    expect(options.filter((o) => o.registryId === "openai-standard")).toHaveLength(1);
  });

  it("按 provider 分组、保持首见顺序", () => {
    const groups = groupModels(flattenModels([info]));
    expect(groups.map((g) => g.provider)).toEqual(["openai", "deepseek"]);
    expect(groups[0].models).toHaveLength(1);
  });

  it("空目录时没有任何分组（界面据此显示「去设置里接一家」）", () => {
    expect(groupModels(flattenModels([demoInfo]))).toEqual([]);
  });
});

describe("组头的人话标签（ProviderInfo.providers 是唯一事实源）", () => {
  it("provider id → 标签：有登记的用标签，没登记的落回 id", () => {
    const map = providerLabelMap([info]);
    expect(map.get("openai")).toBe("OpenAI");
    expect(map.get("deepseek")).toBe("DeepSeek");
    expect(map.get("agnes-ai")).toBeUndefined();
  });

  it("标签为空 ⇒ 不登记（组头落回 id，不显示空白）", () => {
    const map = providerLabelMap([{ ...info, providers: [{ id: "x", label: "", custom: true }] }]);
    expect(map.get("x")).toBeUndefined();
  });
});

describe("key 未配置是 fail-visible 的置顶提示", () => {
  it("demo 不算未配置（它按设计不需要 key）", () => {
    expect(pickerKeyNotice(demoInfo)).toBeNull();
  });
  it("真通道没 key ⇒ 给出带 provider 名的提示与去处", () => {
    expect(pickerKeyNotice({ ...info, keyConfigured: false })).toBe("OpenAI 未配置 key · 去设置配置");
  });
  it("配好了 ⇒ null；没有 info ⇒ null", () => {
    expect(pickerKeyNotice(info)).toBeNull();
    expect(pickerKeyNotice(null)).toBeNull();
  });
});

describe("触发条文案", () => {
  it("短名：演示 / 模型名 / 未登记值时回退原值", () => {
    const options = flattenModels([info]);
    expect(shortModelName(null, options)).toBe("演示");
    expect(shortModelName("deepseek-chat", options)).toBe("deepseek-chat");
    expect(shortModelName("ghost-model", options)).toBe("ghost-model");
  });

  it("超长名截断到 140（规范条）", () => {
    const long = "x".repeat(200);
    expect(shortModelName(long, []).length).toBe(140);
  });

  it("describeSelection：演示写明「不产生真实调用」；命中给出 provider/tier/窗口；未命中显式回落", () => {
    const options = flattenModels([info]);
    expect(describeSelection(null, options)).toContain("不产生真实调用");
    expect(describeSelection("deepseek-chat", options)).toContain("窗口 1.0m");
    expect(describeSelection("deepseek-chat", options)).toContain("标准");
    expect(describeSelection("ghost", options)).toContain("不在当前目录");
  });
});

describe("formatTokens（相邻面板的同一把尺，顺手回归）", () => {
  it("常见量级仍正常", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1234)).toBe("1.2k");
  });

  it("过百万进位到 m；999_950 那档不再写成四位数 1000.0k（第 921 页）", () => {
    expect(formatTokens(1_000_000)).toBe("1.0m");
    expect(formatTokens(1_250_000)).toBe("1.3m");
    expect(formatTokens(999_960)).toBe("1.0m");
    expect(formatTokens(999_949)).toBe("999.9k");
    expect(formatTokens(400_000)).toBe("400.0k");
  });
});
