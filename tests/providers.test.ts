import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeAssistantDeltas, type AgentEvent, type AssistantDeltaEvent, type ToolCallEvent, type UsageEvent } from "../src/events";
import type { ProviderMessage, ProviderToolSpec } from "../src/providers";
import { chatCompletionsEndpoint, streamOpenAI } from "../src/providers/openai";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";
import {
  DEFAULT_MODEL_TABLE,
  PROVIDER_IDS,
  lookupModel,
  findSpecByNameOrId,
  resolveModel,
  specsByTier,
  toWorkerModel,
} from "../src/providers/registry";
import { ENV_KEYED_PROVIDERS, envKeyOf } from "../src/providers/env-keys";
import { assertProviderKeyConfigured, providerKeyConfigured } from "../src/main/provider-runtime";
import { byokGapsOf, sameSet } from "../src/providers/byok";

const ROOT = join(import.meta.dirname, "..");
const FIX = (p: string) => join(ROOT, "fixtures", "providers", p);
const SPEC: ProviderToolSpec = {
  name: "read_file",
  description: "读取",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};
const USER: ProviderMessage[] = [{ role: "user", content: "hi" }];

async function loadLines(rel: string): Promise<string[]> {
  const raw = await readFile(FIX(rel), "utf8");
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

function stubFetch(lines: string[]): typeof fetch {
  const encoder = new TextEncoder();
  // 每次调用现造一条流与一个 Response：Response.body 是一次性的，
  // 复用同一个实例在重试路径上会抛 "body object should not be disturbed or locked"。
  return (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + "\n"));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function deltasOf(events: AgentEvent[]): AssistantDeltaEvent[] {
  return events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
}
function callsOf(events: AgentEvent[]): ToolCallEvent[] {
  return events.filter((e): e is ToolCallEvent => e.type === "tool_call");
}
function usageOf(events: AgentEvent[]): UsageEvent | undefined {
  return events.find((e): e is UsageEvent => e.type === "usage");
}

describe.each([
  { key: "openai", dir: "openai", stream: streamOpenAI },
  { key: "anthropic", dir: "anthropic", stream: streamAnthropic },
  { key: "gemini", dir: "gemini", stream: streamGemini },
])("$key 适配器 fixture 回放（任务2/3/4/5 验收）", ({ dir, stream }) => {
  it("①文本流：fixture 回放产出「你好，世界」+ usage > 0（测试直接消费各家原始字段）", async () => {
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "text-stream.sse"))) }, [SPEC]));
    expect(mergeAssistantDeltas(deltasOf(events))).toBe("你好，世界");
    const usage = usageOf(events);
    expect(usage).toBeDefined();
    expect(usage!.inputTokens).toBe(11);
    expect(usage!.outputTokens).toBe(7);
  });

  it("②工具调用：fixture 回放产出两条 read_file，参数为完整 JSON（分片拼接/并行调用）", async () => {
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "tool-call.sse"))) }, [SPEC]));
    expect(callsOf(events)).toEqual([
      { type: "tool_call", id: expect.any(String), name: "read_file", args: { path: "a.ts" } },
      { type: "tool_call", id: expect.any(String), name: "read_file", args: { path: "b.ts" } },
    ]);
  });

  it("③错误事件：fixture 回放抛可读错误", async () => {
    await expect(async () => {
      await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "error.sse"))) }, [SPEC]));
    }).rejects.toThrow(/流错误/);
  });

  it("④未知事件：fixture 回放优雅跳过不抛错，正常文本继续", async () => {
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(dir, "unknown.sse"))) }, [SPEC]));
    expect(mergeAssistantDeltas(deltasOf(events))).toBe("你好，世界");
  });

  // 审查 S1-6（修复任务书 1.6）：C7 的逐行容错只对「不是帧的行」成立。以 { 开头的真帧被
  // 上游截断时旧实现静默 continue —— 流随后正常收尾，本轮会以「少一截正文 / 少一个
  // tool_call」的残缺输出被 loop 当成成功收束（同文件 parseArgs 的 fail-loud 口径相反）。
  it("⑤真帧截断（以 { 开头的坏 JSON）必须抛出，不静默丢字", async () => {
    const base = await loadLines(join(dir, "text-stream.sse"));
    const broken = [...base.slice(0, 1), 'data: {"choices":[{"delta":{"content":"截断', ...base.slice(1)];
    await expect(async () => {
      await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(broken) }, [SPEC]));
    }).rejects.toThrow(/SSE \u5e27\u635f\u574f/);
  });

  it("⑥非 JSON 心跳/注释行仍容忍（C7 原始意图不回退）", async () => {
    const base = await loadLines(join(dir, "text-stream.sse"));
    const withNoise = [...base.slice(0, 1), "data: ping", ": keep-alive", ...base.slice(1)];
    const events = await collect(stream(USER, { apiKey: "test", fetchImpl: stubFetch(withNoise) }, [SPEC]));
    expect(mergeAssistantDeltas(deltasOf(events))).toBe("你好，世界");
  });
});

