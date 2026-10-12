// 草稿生成的判卷。这里有一条**最要紧**的断言：生成的配置片段必须能通过我们自己的严格校验
// （parseCustomProviders）——「帮你填好的东西自己都不合法」是这个功能最丢人的失败形态。
import { describe, expect, it } from "vitest";
import { buildProviderDraft, suggestApiKeyEnv, suggestProviderId, wrapProvidersFile } from "../src/providers/provider-draft";
import { parseCustomProviders } from "../src/providers/provider-config";

describe("从地址推名字（建议值，用户可改）", () => {
  it("常见情况", () => {
    expect(suggestProviderId("https://api.deepseek.com/v1").id).toBe("deepseek");
    expect(suggestProviderId("https://openrouter.ai/api/v1").id).toBe("openrouter");
    expect(suggestProviderId("https://llm.mycompany.com/v1").id).toBe("mycompany");
    expect(suggestProviderId("https://api.moonshot.cn/v1").id).toBe("moonshot");
  });

  it("撞上内置名时让开一步，并说明为什么", () => {
    const r = suggestProviderId("https://api.openai.com/v1");
    expect(r.id).toBe("openai-compat");
    expect(r.note).toContain("内置");
  });

  it("认不出主机名 / 数字主机 / 本地 ⇒ custom", () => {
    expect(suggestProviderId("不是地址").id).toBe("custom");
    expect(suggestProviderId("https://localhost:11434/v1").id).toBe("custom");
    expect(suggestProviderId("https://127.0.0.1/v1").id).toBe("custom");
  });

  it("id 不超过 32 字符（配置校验的上限），且不留尾部短横", () => {
    const id = suggestProviderId(`https://${"a".repeat(40)}.example.com/v1`).id;
    expect(id.length).toBeLessThanOrEqual(32);
    expect(id.endsWith("-")).toBe(false);
  });

  it("env 变量名由 id 派生", () => {
    expect(suggestApiKeyEnv("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(suggestApiKeyEnv("my-gw")).toBe("MY_GW_API_KEY");
  });
});

describe("草稿：只写拿到的字段，缺的必须点名", () => {
  const base = {
    providerId: "deepseek",
    label: "DeepSeek",
    protocol: "openai" as const,
    baseURL: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  };

  it("**生成的片段能通过我们自己的严格校验**（这是本文件的核心断言）", () => {
    const draft = buildProviderDraft({
      ...base,
      models: [
        { id: "deepseek-chat", contextWindow: 131_072, price: { inputPerMTok: 0.28, outputPerMTok: 0.42 }, origin: "catalog" },
        { id: "内部模型", origin: "discovery" },
      ],
    });
    const file = wrapProvidersFile([draft.json]);
    const parsed = parseCustomProviders(JSON.parse(file) as unknown);
    if (!parsed.ok) throw new Error("自己生成的配置没通过自己的校验：" + JSON.stringify(parsed.problems));
    // 非法 id（中文）被挡在草稿之外并点名，而不是让用户粘进去再被校验器拒一次
    expect(parsed.file.providers[0].models.map((m) => m.id)).toEqual(["deepseek-chat"]);
    expect(parsed.file.providers[0].models[0].contextWindow).toBe(131_072);
    expect(draft.warnings.join("\n")).toContain("内部模型");
  });

  it("目录也不知道的字段进 missing，并各有告警（不填假数）", () => {
    const draft = buildProviderDraft({ ...base, models: [{ id: "internal-model", origin: "discovery" }] });
    expect(draft.missing).toEqual(["contextWindow", "maxOutputTokens", "price", "reasoningEfforts"]);
    expect(draft.warnings.join("\n")).toContain("没有价");
    expect(draft.warnings.join("\n")).toContain("上下文窗口");
    // 拿不到的字段一个都不许出现在 JSON 里
    expect(draft.json).not.toContain("contextWindow");
    expect(draft.json).not.toContain("price");
  });

  it("拿全的字段写全，且不再报 missing（价与窗口都有时不告警）", () => {
    const draft = buildProviderDraft({
      ...base,
      models: [
        {
          id: "deepseek-chat",
          contextWindow: 131_072,
          maxOutputTokens: 8_192,
          price: { inputPerMTok: 0.28, outputPerMTok: 0.42 },
          reasoningEfforts: ["low", "high"],
          origin: "catalog",
        },
      ],
    });
    expect(draft.missing).toEqual([]);
    expect(draft.warnings).toEqual([]);
    expect(draft.json).toContain("reasoningEfforts");
    expect(draft.json).toContain("maxOutputTokens");
  });

  it("wrapProvidersFile 产出的是一份合法文件（version + providers 数组）", () => {
    const a = buildProviderDraft({ ...base, models: [{ id: "m1", origin: "discovery" }] }).json;
    const b = buildProviderDraft({
      ...base,
      providerId: "moonshot",
      apiKeyEnv: "MOONSHOT_API_KEY",
      models: [{ id: "kimi-k2", origin: "discovery" }],
    }).json;
    const parsed = parseCustomProviders(JSON.parse(wrapProvidersFile([a, b])) as unknown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file.providers.map((p) => p.id)).toEqual(["deepseek", "moonshot"]);
  });
});
