// GLM 预设的 tool_stream 开关（第三方 OpenAI 兼容中转会**拒收未知字段**：
// 实测 tokenrhythm.studio 回 `{"code":"UNKNOWN_FIELD","field":"tool_stream"}` HTTP 400，
// 于是 provider:check 与所有 worker spawn 第一跳即死）。
// 设计：缺省逐字保持现状（智谱官方要这个字段），只给一个显式关闭位；
// 关闭位只认 0|false|off——拼错不静默当"关"（那会让人以为开关生效而实际还在 400）。
import { afterEach, describe, expect, it } from "vitest";
import { glmToolStreamFlag, streamGlm, GLM_ENDPOINT } from "../src/providers/glm";
import type { GlmMessage } from "../src/providers/glm";
import type { AgentEvent } from "../src/events";

const ENV_KEY = "CAIRN_GLM_TOOL_STREAM";
const saved = process.env[ENV_KEY];
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

/** 捕获外发请求体的 stub fetch（一条 SSE 就收，不联网）。 */
function captureBody(): { body: () => Record<string, unknown>; fetchImpl: typeof fetch } {
  let raw = "";
  const sse = "data: " + JSON.stringify({
    id: "c1", choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }) + "\n\n";
  return {
    body: () => (raw === "" ? {} : JSON.parse(raw) as Record<string, unknown>),
    fetchImpl: (async (_u: unknown, init?: RequestInit) => {
      raw = String(init?.body ?? "");
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch,
  };
}

const msgs: GlmMessage[] = [{ role: "user", content: "hi" }];

async function drain(it: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _e of it) void _e;
}

describe("tool_stream 开关（纯函数面）", () => {
  it("缺省与垃圾值都照旧开（零回归：官方 GLM 要这个字段）", () => {
    expect(glmToolStreamFlag(undefined, {})).toEqual({ tool_stream: true });
    expect(glmToolStreamFlag(true, {})).toEqual({ tool_stream: true });
    expect(glmToolStreamFlag(undefined, { [ENV_KEY]: "nope" })).toEqual({ tool_stream: true });
    expect(glmToolStreamFlag(undefined, { [ENV_KEY]: "1" })).toEqual({ tool_stream: true });
  });

  it("0 / false / off 关掉（大小写与首尾空格容忍），而非流式一律不发", () => {
    for (const v of ["0", "false", "FALSE", " off "]) {
      expect(glmToolStreamFlag(true, { [ENV_KEY]: v })).toBeUndefined();
    }
    expect(glmToolStreamFlag(false, { [ENV_KEY]: "1" })).toBeUndefined();  // 非流式不发（既有行为）
  });
});

describe("tool_stream 开关（外发请求体面）", () => {
  it("缺省：body 里带 tool_stream:true —— 关掉这断言的变异必须红", async () => {
    delete process.env[ENV_KEY];
    const c = captureBody();
    await drain(streamGlm(msgs, { apiKey: "k", endpoint: GLM_ENDPOINT, fetchImpl: c.fetchImpl }));
    expect(c.body()["tool_stream"]).toBe(true);
  });

  it("CAIRN_GLM_TOOL_STREAM=0：body 不再带该字段，其余字段逐字不变", async () => {
    delete process.env[ENV_KEY];
    const withFlag = captureBody();
    await drain(streamGlm(msgs, { apiKey: "k", endpoint: GLM_ENDPOINT, fetchImpl: withFlag.fetchImpl }));
    process.env[ENV_KEY] = "0";
    const without = captureBody();
    await drain(streamGlm(msgs, { apiKey: "k", endpoint: GLM_ENDPOINT, fetchImpl: without.fetchImpl }));
    const a = withFlag.body();
    const b = without.body();
    expect("tool_stream" in b).toBe(false);
    expect({ ...b, tool_stream: true }).toEqual(a);   // 只差这一个键，别的都不许动
    expect(b.model).toBe(a.model);
    expect(b.stream).toBe(true);
  });
});
