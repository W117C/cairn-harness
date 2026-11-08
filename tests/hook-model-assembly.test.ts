// 第 1002 页判卷：钩子的旁路模型调用必须吃**会话装配的那一档**。
// 缺陷来源是第 1001 页自己：prompt 档钩子的 modelCall 接在 `CAIRN_API_KEY` 那道 legacy 门上，
// transport 也自己算了一份 GLM 缺省 ⇒ 用 Anthropic/OpenAI/自定义家的业主，钩子要么被"没注入"拒掉，
// 要么把判定发给一个用户根本没在用的家。这一面钉的就是"旁路 ≠ 第二套取料口"。
import { afterEach, describe, expect, it } from "vitest";
import { hookModelCallFor, sessionModelTransport } from "../src/main/provider-assembly";
import { resolveRunModel } from "../src/main/agent-runner";
import { createHookModelCall } from "../src/agent/session-provider";

const SAVED = ["ANTHROPIC_API_KEY", "CAIRN_API_KEY", "CAIRN_MODEL", "M0A_PROVIDER", "DEEPSEEK_API_KEY"];
const backup: Record<string, string | undefined> = {};
for (const k of SAVED) backup[k] = process.env[k];
afterEach(() => {
  for (const k of SAVED) {
    if (backup[k] === undefined) delete process.env[k];
    else process.env[k] = backup[k];
  }
});

type Captured = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

/** 假拨号：捕请求体，回一段 Anthropic 形状的 SSE（家是谁就发谁的帧形，否则解析器读不出增量）。 */
function fakeFetch(capture: Captured[], text: string): typeof fetch {
  return (async (input: unknown, init?: { method?: string; body?: string | null; headers?: Record<string, string> }) => {
    capture.push({
      url: String(input),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const sse = [
      "event: content_block_delta",
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}`,
      "",
      "event: message_stop",
      "data: {\"type\":\"message_stop\"}",
      "",
      "",
    ].join("\n");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

function anthropicSelection() {
  process.env.ANTHROPIC_API_KEY = "test-key-never-printed";
  delete process.env.CAIRN_API_KEY;
  delete process.env.CAIRN_MODEL;
  return resolveRunModel({ provider: "anthropic", model: "claude-sonnet-5" });
}

describe("旁路模型调用 = 会话那一档，不是第二套取料口", () => {
  it("没有 CAIRN_API_KEY、家是 Anthropic ⇒ 钩子真的拨到 Anthropic，档位是会话那一个", async () => {
    const selection = anthropicSelection();
    const capture: Captured[] = [];
    const call = hookModelCallFor(selection, { fetchImpl: fakeFetch(capture, "可以放行") });
    expect(call, "家配好了却没注入 ⇒ 就是本批修的那道错门").not.toBeNull();
    const res = await call!(
      "判断这次改动是否安全，只回 JSON。",
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "write_file" }),
      30_000,
    );
    expect(res.ok).toBe(true);
    expect(res.text).toContain("可以放行");
    expect(capture.length).toBe(1);
    expect(capture[0].url).toContain("anthropic.com");
    expect(capture[0].body["model"]).toBe("claude-sonnet-5");
  });

  it("同一份 selection ⇒ 主会话那一跳与钩子那一跳打到同一家、同一档", async () => {
    const selection = anthropicSelection();
    const hookCapture: Captured[] = [];
    const mainCapture: Captured[] = [];
    const hook = hookModelCallFor(selection, { fetchImpl: fakeFetch(hookCapture, "x") });
    const main = sessionModelTransport(selection, {}, { fetchImpl: fakeFetch(mainCapture, "y") });
    expect(hook).not.toBeNull();
    await hook!("判", "{}", 30_000);
    for await (const _e of main.transport(
      [{ role: "user", content: "hi" } as never],
      { stream: true },
      undefined,
      undefined,
    )) { /* 只要那一跳真的发出去 */ }
    expect(mainCapture.length).toBeGreaterThan(0);
    // 同一家、同一档：任一漂了都说明旁路自己在猜配置，而不是读装配层给它的东西
    expect(hookCapture[0].url).toBe(mainCapture[0].url);
    expect(String(hookCapture[0].body["model"])).toBe(String(mainCapture[0].body["model"]));
  });

  it("家没配 key ⇒ 返回 null 而不是抛；不绑定就是「没这条能力」，主流程不受影响", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CAIRN_API_KEY;
    const selection = resolveRunModel({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(() => hookModelCallFor(selection, { fetchImpl: fakeFetch([], "x") })).not.toThrow();
    expect(hookModelCallFor(selection, { fetchImpl: fakeFetch([], "x") })).toBeNull();
  });

  it("createHookModelCall 不再自己编档位名：送给 transport 的 options 里没有 model", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const transport = async function* (_m: readonly unknown[], options: unknown): AsyncGenerator<unknown> {
      seen.push(options as Record<string, unknown> | undefined);
      yield { type: "assistant_delta", text: "结论：可以" };
    };
    const call = createHookModelCall(transport as never, undefined, "TEST");
    const res = await call("判一下", "{}", 5000);
    expect(res.ok).toBe(true);
    expect(seen[0]?.model, "档位由装配层定，钩子层不许再猜一遍（第 912 页同一课）").toBeUndefined();
  });
});
