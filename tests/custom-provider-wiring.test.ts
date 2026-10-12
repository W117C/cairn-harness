// S5 接线的判卷：装上一批自定义 provider 之后，**整条链**都要认它 ——
// env 名映射、档位表、价表、provider 校验、设置落盘、以及最要紧的一条：请求真的发去用户填的那个地址。
//
// 为什么「真拨号」这条必须用注入 fetch 测：前面几条都只是查表，查表过了也可能卡在适配器最后 100 米
// （baseURL/key 没递进去）。本仓点名过的「能力发货、入口不通」正是这个形态，所以这里断言到 URL 与请求头。
import { afterEach, describe, expect, it } from "vitest";
import {
  effectiveModelTable,
  installCustomProviders,
  installedCustomProviders,
  isKnownProviderId,
  customProviderById,
} from "../src/providers/registry";
import { envKeyOf } from "../src/providers/env-keys";
import { toWorkerModel } from "../src/providers/registry";
import { effectivePriceTable, priceOf, costUsd } from "../src/routing/pricing";
import { deriveCustomProviders, parseCustomProviders } from "../src/providers/provider-config";
import { providerKindFromEnv, resolveMainModel, selectionProviderId, assertProviderKeyConfigured } from "../src/main/provider-runtime";
import { validateSettings, DEFAULT_SETTINGS } from "../src/main/settings";

const CONFIG = {
  version: 1,
  providers: [
    {
      id: "deepseek",
      label: "DeepSeek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [
        {
          id: "chat",
          model: "deepseek-chat",
          tier: "standard",
          contextWindow: 131_072,
          price: { inputPerMTok: 0.28, outputPerMTok: 0.42 },
        },
        // 这条故意不给价：用来钉「价不齐就不进价表」
        { id: "half-priced", model: "deepseek-half", price: { outputPerMTok: 1 } },
      ],
    },
  ],
};

function install(): void {
  const parsed = parseCustomProviders(CONFIG);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  installCustomProviders(deriveCustomProviders(parsed.file));
}
afterEach(() => {
  installCustomProviders([]); // 模块级状态：每个用例自己收拾干净
  delete process.env.DEEPSEEK_API_KEY;
});

describe("装上之后：映射面全部认它", () => {
  it("provider 已知、env 名可查、档位表与价表都带上它", () => {
    expect(isKnownProviderId("deepseek")).toBe(false);
    install();
    expect(installedCustomProviders().map((p) => p.id)).toEqual(["deepseek"]);
    expect(isKnownProviderId("deepseek")).toBe(true);
    expect(customProviderById("deepseek")?.label).toBe("DeepSeek");
    expect(envKeyOf("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(effectiveModelTable().some((s) => s.id === "deepseek-chat")).toBe(true);
    // 内置四家一个字都没变
    expect(envKeyOf("openai")).toBe("OPENAI_API_KEY");
    expect(effectiveModelTable().filter((s) => s.provider === "openai").length).toBe(3);
  });

  it("价表：给了完整价的进表；只给一半的整条不进（拿另一样按 0 算就是记成半价）", () => {
    install();
    expect(priceOf("deepseek-chat").inputPerMTok).toBe(0.28);
    expect(costUsd("deepseek-chat", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.28);
    expect(effectivePriceTable()["deepseek-half-priced"]).toBeUndefined();
    expect(() => priceOf("deepseek-half-priced")).toThrow(/未知 model 价格/);
    // 用户填的价不打 calibrated：它仍留在「待标定」清单里，不能当省钱证据
    expect(priceOf("deepseek-chat").calibrated).toBeUndefined();
  });

  it("卸掉之后一切回到内置行为（零装配 = 零改变）", () => {
    install();
    installCustomProviders([]);
    expect(isKnownProviderId("deepseek")).toBe(false);
    expect(envKeyOf("deepseek")).toBeNull();
    expect(effectiveModelTable()).toHaveLength(12);
    expect(() => priceOf("deepseek-chat")).toThrow();
  });

  it("未知 provider 仍然 fail-visible（不许因为多了自定义这条路就放宽）", () => {
    install();
    expect(() => providerKindFromEnv("mistral")).toThrow(/未知 M0A_PROVIDER/);
    expect(providerKindFromEnv("deepseek")).toBe("deepseek");
    expect(providerKindFromEnv("demo")).toBe("demo");
  });
});

describe("选择与落盘", () => {
  it("resolveMainModel 走 custom 分支，并交回 providerId", () => {
    install();
    const s = resolveMainModel({ configuredKind: "deepseek", settingsModel: "" });
    expect(s.kind).toBe("custom");
    expect(selectionProviderId(s)).toBe("deepseek");
    if (s.kind === "demo") throw new Error("不该是 demo");
    expect(s.spec.model).toBe("deepseek-chat");
    expect(s.spec.ctxWindow).toBe(131_072);
    expect(s.modelExplicit).toBe(false);
  });

  it("缺 key 时点名要配哪个变量（且不把值带进错误文本）", () => {
    install();
    expect(() => assertProviderKeyConfigured("deepseek")).toThrow(/DEEPSEEK_API_KEY/);
    process.env.DEEPSEEK_API_KEY = "sk-test";
    expect(() => assertProviderKeyConfigured("deepseek")).not.toThrow();
  });

  it("设置：装上了才允许落盘，没装上的 id 仍被拒（否则用户以为切过去了却在拨 demo）", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "deepseek" }).provider).toBe("demo");
    install();
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "deepseek" }).provider).toBe("deepseek");
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "nope" }).provider).toBe("demo");
  });
});

