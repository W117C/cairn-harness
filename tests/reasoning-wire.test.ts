// S8 判卷：thinking / reasoning 从「被收下然后丢掉」变成真的进了请求体。
//
// 这里钉四件事：
//   ① 映射表（档位 → 各协议形态）与上游档位名的别名映射；
//   ② 三支适配器各自把参数放进 body 的正确位置（openai: reasoning_effort / anthropic: thinking /
//      gemini: generationConfig.thinkingConfig）；
//   ③ 能力表的门：**有证据才开门**（用户给自己的模型声明了档位），内置模型照旧 supported=false；
//   ④ 推理增量（DeepSeek 的 reasoning_content）绝不混进答给用户的正文。
import { afterEach, describe, expect, it } from "vitest";
import { reasoningDirective, mapUpstreamEfforts, REASONING_BUDGET_TOKENS } from "../src/providers/reasoning";
import { toWorkerModel, installCustomProviders, effectiveModelTable, type ModelSpec } from "../src/providers/registry";
import { capabilityForModel, validateThinkingEffort } from "../src/providers/capabilities";
import { deriveCustomProviders, parseCustomProviders } from "../src/providers/provider-config";

afterEach(() => installCustomProviders([]));

const spec = (provider: string): ModelSpec => ({
  id: `${provider}-x`,
  provider,
  model: "some-model",
  tier: "standard",
  ctxWindow: 200_000,
});

/** 收一次请求：返回 fetch 捕获到的 body 与后续事件。 */
async function capture(opts: {
  provider: string;
  reasoningEffort?: "off" | "low" | "medium" | "high";
  sse?: string;
}): Promise<{ body: Record<string, unknown>; events: { type: string; text?: string }[] }> {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: unknown, init: unknown) => {
    calls.push((init ?? {}) as RequestInit);
    return new Response(opts.sse ?? 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
  process.env[safeEnvFor(opts.provider)] = "sk-test";
  const transport = toWorkerModel(spec(opts.provider), {
    fetchImpl,
    ...(opts.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {}),
  });
  const events: { type: string; text?: string }[] = [];
  for await (const e of transport([{ role: "user", content: "hi" }], [], {})) {
    events.push({
      type: e.type,
      ...(e.type === "assistant_delta" || e.type === "thinking_delta" ? { text: e.text } : {}),
    });
  }
  delete process.env[safeEnvFor(opts.provider)];
  return { body: JSON.parse(String(calls[0].body)) as Record<string, unknown>, events };
}

function safeEnvFor(provider: string): string {
  return { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", glm: "CAIRN_API_KEY" }[provider] ?? "OPENAI_API_KEY";
}

describe("映射表", () => {
  it("off / 未给 ⇒ null（请求体里一个字都不加）", () => {
    expect(reasoningDirective(undefined)).toBeNull();
    expect(reasoningDirective("off")).toBeNull();
  });

  it("三档各有预算，且单调递增", () => {
    expect(reasoningDirective("low")).toEqual({ effort: "low", budgetTokens: REASONING_BUDGET_TOKENS.low });
    expect(REASONING_BUDGET_TOKENS.low).toBeLessThan(REASONING_BUDGET_TOKENS.medium);
    expect(REASONING_BUDGET_TOKENS.medium).toBeLessThan(REASONING_BUDGET_TOKENS.high);
  });

  it("上游档位名映射：实测 DeepSeek 的 [low,high,max] ⇒ [low,high]（max 归到高，认不出的丢掉）", () => {
    expect(mapUpstreamEfforts(["low", "high", "max"])).toEqual(["low", "high"]);
    expect(mapUpstreamEfforts(["minimal", "low"])).toEqual(["low"]);
    expect(mapUpstreamEfforts(["xhigh"])).toEqual(["high"]);
    expect(mapUpstreamEfforts(["unknown-level", ""])).toEqual([]);
    // 输出去重且按我们自己的顺序（低→高）
    expect(mapUpstreamEfforts(["high", "low", "low"])).toEqual(["low", "high"]);
  });
});

describe("三支适配器把参数放对位置", () => {
  it("openai 兼容：body.reasoning_effort = 档位名", async () => {
    const on = await capture({ provider: "openai", reasoningEffort: "high" });
    expect(on.body.reasoning_effort).toBe("high");
    const off = await capture({ provider: "openai" });
    expect("reasoning_effort" in off.body).toBe(false);
  });

  it("anthropic：body.thinking = {enabled, budget_tokens}，且 max_tokens 被抬到预算之上", async () => {
    const r = await capture({ provider: "anthropic", reasoningEffort: "high" });
    expect(r.body.thinking).toEqual({ type: "enabled", budget_tokens: REASONING_BUDGET_TOKENS.high });
    expect(Number(r.body.max_tokens)).toBeGreaterThan(REASONING_BUDGET_TOKENS.high);
    const off = await capture({ provider: "anthropic" });
    expect("thinking" in off.body).toBe(false);
  });

  it("gemini：body.generationConfig.thinkingConfig.thinkingBudget", async () => {
    const r = await capture({ provider: "gemini", reasoningEffort: "low" });
    expect(r.body.generationConfig).toEqual({ thinkingConfig: { thinkingBudget: REASONING_BUDGET_TOKENS.low } });
    const off = await capture({ provider: "gemini" });
    expect("generationConfig" in off.body).toBe(false);
  });
});

describe("推理增量不许泄漏进正文", () => {
  it("思考与正文**分开**：正文里不含思考，思考只在 thinking_delta 里", async () => {
    // 2026-10-07 契约更新：以前推理增量被整体丢弃（用户因此看不到思考过程），
    // 现在走独立事件。这条判据钉的是"不许混"——正文仍是正文，思考单独一段。
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"我先想想……"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"答案是 42"}}]}\n\n' +
      "data: [DONE]\n\n";
    const r = await capture({ provider: "openai", sse });
    const texts = r.events.filter((e) => e.type === "assistant_delta").map((e) => e.text);
    expect(texts).toEqual(["答案是 42"]); // 正文一个字都没被思考污染
    const thinking = r.events.filter((e) => e.type === "thinking_delta").map((e) => e.text);
    expect(thinking).toEqual(["我先想想……"]); // 思考单独落事件
  });
});

