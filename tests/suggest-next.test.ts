// 第二十四遍「Tab 想下一条」判卷（业主 22.02 + 今日裁 A②：建议按上下文生成、只按 Tab 出手）。
// 单发器 src/main/suggest-next 的行为契约：
//   ① sanitize：剥壳 → 首行 → 空白折叠 → 句读点截断；空/「无法建议」归 null——确定性、可判卷。
//   ② 真走 toWorkerModel → OpenAI 适配器全链路（fetchImpl 桩 SSE）：增量拼接 → 剥壳后的原文；
//      请求体必须带 system 提示词与对话摘录（user）。
//   ③ 四类失败分说：demo 不拨号 / 缺 key 不碰网络 / 超时 abort 收束 / 网络错带上游原因——fail-visible。
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeSuggestion, suggestNextMessage, SUGGEST_MAX_CHARS } from "../src/main/suggest-next";
import type { MainModelSelection } from "../src/main/provider-runtime";
import type { ModelSpec } from "../src/providers/registry";

const SPEC: ModelSpec = { id: "t-openai-suggest", provider: "openai", model: "gpt-x", tier: "standard", ctxWindow: 128_000 };
const SELECTION: MainModelSelection = { kind: "openai", spec: SPEC, modelExplicit: true };
const EXCERPT = "用户：看看 deepseek 新模型\n助手：要我接着去抓哪一页？";

afterEach(() => { vi.unstubAllEnvs(); });

/** OpenAI 流式 SSE 桩（providers.test.ts 同法）：一次调用现造一条流。 */
function sseFetch(lines: string[]): typeof fetch {
  const encoder = new TextEncoder();
  return (async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + "\n"));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
}

const delta = (text: string): string => `data: ${JSON.stringify({ id: "c1", choices: [{ delta: { content: text } }] })}`;
const STOP = `data: ${JSON.stringify({ id: "c1", choices: [{ delta: {}, finish_reason: "stop" }] })}`;
const DONE = "data: [DONE]";

describe("sanitizeSuggestion（剥壳 → 首行 → 折叠 → 截断；空/拒答归 null）", () => {
  it("剥配对包裹引号（中英引号/反引号/书名号都算），单边不剥", () => {
    expect(sanitizeSuggestion('"接着修测试"')).toBe("接着修测试");
    expect(sanitizeSuggestion("「继续抓定价页」")).toBe("继续抓定价页");
    expect(sanitizeSuggestion("`跑一遍全量`")).toBe("跑一遍全量");
    expect(sanitizeSuggestion("『先看 README』")).toBe("先看 README");
    expect(sanitizeSuggestion('"只剥左边')).toBe('"只剥左边');
  });

  it("取首行 + 行内空白折叠；纯空白归 null", () => {
    expect(sanitizeSuggestion("先跑测试\n然后再提交")).toBe("先跑测试");
    expect(sanitizeSuggestion("  多   空   格  ")).toBe("多 空 格");
    expect(sanitizeSuggestion("   \n  ")).toBeNull();
    expect(sanitizeSuggestion("")).toBeNull();
  });

  it("明确拒答出口「无法建议」（含标点变体）归 null", () => {
    expect(sanitizeSuggestion("无法建议")).toBeNull();
    expect(sanitizeSuggestion("无法建议。")).toBeNull();
    expect(sanitizeSuggestion("无法建议！")).toBeNull();
  });

  it(`超 ${String(SUGGEST_MAX_CHARS)} 字：截到句读点整句；无句读点硬截加省略号`, () => {
    const long = "先" + "测".repeat(70) + "。后面还有一大段不该出现的话"; // 71 字处有 。，落在 80 内
    expect(sanitizeSuggestion(long)).toBe("先" + "测".repeat(70) + "。");
    const noStop = "测".repeat(120);
    const out = sanitizeSuggestion(noStop);
    expect(out).not.toBeNull();
    expect(out!.endsWith("…")).toBe(true);
    expect(out!.length).toBe(SUGGEST_MAX_CHARS + 1); // 80 字 + 省略号
  });
});

describe("suggestNextMessage（真适配器链路 + 失败分说）", () => {
  it("SSE 增量拼接 → 剥壳后的建议原文；请求体带 system 提示词与摘录", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    let seenBody: unknown = null;
    const base = sseFetch([delta('"接着抓'), delta(' Models & Pricing 那页"'), STOP, DONE]);
    const spy: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return await (base as unknown as (u: string | URL, i?: RequestInit) => Promise<Response>)(url, init);
    }) as typeof fetch;
    const r = await suggestNextMessage({ selection: SELECTION, excerpt: EXCERPT, fetchImpl: spy });
    expect(r).toEqual({ ok: true, text: "接着抓 Models & Pricing 那页" });
    const body = seenBody as { messages: { role: string; content: string }[]; model: string };
    expect(body.model).toBe("gpt-x");
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain("无法建议"); // 提示词原样进请求
    expect(body.messages[1]).toEqual({ role: "user", content: EXCERPT });
  });

  it("demo 通道不拨号：fetchImpl 一次都不该被碰", async () => {
    let calls = 0;
    const spy: typeof fetch = (async () => { calls++; return new Response(""); }) as typeof fetch;
    const r = await suggestNextMessage({ selection: { kind: "demo" }, excerpt: EXCERPT, fetchImpl: spy });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("demo");
    expect(calls).toBe(0);
  });

  it("缺 key：分类 no-key，不碰网络", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    let calls = 0;
    const spy: typeof fetch = (async () => { calls++; return new Response(""); }) as typeof fetch;
    const r = await suggestNextMessage({ selection: SELECTION, excerpt: EXCERPT, fetchImpl: spy });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("no-key");
    expect(calls).toBe(0);
  });

  it("超时：abort 收束，分类 timeout", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const hanging: typeof fetch = ((_url: string | URL, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
      })) as typeof fetch;
    const r = await suggestNextMessage({ selection: SELECTION, excerpt: EXCERPT, fetchImpl: hanging, timeoutMs: 30 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("timeout");
  });

  it("网络错：分类 error，message 带上游原因", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const boom: typeof fetch = (async () => { throw new Error("boom"); }) as typeof fetch;
    const r = await suggestNextMessage({ selection: SELECTION, excerpt: EXCERPT, fetchImpl: boom });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("error");
    expect(r.hint).toContain("boom");
  });
});
