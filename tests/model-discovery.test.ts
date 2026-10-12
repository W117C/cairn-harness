// 模型发现（BYO 端点）的判卷：三个协议各一种 `/models` 形状，解析器只许搬上游**明说过**的字段。
// 这条纪律值得单独钉：一旦解析器替上游"补"上下文窗或价格，用户就会拿着一份看起来确定、
// 实际是编的配置去跑真任务——上游给不了的字段必须留空，让表格露出空格，而不是填一个数字上去。
//
// 三条形状都是 2026-10-06 对着官方文档/真实响应核过的（出处见 discovery.ts 头注）：
//   · DeepSeek：context_window / max_output_tokens / effort.supported_levels，**无价**
//   · OpenRouter：context_length / top_provider.max_completion_tokens / pricing（per token 字符串）
//   · Gemini：inputTokenLimit / outputTokenLimit / thinking
//   · 裸 OpenAI 兼容：只有 id / object / created / owned_by
import { describe, expect, it } from "vitest";
import {
  parseAnthropicModels,
  parseGeminiModels,
  parseModelList,
  parseOpenAiModels,
  perMTokFromPerToken,
} from "../src/providers/discovery";

const DEEPSEEK = {
  object: "list",
  data: [
    {
      id: "deepseek-chat",
      object: "model",
      owned_by: "deepseek",
      name: "DeepSeek Chat",
      context_window: 131072,
      max_output_tokens: 8192,
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
    {
      id: "deepseek-reasoner",
      object: "model",
      owned_by: "deepseek",
      name: "DeepSeek Reasoner",
      context_window: 131072,
      max_output_tokens: 65536,
      effort: { supported_levels: ["low", "medium", "high"], default_level: "medium" },
    },
  ],
};

describe("parseOpenAiModels：裸形状只搬 id，富形状才补参数", () => {
  it("裸 OpenAI 兼容（只有 id/object/created/owned_by）⇒ 只给 id，其余一律留空", () => {
    const [m] = parseOpenAiModels({
      object: "list",
      data: [{ id: "gpt-4o", object: "model", created: 1, owned_by: "openai" }],
    });
    expect(m.id).toBe("gpt-4o");
    // 这一组断言就是本文件的主题：不许替上游补数
    expect(m.contextWindow).toBeUndefined();
    expect(m.maxOutputTokens).toBeUndefined();
    expect(m.priceInPerMTok).toBeUndefined();
    expect(m.priceOutPerMTok).toBeUndefined();
    expect(m.label).toBeUndefined();
    expect(m.reasoningEfforts).toBeUndefined();
  });

  it("DeepSeek 富形状 ⇒ 名字/窗口/输出上限/模态/推理档位都搬过来，但价格仍然留空", () => {
    const models = parseOpenAiModels(DEEPSEEK);
    expect(models.map((m) => m.id)).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    const chat = models[0];
    expect(chat.label).toBe("DeepSeek Chat");
    expect(chat.contextWindow).toBe(131072);
    expect(chat.maxOutputTokens).toBe(8192);
    expect(chat.inputModalities).toEqual(["text"]);
    // DeepSeek 的 /models **不给价** ⇒ 不许因为我们知道它多少钱就填上去（那是产品决策，不是解析）
    expect(chat.priceInPerMTok).toBeUndefined();
    expect(models[1].reasoningEfforts).toEqual(["low", "medium", "high"]);
  });
});

describe("parseOpenAiModels：OpenRouter 形状（per-token 价格换算）", () => {
  it("context_length + top_provider.max_completion_tokens + pricing 字符串 → 美元/百万 token", () => {
    const [m] = parseOpenAiModels({
      data: [
        {
          id: "anthropic/claude-sonnet-5",
          name: "Anthropic: Claude Sonnet 5",
          context_length: 200000,
          top_provider: { context_length: 200000, max_completion_tokens: 64000 },
          pricing: { prompt: "0.000003", completion: "0.000015" },
          supported_parameters: ["tools", "reasoning"],
        },
      ],
    });
    expect(m.contextWindow).toBe(200000);
    expect(m.maxOutputTokens).toBe(64000);
    expect(m.priceInPerMTok).toBe(3);
    expect(m.priceOutPerMTok).toBe(15);
    expect(m.label).toBe("Anthropic: Claude Sonnet 5");
  });

  it("免费模型 pricing=\"0\" ⇒ 0 是**真实读数**，不是缺失（不许当成 undefined）", () => {
    const [m] = parseOpenAiModels({
      data: [{ id: "some/free", pricing: { prompt: "0", completion: "0" }, context_length: 8192 }],
    });
    expect(m.priceInPerMTok).toBe(0);
    expect(m.priceOutPerMTok).toBe(0);
  });

  it("per-token → per-MTok 的换算不带浮点脏尾（3e-6 × 1e6 就是 3）", () => {
    expect(perMTokFromPerToken("0.000003")).toBe(3);
    expect(perMTokFromPerToken(0.00000015)).toBe(0.15);
    expect(perMTokFromPerToken("0")).toBe(0);
    expect(perMTokFromPerToken("abc")).toBeUndefined();
    expect(perMTokFromPerToken("-1")).toBeUndefined();
    expect(perMTokFromPerToken("")).toBeUndefined();
  });
});

describe("parseGeminiModels / parseAnthropicModels", () => {
  it("Gemini：models[].name 去掉 models/ 前缀当调用名，inputTokenLimit 当上下文窗", () => {
    const models = parseGeminiModels({
      models: [
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          thinking: true,
          supportedGenerationMethods: ["generateContent"],
        },
      ],
    });
    expect(models[0].id).toBe("gemini-2.5-flash");
    expect(models[0].label).toBe("Gemini 2.5 Flash");
    expect(models[0].contextWindow).toBe(1048576);
    expect(models[0].maxOutputTokens).toBe(65536);
    expect(models[0].priceInPerMTok).toBeUndefined();
  });

  it("Anthropic：data[].id 当调用名，display_name 当可读名", () => {
    const models = parseAnthropicModels({
      data: [{ type: "model", id: "claude-sonnet-5", display_name: "Claude Sonnet 5", created_at: "2026-01-01T00:00:00Z" }],
      has_more: false,
    });
    expect(models).toEqual([{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }]);
  });
});

