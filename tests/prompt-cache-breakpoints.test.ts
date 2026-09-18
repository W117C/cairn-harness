// A1 写侧（用户裁决：只标静态段、不动排布）：Anthropic 显式 cache_control 断点，
// 且开关必须真能走到请求体（本轮刚建的门 0 就是罚「能力发货了但没人接」的形态）。
// 缓存价按裁决保持 null = 待联网实测校准，未标定期间 costUsd 走输入价上界（零回归）。
import { describe, expect, it } from "vitest";

import { toAnthropicBody, type AnthropicOptions } from "../src/providers/anthropic";
import { DEFAULT_MODEL_TABLE, toWorkerModel } from "../src/providers/registry";
import type { ProviderMessage, ProviderToolSpec } from "../src/providers";
import { costUsd, DEFAULT_PRICE_TABLE, uncalibratedCachePrices, type ModelPrice } from "../src/routing/pricing";

const SPEC = (name: string): ProviderToolSpec => ({ name, description: "d", parameters: { type: "object", properties: {} } });
const MSGS: ProviderMessage[] = [
  { role: "system", content: "基础提示：你是编程 agent" },
  { role: "system", content: "[记忆] 项目约定" },
  { role: "system", content: "[符号地图] 本轮重算" },
  { role: "user", content: "改个 bug" },
];

const anthropicStub = (capture: { body?: string }): typeof fetch =>
  ((async (_url: unknown, init?: RequestInit) => {
    capture.body = String(init?.body ?? "");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"message_start","message":{"id":"a1","usage":{"input_tokens":5}}}\n'));
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown) as typeof fetch;

describe("toAnthropicBody 静态段断点", () => {
  it("缺省与显式 false ⇒ system 仍是整串、全站零 cache_control（逐字旧行为）", () => {
    for (const opts of [{ model: "m", maxTokens: 100, stream: true }, { model: "m", maxTokens: 100, stream: true, promptCache: false }]) {
      const body = toAnthropicBody(MSGS, opts, [SPEC("read_file"), SPEC("edit_file")]);
      expect(typeof body.system).toBe("string");
      expect(JSON.stringify(body)).not.toContain("cache_control");
    }
  });

  it("开启 ⇒ 断点只落在静态段：末个 tool + system 首块（易变的记忆/地图留在断点之后）", () => {
    const body = toAnthropicBody(MSGS, { model: "m", maxTokens: 100, stream: true, promptCache: true }, [SPEC("read_file"), SPEC("edit_file")]);
    const system = body.system as { type: string; text: string; cache_control?: { type: string } }[];
    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(3);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].cache_control, "记忆块不得进缓存条目（逐轮变化，打点等于每轮重写）").toBeUndefined();
    expect(system[2].cache_control, "地图块同上").toBeUndefined();
    const tools = body.tools as { name: string; cache_control?: { type: string } }[];
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[1].cache_control).toEqual({ type: "ephemeral" }); // 唯一纯静态段：会话内工具表不变
    expect(system[0].text).toBe("基础提示：你是编程 agent"); // 分块不改内容，只改结构
  });

  it("开启但没有 tools ⇒ 不凭空造 tools 键", () => {
    const body = toAnthropicBody(MSGS, { model: "m", maxTokens: 100, stream: true, promptCache: true });
    expect(body.tools).toBeUndefined();
    expect(body.system).toBeDefined();
  });
});

describe("开关可达性：settings → registry 分派 → 请求体", () => {
  // registry 只传 model/fetchImpl，key 一律从环境变量读——测试里临时注入假 key，
  // 并在消费流时吞掉适配器对假响应的抱怨：这里唯一的断言物是**发出去的请求体**。
  const drive = async (specId: string, opts: Parameters<typeof toWorkerModel>[1], env: Record<string, string>): Promise<string | undefined> => {
    const spec = DEFAULT_MODEL_TABLE.find((s) => s.id === specId)!;
    const cap: { body?: string } = {};
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
    try {
      const model = toWorkerModel(spec, { ...opts, fetchImpl: anthropicStub(cap) as unknown as typeof fetch });
      for await (const _o of model(
        [{ role: "system", content: "基础提示" }, { role: "user", content: "hi" }] as never,
        [{ type: "function", function: { name: "read_file", description: "d", parameters: { type: "object", properties: {} } } }] as never,
      )) void _o;
    } catch {
      /* 桩回的是 anthropic 形状帧，别的适配器会抱怨——请求体已捕获 */
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    return cap.body;
  };

  it("Anthropic 档位带 promptCache ⇒ 真实请求体里就有 cache_control", async () => {
    const body = await drive("anthropic-standard", { promptCache: true }, { ANTHROPIC_API_KEY: "test-key" });
    expect(body, "请求体未捕获：分派链断了").toBeDefined();
    expect(body).toContain("cache_control");
  });

  it("不带开关 ⇒ 同一档位请求体逐字不含 cache_control（opt-in 不是默认）", async () => {
    const body = await drive("anthropic-standard", {}, { ANTHROPIC_API_KEY: "test-key" });
    expect(body).toBeDefined();
    expect(body).not.toContain("cache_control");
  });

  it("OpenAI 兼容面不吃这个开关（无写侧标记，自动前缀缓存）⇒ 传了也零行为", async () => {
    const body = await drive("openai-standard", { promptCache: true }, { OPENAI_API_KEY: "test-key" });
    expect(body).toBeDefined();
    expect(body).not.toContain("cache_control");
  });
});

describe("缓存价：待校准清单与上界口径", () => {
  it("全部档位缓存价均为 null（未编数），清单可审计", () => {
    expect(uncalibratedCachePrices()).toEqual(Object.keys(DEFAULT_PRICE_TABLE).sort());
  });

  it("未标定 ⇒ 带缓存分块与不带的成本逐字同值（上界口径，零回归）", () => {
    const plain = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 1_000 });
    const withCache = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 1_000, cacheReadInputTokens: 80_000 });
    expect(withCache).toBeCloseTo(plain, 12);
  });

  it("标定后（注入价表）⇒ 命中段按缓存价计，成本随命中率下降", () => {
    const table: Record<string, ModelPrice> = { "anthropic-standard": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 } };
    const noHit = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 0 }, table);
    const bigHit = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 0, cacheReadInputTokens: 90_000 }, table);
    expect(noHit).toBeCloseTo(0.3, 10); // 100k × $3/M
    expect(bigHit).toBeCloseTo(0.057, 10); // 10k×$3 + 90k×$0.3 = 0.03 + 0.027
    expect(bigHit).toBeLessThan(noHit);
  });

  it("分块大于总输入（对端报数不一致）⇒ 夹到区间内，不出现负数输入", () => {
    const c = costUsd("anthropic-standard", { inputTokens: 10, outputTokens: 0, cacheReadInputTokens: 999, cacheWriteInputTokens: 999 });
    expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe("AnthropicOptions 形状", () => {
  it("promptCache 是可选开关，其余字段不变（不扩接口面）", () => {
    const opts: AnthropicOptions = { apiKey: "k", promptCache: true };
    expect(opts.promptCache).toBe(true);
  });
});