describe("OpenAI 兼容网关的 baseURL 归一", () => {
  it("给到 /v1 一层的 base 会补 /chat/completions（README 那条 recipe 原本照抄必然 404）", () => {
    expect(chatCompletionsEndpoint("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(chatCompletionsEndpoint("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("已经带全的 endpoint 原样用（GLM_ENDPOINT 那种写法零破坏），尾斜杠不产生双斜杠", () => {
    expect(chatCompletionsEndpoint("https://open.bigmodel.cn/api/paas/v4/chat/completions"))
      .toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(chatCompletionsEndpoint("https://api.deepseek.com/v1/")).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("拨号用的就是归一后的地址：base 写法打到补全后的路径上", async () => {
    let seen = "";
    const stubFetch = async (url: string): Promise<Response> => {
      seen = String(url);
      return new Response("data: [DONE]\n\n", { status: 200 });
    };
    await collect(streamOpenAI(USER, { apiKey: "test", baseURL: "https://example.test/v1", fetchImpl: stubFetch as unknown as typeof fetch }, [SPEC]));
    expect(seen).toBe("https://example.test/v1/chat/completions");
  });
});

describe("anthropic 协议细节（任务3 验收）", () => {
  it("message_delta 的 usage 是累计值：多次出现不重复累加", async () => {
    const base = await loadLines("anthropic/text-stream.sse");
    const withTwoDeltas = [
      ...base.slice(0, base.findIndex((l) => l.includes("message_delta"))),
      'data: {"type":"message_delta","delta":{"stop_reason":null},"usage":{"input_tokens":11,"output_tokens":3}}',
      base[base.findIndex((l) => l.includes("message_delta"))],
      ...base.slice(base.findIndex((l) => l.includes("message_delta")) + 1),
    ];
    const events = await collect(streamAnthropic(USER, { apiKey: "test", fetchImpl: stubFetch(withTwoDeltas) }));
    expect(usageOf(events)).toEqual({ type: "usage", inputTokens: 11, outputTokens: 7 }); // 取最后累计值，不 3+7
  });

  it("input_json_delta 分片拼接：逐片累积后解析完整 JSON（不取首片）", async () => {
    const events = await collect(streamAnthropic(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines("anthropic/tool-call.sse")) }));
    expect(callsOf(events)[0].args).toEqual({ path: "a.ts" }); // '{"pa' + 'th":"a.ts"}' 两片拼接
  });

  it("key 缺失直接报错（不静默降级）", async () => {
    await expect(async () => {
      for await (const _e of streamAnthropic(USER, { apiKey: "" })) void _e;
    }).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("gemini 协议细节（任务4 验收）", () => {
  it("一个 chunk 多个并行 functionCall 全部解析（fixture 已含 2 个；再构造 3 个）", async () => {
    const lines = [
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"t1","args":{"a":1}}},{"functionCall":{"name":"t2","args":{"b":2}}},{"functionCall":{"name":"t3"}}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":9,"thoughtsTokenCount":2,"totalTokenCount":16}}',
    ];
    const events = await collect(streamGemini(USER, { apiKey: "test", fetchImpl: stubFetch(lines) }));
    expect(callsOf(events).map((c) => c.name)).toEqual(["t1", "t2", "t3"]);
    expect(callsOf(events)[0].args).toEqual({ a: 1 });
    // thoughtsTokenCount 计入 outputTokens（candidatesTokenCount + thoughtsTokenCount）
    expect(usageOf(events)).toEqual({ type: "usage", inputTokens: 5, outputTokens: 11 });
  });

  it("functionResponse 回传格式正确（name 从配对 tool_call 反查，response 为对象）", async () => {
    const { toGeminiBody } = await import("../src/providers/gemini");
    const body = toGeminiBody([
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" },
    ]);
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "read_file", response: { ok: true } } }] },
    ]);
  });

  it("key 缺失直接报错（不静默降级）", async () => {
    await expect(async () => {
      for await (const _e of streamGemini(USER, { apiKey: "" })) void _e;
    }).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe("跨 provider 契约（任务6：同一逻辑对话三家等价）", () => {
  it("三家文本逐字相同 + tool_call 名与参数相同 + usage 均 > 0", async () => {
    const turns = await Promise.all(
      [
        { dir: "openai", stream: streamOpenAI },
        { dir: "anthropic", stream: streamAnthropic },
        { dir: "gemini", stream: streamGemini },
      ].map(async (a) => {
        const events = await collect(
          a.stream(USER, { apiKey: "test", fetchImpl: stubFetch(await loadLines(join(a.dir, "tool-call.sse"))) }, [SPEC]),
        );
        return {
          text: mergeAssistantDeltas(deltasOf(events)),
          calls: callsOf(events).map((c) => ({ name: c.name, args: c.args })),
          usage: usageOf(events),
        };
      }),
    );
    const texts = new Set(turns.map((t) => t.text));
    expect(texts.size).toBe(1); // anthropic tool-call fixture 无文本 → 三家同为空串
    const serialized = turns.map((t) => JSON.stringify(t.calls));
    expect(new Set(serialized).size).toBe(1);
    expect(turns[0].calls).toEqual([
      { name: "read_file", args: { path: "a.ts" } },
      { name: "read_file", args: { path: "b.ts" } },
    ]);
    for (const t of turns) {
      expect(t.usage && t.usage.inputTokens > 0 && t.usage.outputTokens > 0).toBe(true);
    }
  });
});

describe("M5b/M6 provider 档位表", () => {
  it("M6 白名单：PROVIDER_IDS = glm/openai/anthropic/gemini 四家（§4.3 预留面开闸）", () => {
    expect(PROVIDER_IDS).toEqual(["glm", "openai", "anthropic", "gemini"]);
  });

  it("档位表 spec 解析往返：四家 × 三档齐备、字段完整、id 唯一", () => {
    const tiers = new Set(DEFAULT_MODEL_TABLE.map((s) => s.tier));
    expect(tiers).toEqual(new Set(["cheap", "standard", "strong"]));
    const providers = new Set(DEFAULT_MODEL_TABLE.map((s) => s.provider));
    expect(providers).toEqual(new Set(["glm", "openai", "anthropic", "gemini"]));
    const ids = new Set(DEFAULT_MODEL_TABLE.map((s) => s.id));
    expect(ids.size).toBe(DEFAULT_MODEL_TABLE.length); // id 唯一
    for (const s of DEFAULT_MODEL_TABLE) {
      expect(typeof s.model).toBe("string");
      expect(s.ctxWindow).toBeGreaterThan(0);
      expect(lookupModel(DEFAULT_MODEL_TABLE, s.id)).toBe(s); // 往返一致
    }
  });

  it("未知 id fail-visible 报错，不静默回落", () => {
    expect(() => resolveModel(DEFAULT_MODEL_TABLE, "glm-nonexistent")).toThrow(/未知 model id/);
    expect(lookupModel(DEFAULT_MODEL_TABLE, "glm-nonexistent")).toBeUndefined();
  });

  it("specsByTier 按档位分组（每档 4 家）", () => {
    for (const t of ["cheap", "standard", "strong"] as const) {
      expect(specsByTier(DEFAULT_MODEL_TABLE, t).length).toBe(4);
    }
  });

  it("toWorkerModel 构造不拨号；glm 无 key 时调用才失败（fail-closed）", async () => {
    const wm = toWorkerModel(resolveModel(DEFAULT_MODEL_TABLE, "glm-standard"));
    // 构造本身零副作用：不会因为缺少 M0_API_KEY 而抛
    expect(typeof wm).toBe("function");
    // 调用（消费流）时缺 key → 同步抛错（streamOpenAI 在 fetch 前校验 key），不静默降级
    await expect(async () => {
      for await (const _e of wm(USER, [])) void _e;
    }).rejects.toThrow(/M0_API_KEY/);
  });

  it("toWorkerModel 按 provider 路由：anthropic 格式 SSE 只被 anthropic 适配器消化（路由判别）", async () => {
    // 环境变量按 provider 注入（缺 key 同步抛错，路由面先于 key 面）
    const oldA = process.env.ANTHROPIC_API_KEY;
    const oldG = process.env.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.GEMINI_API_KEY = "test";
    try {
      const lines = await loadLines("anthropic/text-stream.sse");
      const wmA = toWorkerModel(resolveModel(DEFAULT_MODEL_TABLE, "anthropic-cheap"), { fetchImpl: stubFetch(lines) });
      const evA = await collect(wmA(USER, []));
      expect(mergeAssistantDeltas(deltasOf(evA))).toBe("你好，世界"); // anthropic 格式被正确消化 → 路由到 anthropic
      // 同格式喂 gemini 适配器 → 不产出同一文本（证明路由不是恒真；适配器对陌生事件优雅跳过）
      const wmG = toWorkerModel(resolveModel(DEFAULT_MODEL_TABLE, "gemini-cheap"), { fetchImpl: stubFetch(lines) });
      const evG = await collect(wmG(USER, []));
      expect(mergeAssistantDeltas(deltasOf(evG))).not.toBe("你好，世界");
    } finally {
      if (oldA === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = oldA;
      if (oldG === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = oldG;
    }
  });
});

/* 预算侧的模型解析（双态 + 保守）：路由用 resolveModel（未知即抛），预算用 findSpecByNameOrId
   （查不到就走缺省帽），两者用途不同故行为不同。 */
describe("findSpecByNameOrId（档位 id 与 provider 模型名双态，重复取最小窗口）", () => {
  it("id 与 model 名都认；未知 / 空 → undefined", () => {
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "glm-strong")?.ctxWindow).toBe(256_000);
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "glm-5.2-pro")?.ctxWindow).toBe(256_000);
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "gpt-4o")?.id).toBe("openai-standard");
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "no-such-model")).toBeUndefined();
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "")).toBeUndefined();
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, undefined)).toBeUndefined();
  });
  it("同名多条 → 取 ctxWindow 最小者（表内重复绝不放大预算）", () => {
    const dup = [
      { id: "big", provider: "glm", model: "shared", tier: "strong" as const, ctxWindow: 1_000_000 },
      { id: "small", provider: "glm", model: "shared", tier: "cheap" as const, ctxWindow: 8_000 },
    ];
    expect(findSpecByNameOrId(dup, "shared")?.id).toBe("small");
  });
});