describe("能力表的门：有证据才开门", () => {
  it("内置档位照旧 supported=false（没有任何一条带凭据实测过）", () => {
    const cap = capabilityForModel({ id: "openai-standard", provider: "openai" });
    expect(cap.thinking.supported).toBe(false);
    expect(cap.thinking.values).toEqual(["off"]);
    expect(() => validateThinkingEffort({ id: "openai-standard", provider: "openai" }, "high")).toThrow(/不支持/);
  });

  it("用户给自己的模型声明了档位 ⇒ 只有声明过的那些可选（max 被映射掉，medium 没声明就不能选）", () => {
    const parsed = parseCustomProviders({
      version: 1,
      providers: [
        {
          id: "deepseek",
          protocol: "openai",
          baseURL: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: [{ id: "chat", model: "deepseek-chat", reasoningEfforts: ["low", "high", "max"] }],
        },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    installCustomProviders(deriveCustomProviders(parsed.file));
    const custom = effectiveModelTable().find((s) => s.id === "deepseek-chat");
    if (custom === undefined) throw new Error("自定义档位没进表");
    const cap = capabilityForModel(custom);
    expect(cap.thinking.supported).toBe(true);
    expect(cap.thinking.values).toEqual(["off", "low", "high"]);
    expect(cap.thinking.default).toBe("off"); // 声明了支持 ≠ 替你打开
    expect(validateThinkingEffort(custom, "high")).toBe("high");
    expect(() => validateThinkingEffort(custom, "medium")).toThrow(/不支持/);
  });

  it("没声明档位的自定义模型也不开门（证据是唯一依据）", () => {
    const parsed = parseCustomProviders({
      version: 1,
      providers: [
        { id: "gw", protocol: "openai", baseURL: "https://gw.example.com/v1", apiKeyEnv: "GW_KEY", models: [{ id: "m", model: "m" }] },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    installCustomProviders(deriveCustomProviders(parsed.file));
    const custom = effectiveModelTable().find((s) => s.id === "gw-m");
    expect(capabilityForModel(custom!).thinking.supported).toBe(false);
  });
});

describe("思考正文：走独立事件，不并进正文", () => {
  it("openai 系：reasoning_content ⇒ thinking_delta（正文仍是 assistant_delta）", async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"先想想这一步"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"答案是 42"}}]}\n\n' +
      "data: [DONE]\n\n";
    const r = await capture({ provider: "openai", sse });
    expect(r.events.filter((e) => e.type === "thinking_delta").map((e) => e.text)).toEqual(["先想想这一步"]);
    expect(r.events.filter((e) => e.type === "assistant_delta").map((e) => e.text)).toEqual(["答案是 42"]);
  });

  it("OpenAI o 系的字段名 reasoning 也认", async () => {
    const sse = 'data: {"choices":[{"delta":{"reasoning":"想想"}}]}\n\ndata: [DONE]\n\n';
    const r = await capture({ provider: "openai", sse });
    expect(r.events.filter((e) => e.type === "thinking_delta").map((e) => e.text)).toEqual(["想想"]);
  });

  it("没吐思考 ⇒ 一个 thinking_delta 都没有（零行为）", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"直接答"}}]}\n\ndata: [DONE]\n\n';
    const r = await capture({ provider: "openai", sse });
    expect(r.events.filter((e) => e.type === "thinking_delta")).toHaveLength(0);
  });
});
