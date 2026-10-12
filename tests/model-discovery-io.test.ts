// 探测 IO 壳的判卷：端点拼法、鉴权头、只许 https、禁重定向、短超时、失败要有原因。
// 这一层不测「上游返回什么形状」（那是 providers/discovery.ts 的纯解析面），只测**请求怎么发出去**。
import { describe, expect, it, vi } from "vitest";
import { authHeaderFor, discoverModels, modelsEndpointFor } from "../src/main/model-discovery";

const OK_BODY = { object: "list", data: [{ id: "deepseek-chat", object: "model", context_window: 131072 }] };
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

describe("端点与鉴权头：必须与适配器真拨的地址同源", () => {
  it("三种协议各自的模型清单端点", () => {
    expect(modelsEndpointFor("openai", "https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1/models");
    expect(modelsEndpointFor("openai", "https://api.deepseek.com/v1/")).toBe("https://api.deepseek.com/v1/models");
    expect(modelsEndpointFor("anthropic", "https://gateway.example.com")).toBe("https://gateway.example.com/v1/models");
    expect(modelsEndpointFor("gemini", "https://generativelanguage.googleapis.com")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    );
  });

  it("鉴权头逐字对齐适配器（openai: Bearer / anthropic: x-api-key / gemini: x-goog-api-key）", () => {
    expect(authHeaderFor("openai", "k")).toEqual({ Authorization: "Bearer k" });
    expect(authHeaderFor("anthropic", "k")).toEqual({ "x-api-key": "k", "anthropic-version": "2023-06-01" });
    expect(authHeaderFor("gemini", "k")).toEqual({ "x-goog-api-key": "k" });
  });
});

describe("安全线：https-only 与「不跟随重定向」", () => {
  it("http 非本地 ⇒ 拒（不发请求）", async () => {
    const fetchImpl = vi.fn();
    const r = await discoverModels({ baseURL: "http://api.example.com/v1", protocol: "openai", keyEnv: "K", fetchImpl, env: { K: "sk" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insecure-endpoint");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("http + localhost 且显式放行 ⇒ 放行（本地模型是合法场景）", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ object: "list", data: [{ id: "qwen3" }] }));
    const r = await discoverModels({
      baseURL: "http://127.0.0.1:11434/v1",
      protocol: "openai",
      keyEnv: "K",
      allowLocalEndpoint: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { K: "sk" },
    });
    expect(r.ok).toBe(true);
  });

  it("http + localhost 但没放行 ⇒ 拒", async () => {
    const r = await discoverModels({ baseURL: "http://localhost:11434/v1", protocol: "openai", keyEnv: "K", env: { K: "sk" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insecure-endpoint");
  });

  it("上游回 3xx ⇒ 当失败，并把「为什么不能跟随」写进消息", async () => {
    const r = await discoverModels({
      baseURL: "https://g.example.com",
      protocol: "openai",
      keyEnv: "K",
      fetchImpl: (async () => jsonResponse("", 302, { location: "https://evil.example.com/models" })) as unknown as typeof fetch,
      env: { K: "sk" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("redirect");
      expect(r.message).toContain("重定向");
    }
  });
});

describe("缺 key：明确报哪条命令配哪个变量，而不是发一个裸请求", () => {
  it("没给 keyEnv ⇒ 直接说清探测必须带鉴权", async () => {
    const fetchImpl = vi.fn();
    const r = await discoverModels({ baseURL: "https://api.deepseek.com/v1", protocol: "openai", fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("给了 keyEnv 但环境里是空 ⇒ 给出 export 命令，且不回显任何值", async () => {
    const r = await discoverModels({ baseURL: "https://api.deepseek.com/v1", protocol: "openai", keyEnv: "DEEPSEEK_API_KEY", env: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no-key");
      expect(r.message).toContain("export DEEPSEEK_API_KEY=");
    }
  });
});

describe("发出去的请求：地址、方法、鉴权头、不跟随重定向", () => {
  it("成功的路径把上游清单解析出来", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return jsonResponse(OK_BODY);
    }) as unknown as typeof fetch;
    const r = await discoverModels({
      baseURL: "https://api.deepseek.com/v1",
      protocol: "openai",
      keyEnv: "DEEPSEEK_API_KEY",
      fetchImpl,
      env: { DEEPSEEK_API_KEY: "sk-secret" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models[0].contextWindow).toBe(131072);
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/models");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("manual");
    expect(JSON.stringify(calls[0].init.headers)).toContain("Bearer sk-secret");
  });

  it("超时与网络错误分开归因（一个说超时，一个说请求失败）", async () => {
    const abortErr = new Error("The operation was aborted due to timeout");
    const r1 = await discoverModels({
      baseURL: "https://g.example.com",
      protocol: "openai",
      keyEnv: "K",
      fetchImpl: (async () => {
        throw abortErr;
      }) as unknown as typeof fetch,
      env: { K: "sk" },
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("timeout");
  });

  it("上游回 500 ⇒ http；回一坨 HTML ⇒ shape（都不当成空清单）", async () => {
    const base = { baseURL: "https://g.example.com", protocol: "openai" as const, keyEnv: "K", env: { K: "sk" } };
    const r1 = await discoverModels({ ...base, fetchImpl: (async () => jsonResponse({}, 500)) as unknown as typeof fetch });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("http");
    const r2 = await discoverModels({ ...base, fetchImpl: (async () => jsonResponse("<html>hello</html>")) as unknown as typeof fetch });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("shape");
  });
});