describe("真拨号：请求必须发去用户填的那个地址", () => {
  it("baseURL 与 key 真的递到了适配器（不是查表过了、最后 100 米没接）", async () => {
    install();
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const spec = effectiveModelTable().find((s) => s.id === "deepseek-chat");
    if (spec === undefined) throw new Error("档位表里没有 deepseek-chat");
    const transport = toWorkerModel(spec, { fetchImpl });
    for await (const _event of transport([{ role: "user", content: "hi" }], [], {})) break;

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    const headers = JSON.stringify(calls[0].init.headers);
    expect(headers).toContain("Bearer sk-test");
    const body = JSON.parse(String(calls[0].init.body)) as { model?: string };
    expect(body.model).toBe("deepseek-chat");
    // 用量归因的自述名也要跟着自定义模型走（否则会记到 harness 缺省档上）
    expect(transport.usageName).toBe("deepseek-chat");
  });

  it("anthropic / gemini 协议的自定义家各走自家适配器", () => {
    const parsed = parseCustomProviders({
      version: 1,
      providers: [
        { id: "my-claude", protocol: "anthropic", baseURL: "https://gateway.example.com", apiKeyEnv: "MY_CLAUDE_KEY", models: [{ id: "s", model: "claude-x" }] },
        { id: "my-gemini", protocol: "gemini", baseURL: "https://g.example.com", apiKeyEnv: "MY_GEMINI_KEY", models: [{ id: "p", model: "gemini-x" }] },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    installCustomProviders(deriveCustomProviders(parsed.file));
    const anthropicSpec = effectiveModelTable().find((s) => s.id === "my-claude-s");
    const geminiSpec = effectiveModelTable().find((s) => s.id === "my-gemini-p");
    expect(anthropicSpec?.provider).toBe("my-claude");
    expect(geminiSpec?.provider).toBe("my-gemini");
    // 两条都拿得到传输层（能构造出来就说明 protocol 分支存在且不抛）
    expect(typeof toWorkerModel(anthropicSpec!)).toBe("function");
    expect(typeof toWorkerModel(geminiSpec!)).toBe("function");
    expect(envKeyOf("my-claude")).toBe("MY_CLAUDE_KEY");
    expect(envKeyOf("my-gemini")).toBe("MY_GEMINI_KEY");
  });
});
