// 「检查连接」判卷：三类结果必须可辨（没 key / key 错了 / 服务不提供清单），并且绝不回传 key。
import { describe, expect, it } from "vitest";
import { builtinConnectionTarget, checkProviderConnection } from "../src/main/provider-connection";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SECRET = "sk-test-secret-never-return-this";

describe("builtinConnectionTarget：内置五家端点（环境变量覆盖与适配器同源）", () => {
  it("glm 缺省落到 bigmodel /v4，CAIRN_ENDPOINT 覆盖时去掉 chat/completions 后缀", () => {
    expect(builtinConnectionTarget("glm", {})?.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(builtinConnectionTarget("glm", { CAIRN_ENDPOINT: "https://relay.example.com/v1/chat/completions" })?.baseURL).toBe(
      "https://relay.example.com/v1",
    );
  });

  it("openai/anthropic/gemini 各自协议正确；未知 provider 返回 null", () => {
    expect(builtinConnectionTarget("openai", {})).toEqual({ protocol: "openai", baseURL: "https://api.openai.com/v1" });
    expect(builtinConnectionTarget("anthropic", {})?.protocol).toBe("anthropic");
    expect(builtinConnectionTarget("gemini", {})?.protocol).toBe("gemini");
    expect(builtinConnectionTarget("not-a-provider", {})).toBeNull();
  });

  it("deepseek（2026-10-25 起内置）：openai 协议 + 官方端点；DEEPSEEK_ENDPOINT 覆盖同源", () => {
    expect(builtinConnectionTarget("deepseek", {})).toEqual({ protocol: "openai", baseURL: "https://api.deepseek.com" });
    expect(builtinConnectionTarget("deepseek", { DEEPSEEK_ENDPOINT: "https://ds-relay.example.com/v1/chat/completions" })?.baseURL).toBe(
      "https://ds-relay.example.com/v1",
    );
  });
});

describe("checkProviderConnection：保存成功 ≠ 服务可用", () => {
  it("未知 provider：不瞎猜，指回自定义表单", async () => {
    const r = await checkProviderConnection({ provider: "not-a-provider", env: {} });
    expect(r).toMatchObject({ ok: false, reason: "unknown-provider" });
    if (r.ok) return;
    expect(r.hint).toContain("自定义");
  });

  it("没存 key：no-key，并告诉用户先去哪一步", async () => {
    const r = await checkProviderConnection({ provider: "deepseek", env: {} });
    expect(r).toMatchObject({ ok: false, reason: "no-key" });
    if (r.ok) return;
    expect(r.hint).toContain("保存 key");
  });

  it("401/403：unauthorized（key 被拒），不是笼统的「失败」", async () => {
    const r = await checkProviderConnection({
      provider: "openai",
      env: { OPENAI_API_KEY: SECRET },
      fetchImpl: async () => jsonResponse({ error: "bad key" }, 401),
    });
    expect(r).toMatchObject({ ok: false, reason: "unauthorized", status: 401 });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("404：unsupported（这家没有模型清单接口），文案允许用户继续用", async () => {
    const r = await checkProviderConnection({
      provider: "glm",
      env: { CAIRN_API_KEY: SECRET },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    expect(r).toMatchObject({ ok: false, reason: "unsupported" });
    if (r.ok) return;
    expect(r.hint).toContain("key 已保存");
  });

  it("成功：报出模型数量与示例，请求打到 baseURL 的 /models", async () => {
    let seen = "";
    const r = await checkProviderConnection({
      provider: "openai",
      env: { OPENAI_API_KEY: SECRET },
      fetchImpl: async (input) => {
        seen = String(input);
        return jsonResponse({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
      },
    });
    expect(seen).toBe("https://api.openai.com/v1/models");
    expect(r).toMatchObject({ ok: true, modelCount: 2, sample: ["gpt-4o", "gpt-4o-mini"] });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("网络失败与超时分别归类", async () => {
    const network = await checkProviderConnection({
      provider: "anthropic",
      env: { ANTHROPIC_API_KEY: SECRET },
      fetchImpl: async () => { throw new Error("connect ECONNREFUSED"); },
    });
    expect(network).toMatchObject({ ok: false, reason: "network" });
    const timeout = await checkProviderConnection({
      provider: "anthropic",
      env: { ANTHROPIC_API_KEY: SECRET },
      fetchImpl: async () => { throw new Error("The operation was aborted due to timeout"); },
    });
    expect(timeout).toMatchObject({ ok: false, reason: "timeout" });
  });
});
