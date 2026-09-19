// A1 写侧（用户裁决：只标静态段、不动排布）：Anthropic 显式 cache_control 断点，
// 且开关必须真能走到请求体（本轮刚建的门 0 就是罚「能力发货了但没人接」的形态）。
// 缓存价按裁决保持 null = 待联网实测校准，未标定期间 costUsd 走输入价上界（零回归）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventLog } from "../src/events";
import { Orchestrator } from "../src/agent/orchestrator";
import { toAnthropicBody, type AnthropicOptions } from "../src/providers/anthropic";
import { DEFAULT_MODEL_TABLE, toWorkerModel } from "../src/providers/registry";
import type { ProviderMessage, ProviderToolSpec } from "../src/providers";
import { costUsd, DEFAULT_PRICE_TABLE, uncalibratedCachePrices, unpricedModels, type ModelPrice } from "../src/routing/pricing";

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
  it("已标定档位不在待校准清单、未标定的必在（清单是真话不是摆设）", () => {
    const list = uncalibratedCachePrices();
    for (const id of ["anthropic-cheap", "anthropic-standard", "anthropic-strong"]) {
      expect(list, id + " 读写缓存价都已实测过，不该再出现在清单里").not.toContain(id);
    }
    for (const id of ["glm-flash", "glm-standard", "glm-strong"]) {
      expect(list, id + " 仍是占位 ⇒ 必须在清单里").toContain(id);
    }
    // 清单与数表自洽：列出的每一条确实至少有一个 null 桶
    for (const id of list) {
      const p = DEFAULT_PRICE_TABLE[id]!;
      expect(p.cacheReadPerMTok === null || p.cacheWritePerMTok === null, id).toBe(true);
    }
  });

  it("输入价仍是占位的档位单独可查（GLM 官方页没抓到数 ⇒ 不许当省钱证据）", () => {
    expect(unpricedModels()).toEqual(["glm-flash", "glm-standard", "glm-strong"]);
  });

  it("未标定档位 ⇒ 带缓存分块与不带的成本逐字同值（上界口径，零回归）", () => {
    // 必须用**两桶都还是 null** 的档位测：Anthropic 已标定后这里会真的变便宜（见下一条）。
    const plain = costUsd("glm-flash", { inputTokens: 100_000, outputTokens: 1_000 });
    const withCache = costUsd("glm-flash", { inputTokens: 100_000, outputTokens: 1_000, cacheReadInputTokens: 80_000 });
    expect(withCache).toBeCloseTo(plain, 12);
  });

  it("Anthropic 现行价：缓存命中段按 ×0.1 计 ⇒ 成本随命中率真降（A1 断点的价格面）", () => {
    // 官方价 $2/$10 每 MTok，cache read = 输入价 ×0.1 = $0.2，cache write = ×1.25 = $2.5
    const noHit = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 0 });
    const ninety = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 0, cacheReadInputTokens: 90_000 });
    expect(noHit).toBeCloseTo(0.2, 10);
    expect(ninety).toBeCloseTo(0.038, 10); // 10k×$2/1M + 90k×$0.2/1M
    expect(ninety).toBeLessThan(noHit);
    // 写桶不是免费的：首次建缓存那一段按 ×1.25 计
    const wrote = costUsd("anthropic-standard", { inputTokens: 100_000, outputTokens: 0, cacheWriteInputTokens: 100_000 });
    expect(wrote).toBeCloseTo(0.25, 10);
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
    // 必须用**已标定**价表测：未标定时读桶按输入价计，钳与不钳同值（第一版就是这样假绿的）。
    const table: Record<string, ModelPrice> = { "anthropic-standard": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 } };
    const c = costUsd("anthropic-standard", { inputTokens: 10, outputTokens: 0, cacheReadInputTokens: 999, cacheWriteInputTokens: 999 }, table);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeCloseTo(0.000003, 10); // 全部 10 token 归读桶：10 × $0.3 / M = 3e-6；未命中段夹到 0 不为负
  });
});

describe("AnthropicOptions 形状", () => {
  it("promptCache 是可选开关，其余字段不变（不扩接口面）", () => {
    const opts: AnthropicOptions = { apiKey: "k", promptCache: true };
    expect(opts.promptCache).toBe(true);
  });
});

// 端到端那一跳最容易被漏：上一轮三条变异里有一条专门罚「纯函数对了、调用点断线」。
// 这里不打桩 registry——起真 Orchestrator + 真路由 + 全局 fetch 桩，只看发出去的字节。
describe("端到端接线：开关 → 编排器 → 分派 → worker 真实请求体", () => {
  let work: string;
  let logPath: string;
  let bodies: string[];

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "prompt-cache-orch-"));
    logPath = join(work, "events.jsonl");
    await writeFile(logPath, "", "utf8");
    bodies = [];
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    vi.unstubAllGlobals();
  });

  const spawnAnthropicWorker = async (promptCache: boolean): Promise<string> => {
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"message_start","message":{"id":"a1","usage":{"input_tokens":5}}}\n'));
          controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const saved: Record<string, string | undefined> = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, M0_API_KEY: process.env.M0_API_KEY };
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.M0_API_KEY = "test-key";
    try {
      const orch = new Orchestrator({
        logPath,
        workspace: work,
        parentMode: "default",
        routing: true,
        ...(promptCache ? { promptCache: true } : {}),
        emit: async (e) => { await createEventLog(logPath).append(e); },
      });
      const r = await orch.spawn({ mode: "read", task: "探一下仓库", model: "anthropic-standard" }, { callId: "s1" });
      expect(r.ok, "路由 pin 到 anthropic 档应放行").toBe(true);
      await new Promise((res) => setTimeout(res, 300)); // 给 worker 一拍把请求发出去
      await orch.cancelAll();
      await orch.waitAll(3_000);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    return bodies.join("\n");
  };

  it("开 promptCache ⇒ worker 出网的请求体里确有 cache_control（能力真可达，不是纸面开关）", async () => {
    const all = await spawnAnthropicWorker(true);
    expect(all, "worker 没发出请求：接线断在编排器之前").toContain('"tools"');
    expect(all).toContain("cache_control");
  }, 20_000);

  it("不开 ⇒ 同一 spawn 路径的请求体逐字不含 cache_control（缺省零行为）", async () => {
    const all = await spawnAnthropicWorker(false);
    expect(all).toContain('"tools"');
    expect(all).not.toContain("cache_control");
  }, 20_000);
});