describe("解析的边界：宁可抛错，也不许把认不出的形状读成空清单", () => {
  it("认不出的形状 ⇒ 抛（空清单会被读成「这家一个模型都没有」）", () => {
    expect(() => parseOpenAiModels({ error: { message: "bad key" } })).toThrow(/认不出/);
    expect(() => parseGeminiModels(null)).toThrow(/认不出/);
    expect(() => parseAnthropicModels("nope")).toThrow(/认不出/);
  });

  it("拿不出调用名的条目被丢掉（没有名字就拨不出去）", () => {
    const models = parseOpenAiModels({ data: [{ object: "model" }, { id: "  " }, { id: "ok-model" }] });
    expect(models.map((m) => m.id)).toEqual(["ok-model"]);
  });

  it("非法数字不上表：负数 / NaN / 字符串 token 数一律忽略该字段，不静默变 0", () => {
    const [m] = parseOpenAiModels({
      data: [{ id: "weird", context_window: -5, max_output_tokens: "8192", pricing: { prompt: "not-a-number", completion: "1e-6" } }],
    });
    expect(m.contextWindow).toBeUndefined();
    expect(m.maxOutputTokens).toBeUndefined();
    expect(m.priceInPerMTok).toBeUndefined();
    expect(m.priceOutPerMTok).toBe(1);
  });

  it("dispatcher 按协议分发；未知协议 fail-visible", () => {
    expect(parseModelList("openai", DEEPSEEK).length).toBe(2);
    expect(parseModelList("gemini", { models: [] }).length).toBe(0);
    expect(() => parseModelList("mistral", { data: [] })).toThrow(/未知协议/);
  });
});
