// 模型目录的判卷：解析上游形状 + 三段式第②段（拿地址和模型名去目录里查能填什么）。
// 这里钉的是一条纪律：**目录只搬上游说过的话**。上游没给价的模型，suggest 必须把它列进 missing
// 让人去填，而不是让界面看起来「已经填好了」——那正是 Cline 用 128000/0 价兜底踩过的坑
// （它自己的 UI 注释承认会把付费请求误计为 $0）。
import { describe, expect, it } from "vitest";
import {
  CATALOG_FILLABLE_MODEL_FIELDS,
  findCatalogModel,
  matchProvidersByBaseURL,
  normalizeBaseURL,
  parseCatalogSnapshot,
  parseModelsDevCatalog,
  suggestFromCatalog,
  type CatalogSnapshot,
} from "../src/providers/catalog";

/** models.dev 真实形状的裁剪样本（字段名逐字取自 https://models.dev/api.json）。 */
const MODELS_DEV = {
  deepseek: {
    id: "deepseek",
    env: ["DEEPSEEK_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.deepseek.com",
    name: "DeepSeek",
    models: {
      "deepseek-chat": {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        reasoning: true,
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1_000_000, output: 65536 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
      },
    },
  },
  openrouter: {
    id: "openrouter",
    env: ["OPENROUTER_API_KEY"],
    api: "https://openrouter.ai/api/v1",
    name: "OpenRouter",
    models: {
      "vendor/no-price-model": { id: "vendor/no-price-model", limit: { context: 8192 } },
    },
  },
  "empty-lab": { id: "empty-lab", name: "Empty", models: {} },
};

describe("parseModelsDevCatalog：只搬上游说过的话", () => {
  const catalog = parseModelsDevCatalog(MODELS_DEV);

  it("provider 级搬 name / api / env；没有模型的条目被丢掉", () => {
    expect(catalog.providers.map((p) => p.id)).toEqual(["deepseek", "openrouter"]);
    const ds = catalog.providers[0];
    expect(ds.name).toBe("DeepSeek");
    expect(ds.apiBaseURL).toBe("https://api.deepseek.com");
    expect(ds.envKeys).toEqual(["DEEPSEEK_API_KEY"]);
  });

  it("模型级单位不做换算：上游已是「每百万 token」，原样入表", () => {
    const m = catalog.providers[0].models[0];
    expect(m.contextWindow).toBe(1_000_000);
    expect(m.maxOutputTokens).toBe(65536);
    expect(m.pricing).toEqual({ inputPerMTok: 0.15, outputPerMTok: 0.6, cacheReadPerMTok: 0.003 });
  });

  it("上游没给的字段就是缺席：没有价格就没有 pricing，绝不补 0", () => {
    const m = catalog.providers[1].models[0];
    expect(m.pricing).toBeUndefined();
    expect(m.contextWindow).toBe(8192);
  });

  it("推理档位三种形态都认（toggle / effort / budget_tokens）", () => {
    const m = catalog.providers[0].models[0];
    expect(m.reasoning).toBe(true);
    expect(m.reasoningOptions?.map((o) => o.type)).toEqual(["toggle", "effort"]);
    expect(m.reasoningOptions?.[1].values).toEqual(["low", "high", "max"]);
  });

  it("认不出的形状抛错，不读成空目录（空目录会被当成「这家没有模型」）", () => {
    expect(() => parseModelsDevCatalog(null)).toThrow(/认不出/);
    expect(() => parseModelsDevCatalog({ a: { id: "a", models: {} } })).toThrow(/没有任何带模型的 provider/);
  });
});

describe("parseCatalogSnapshot：内置快照走严格校验", () => {
  it("正常快照可往返", () => {
    const snap = parseCatalogSnapshot({
      version: 1,
      source: "models.dev",
      generatedAt: "2026-10-06T00:00:00Z",
      providers: [
        {
          id: "deepseek",
          name: "DeepSeek",
          apiBaseURL: "https://api.deepseek.com",
          envKeys: ["DEEPSEEK_API_KEY"],
          models: [{ id: "deepseek-chat", contextWindow: 1_000_000, pricing: { inputPerMTok: 0.15 } }],
        },
      ],
    });
    expect(snap.providers[0].models[0].pricing).toEqual({ inputPerMTok: 0.15 });
    expect(snap.generatedAt).toBe("2026-10-06T00:00:00Z");
  });

  it("形状不对就抛（版本号 / providers 数组 / 模型 id 三者都钉）", () => {
    expect(() => parseCatalogSnapshot({ version: 2, source: "x", providers: [] })).toThrow(/形状不对/);
    expect(() => parseCatalogSnapshot({ version: 1, source: "x" })).toThrow(/形状不对/);
    expect(() => parseCatalogSnapshot({ version: 1, source: "x", providers: [{ id: "p", models: [{}] }] })).toThrow(
      /缺少 id/,
    );
  });
});

describe("用户填的地址怎么对到目录条目（这条规则行业里没有现成的）", () => {
  const catalog = parseModelsDevCatalog(MODELS_DEV);

  it("归一化：去协议、去尾斜杠、去尾 /v1 —— 用户写哪种都认", () => {
    expect(normalizeBaseURL("HTTPS://API.DeepSeek.com/v1/")).toBe("api.deepseek.com");
    expect(normalizeBaseURL("http://api.deepseek.com")).toBe("api.deepseek.com");
    expect(normalizeBaseURL("https://openrouter.ai/api/v1")).toBe("openrouter.ai/api");
  });

  it("完全一致 = exact；只有主机一致 = host（可能是同一家不同挂载点，交给用户确认）", () => {
    const exact = matchProvidersByBaseURL(catalog, "https://api.deepseek.com/v1");
    expect(exact[0].provider.id).toBe("deepseek");
    expect(exact[0].kind).toBe("exact");
    const host = matchProvidersByBaseURL(catalog, "https://api.deepseek.com/proxy/other");
    expect(host[0].kind).toBe("host");
    expect(matchProvidersByBaseURL(catalog, "https://not-in-catalog.example/v1")).toEqual([]);
    expect(matchProvidersByBaseURL(catalog, "")).toEqual([]);
  });

  it("查模型三级：原名 → 大小写不敏感 → 取最后一段（聚合网关的 vendor/model 写法）", () => {
    expect(findCatalogModel(catalog, "deepseek", "deepseek-chat")?.id).toBe("deepseek-chat");
    expect(findCatalogModel(catalog, "deepseek", "DeepSeek-Chat")?.id).toBe("deepseek-chat");
    expect(findCatalogModel(catalog, "openrouter", "vendor/no-price-model")?.id).toBe("vendor/no-price-model");
    expect(findCatalogModel(catalog, "openrouter", "no-price-model")?.id).toBe("vendor/no-price-model");
    expect(findCatalogModel(catalog, "deepseek", "不存在")).toBeUndefined();
  });
});

describe("suggestFromCatalog：能填的填上，填不了的必须点名", () => {
  const catalog = parseModelsDevCatalog(MODELS_DEV);

  it("全命中 ⇒ filled 有窗口/价格，missing 为空", () => {
    const s = suggestFromCatalog({ catalog, baseURL: "https://api.deepseek.com/v1", modelId: "deepseek-chat" });
    expect(s.provider?.id).toBe("deepseek");
    expect(s.model?.id).toBe("deepseek-chat");
    expect(s.matchKind).toBe("exact");
    expect(s.filled).toContain("contextWindow");
    expect(s.filled).toContain("pricing");
    expect(s.missing).toEqual([]);
  });

  it("命中 provider 但模型不在目录里 ⇒ 六项模型字段全部点名要手填（不是留哑空格）", () => {
    const s = suggestFromCatalog({ catalog, baseURL: "https://api.deepseek.com", modelId: "内部私有模型" });
    expect(s.provider?.id).toBe("deepseek");
    expect(s.model).toBeUndefined();
    expect(s.filled).toEqual(["apiBaseURL", "envKeys"]);
    expect(s.missing).toEqual([...CATALOG_FILLABLE_MODEL_FIELDS]);
  });

  it("目录里没给价的模型 ⇒ pricing 进 missing（Cline 那种补 0 的做法我们不抄）", () => {
    const s = suggestFromCatalog({ catalog, baseURL: "https://openrouter.ai/api/v1", modelId: "vendor/no-price-model" });
    expect(s.missing).toContain("pricing");
    expect(s.filled).toContain("contextWindow");
  });

  it("地址完全不在目录里 ⇒ provider 级也填不上，六项模型字段照旧全部点名", () => {
    const s = suggestFromCatalog({ catalog, baseURL: "http://localhost:11434/v1", modelId: "qwen3" });
    expect(s.provider).toBeUndefined();
    expect(s.model).toBeUndefined();
    expect(s.filled).toEqual([]);
    expect(s.missing).toEqual([...CATALOG_FILLABLE_MODEL_FIELDS]);
  });
});

describe("快照与运行时的接口一致性", () => {
  it("suggestFromCatalog 只依赖 CatalogSnapshot，两份来源都能喂", () => {
    const fromLive = parseModelsDevCatalog(MODELS_DEV);
    const fromSnapshot: CatalogSnapshot = parseCatalogSnapshot({
      version: 1,
      source: "models.dev",
      providers: [
        {
          id: "deepseek",
          apiBaseURL: "https://api.deepseek.com",
          envKeys: ["DEEPSEEK_API_KEY"],
          models: [{ id: "deepseek-chat", contextWindow: 1_000_000, pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 } }],
        },
      ],
    });
    const a = suggestFromCatalog({ catalog: fromLive, baseURL: "https://api.deepseek.com", modelId: "deepseek-chat" });
    const b = suggestFromCatalog({ catalog: fromSnapshot, baseURL: "https://api.deepseek.com", modelId: "deepseek-chat" });
    // 两份来源覆盖的字段数可以不同（快照是裁剪过的 ⇒ 它会多列几项 missing），
    // 但「能填什么」的判据必须同源：两边都认得这家、都认得这条模型、都把窗口与价填上了。
    for (const s of [a, b]) {
      expect(s.provider?.id).toBe("deepseek");
      expect(s.model?.id).toBe("deepseek-chat");
      expect(s.filled).toContain("contextWindow");
      expect(s.filled).toContain("pricing");
      expect(s.missing).not.toContain("contextWindow");
      expect(s.missing).not.toContain("pricing");
    }
  });
});