/* BYOK 可达性对账（providers-check ⑦⑧ 的纯函数一侧）。判据的位置写在**缺口格子**上：
   每破坏一支取料面，只有对应那一格非空——四格各测一次，才不会某支静默失效而整段仍绿。 */
describe("BYOK 可达性（env 名映射 + byokGapsOf 逐格）", () => {
  const cleanFacts = {
    routable: ["glm", "openai", "anthropic", "gemini"],
    storable: ["glm", "openai", "anthropic", "gemini"],
    envKeyed: ENV_KEYED_PROVIDERS,
    injected: ENV_KEYED_PROVIDERS,
    offered: ["demo", "glm", "openai", "anthropic", "gemini"],
  };

  it("env 名映射恰好覆盖路由白名单（两张表各抄一份迟早漂）", () => {
    for (const p of PROVIDER_IDS) expect(envKeyOf(p)).toBeTruthy();
    expect(envKeyOf("no-such-provider")).toBeNull();
    expect([...ENV_KEYED_PROVIDERS].sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("四家 key 存储/注入/settings 均接通 ⇒ 四格全空", () => {
    const g = byokGapsOf(cleanFacts);
    expect(g.routableWithoutEnvKey).toEqual([]);
    expect(g.storableNotInjected).toEqual([]);
    expect(g.offeredNotStorable).toEqual([]);
    expect(g.routableNotStorable).toEqual([]);
  });

  it("逐格破坏：每支取料面失效只点亮它自己那一格", () => {
    // 路由开了一家但没有 env 名映射
    expect(byokGapsOf({ ...cleanFacts, routable: [...cleanFacts.routable, "mistral"] }).routableWithoutEnvKey).toEqual(["mistral"]);
    // 存进 key 了，注入面漏它（白名单扩到 anthropic 而注入面仍只跑 glm 就是这个形态）
    expect(byokGapsOf({ ...cleanFacts, storable: ["glm", "anthropic"], injected: ["glm"] }).storableNotInjected).toEqual(["anthropic"]);
    // 当前白名单四家时，注入面只写 glm 会点名其余三家。
    expect(byokGapsOf({ ...cleanFacts, injected: ["glm"] }).storableNotInjected).toEqual(["openai", "anthropic", "gemini"]);
    // 注入面返回乱序/含重复 ⇒ sameSet 必须认（否则扩家顺序一变就假红）
    expect(sameSet(["b", "a", "a"], ["a", "b"])).toBe(true);
    expect(sameSet(["a"], ["a", "b"])).toBe(false);
    // UI 给了 openai 但存储白名单不收
    expect(byokGapsOf({ ...cleanFacts, storable: ["glm"], offered: ["demo", "glm", "openai"] }).offeredNotStorable).toEqual(["openai"]);
    // demo 是冻结剧本通道、不需要 key，故不占 offeredNotStorable
    expect(byokGapsOf({ ...cleanFacts, offered: ["demo"] }).offeredNotStorable).toEqual([]);
  });
});

// 第 320 页：`assertProviderKeyConfigured` 此前**全仓零测试引用**，而它是真实通道唯一的
// "缺凭据就停"闸门——那句「不会静默回落其他 provider/demo」是这个动作对模型/操作者的说明。
// 三格各钉一次：缺 key 抛并点名变量名、有 key 放行（反向：不许一律拒）、抛出的文本里只有名没有值。
describe("缺凭据时 fail-closed：点名要配哪一个环境变量，且不把 key 值带进错误文本", () => {
  it("每一家 env-keyed provider 缺 key 都抛，报错里有 env 变量名与「不会静默回落其他」", () => {
    for (const kind of ENV_KEYED_PROVIDERS) {
      const name = envKeyOf(kind);
      expect(name, `${kind} 该有 env 名映射`).toBeTruthy();
      let message = "";
      try {
        assertProviderKeyConfigured(kind, {});
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, kind + " 缺 key 必须抛（静默换一家＝用户以为在跑 A 实际在跑 B）").toContain(name!);
      expect(message).toContain("不会静默回落其他");
    }
  });

  it("反向：key 在场就放行——只有全空/纯空白算缺（一律拒会把这条闸变成装饰）", () => {
    for (const kind of ENV_KEYED_PROVIDERS) {
      const name = envKeyOf(kind)!;
      expect(() => assertProviderKeyConfigured(kind, { [name]: "sk-real-looking-value" })).not.toThrow();
      expect(providerKeyConfigured(kind, { [name]: "   " }), `${kind} 的空白串不能当已配置`).toBe(false);
      expect(() => assertProviderKeyConfigured(kind, { [name]: "   " })).toThrow();
    }
  });

  it("抛出的那句里只有变量名，没有另一家的 key 值（错误文本会进日志、也会给模型看）", () => {
    const [first, second] = ENV_KEYED_PROVIDERS;
    const secret = "sk-DO-NOT-LEAK-1234567890";
    const env: Record<string, string> = { [envKeyOf(first) as string]: secret };
    let message = "";
    try {
      assertProviderKeyConfigured(second, env as NodeJS.ProcessEnv);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(envKeyOf(second));
    expect(message, "报错文本里出现任何一家的 key 值就是泄漏").not.toContain(secret);
  });
});


/* 流内 5xx 的重试（2026-09-30 实测动因）。
 *
 * 现象：OpenRouter 把上游失败**塞进 SSE 体**（HTTP 200 + 一帧 `{"error":{"type":"502",…}}`），
 * 而 `establishStream` 只覆盖「响应体尚未被消费」那一段 ⇒ 这种错误直接打死整轮任务。
 * 实测代价：连续 7 次真模型跑，全部在第 3~9 轮挂在这个 502 上（简单请求 200，多轮工具调用必挂）。
 *
 * 安全边界（本组要钉的核心）：**只有在本次尝试一个输出都没吐出去时**才允许重放。
 * 吐过 delta/tool_call 再重放会把同一轮内容吐两遍——那比失败更糟（模型看到重复内容），
 * 建连段那条不变量（openai.ts 里写着「绝不重放」）正是为这个立的。
 */
describe("streamOpenAI：流内失败的重试边界", () => {
  const enc = new TextEncoder();
  // 每次调用都要**新造**一个 Response：Response 的 body 是一次性的（读过即 locked），
  // 重试路径上复用同一个实例会拿到 "body object should not be disturbed or locked"
  // —— 那条错会盖住真正要验的重试语义。
  const sse = (frames: string[]): Response =>
    new Response(new ReadableStream<Uint8Array>({
      start(c) { for (const f of frames) c.enqueue(enc.encode(f + "\n")); c.close(); },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const delta = (text: string): string => "data: " + JSON.stringify({ choices: [{ delta: { content: text } }] });
  const errFrame = (type: string, msg: string): string => "data: " + JSON.stringify({ error: { type, message: msg } });
  const DONE = "data: [DONE]";

  it("首帧就是流内 502（一个输出都没吐）⇒ 重试一次并把这一轮正常跑完", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1
        ? sse([errFrame("502", "Provider returned an empty response")])
        : sse([delta("ok"), DONE]);
    }) as unknown as typeof fetch;
    const events = await collect(streamOpenAI(USER, { apiKey: "test", baseURL: "https://x.test/v1", fetchImpl }, [SPEC]));
    expect(calls).toBe(2); // 真的重试了
    expect(mergeAssistantDeltas(deltasOf(events))).toBe("ok"); // 且拿到的是第二次的内容
  });

  it("★ 反向哨兵：已经吐过 delta 之后再失败 ⇒ **不许重放**（重放会把同一轮吐两遍）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      // 第一次：先吐半句正文，再报 502 —— 这时已经有输出出去了
      return sse([delta("半"), errFrame("502", "boom")]);
    }) as unknown as typeof fetch;
    await expect(collect(streamOpenAI(USER, { apiKey: "test", baseURL: "https://x.test/v1", fetchImpl }, [SPEC])))
      .rejects.toThrow(/流错误 502/);
    expect(calls).toBe(1); // 一次就够：没有重放
  });

  it("非 5xx 的流内错误不重试（协议级异常重放只会再错一次并白烧预算）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sse([errFrame("invalid_request_error", "bad tool schema")]);
    }) as unknown as typeof fetch;
    await expect(collect(streamOpenAI(USER, { apiKey: "test", baseURL: "https://x.test/v1", fetchImpl }, [SPEC])))
      .rejects.toThrow(/流错误/);
    expect(calls).toBe(1);
  });

  it("重试次数有上限：连续失败不会无限打转", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return sse([errFrame("502", "always down")]);
    }) as unknown as typeof fetch;
    await expect(collect(streamOpenAI(USER, { apiKey: "test", baseURL: "https://x.test/v1", fetchImpl }, [SPEC])))
      .rejects.toThrow(/流错误 502/);
    expect(calls).toBeGreaterThan(1); // 确实重试过
    expect(calls).toBeLessThanOrEqual(3); // 但没有无限重试
  });
});
