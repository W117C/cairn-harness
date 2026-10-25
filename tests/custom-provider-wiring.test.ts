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
      // id 不用 "deepseek"：2026-10-25 起它是内置家名（校验拒收同名自定义家）。
      // 端点/env 名照用 DeepSeek 的——自定义家指向别家端点本就是常态。
      id: "mydeepseek",
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
    // deepseek 现在是内置家：不装任何自定义也已知（这是 2026-10-25 升一等的意义）
    expect(isKnownProviderId("deepseek")).toBe(true);
    expect(envKeyOf("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(isKnownProviderId("mydeepseek")).toBe(false);
    install();
    expect(installedCustomProviders().map((p) => p.id)).toEqual(["mydeepseek"]);
    expect(isKnownProviderId("mydeepseek")).toBe(true);
    expect(customProviderById("mydeepseek")?.label).toBe("DeepSeek");
    expect(envKeyOf("mydeepseek")).toBe("DEEPSEEK_API_KEY");
    expect(effectiveModelTable().some((s) => s.id === "mydeepseek-chat")).toBe(true);
    // 内置家一个字都没变（五家：glm/openai/anthropic/gemini + deepseek）
    expect(envKeyOf("openai")).toBe("OPENAI_API_KEY");
    expect(effectiveModelTable().filter((s) => s.provider === "openai").length).toBe(3);
    expect(effectiveModelTable().filter((s) => s.provider === "deepseek").length).toBe(2);
  });

  it("价表：给了完整价的进表；只给一半的整条不进（拿另一样按 0 算就是记成半价）", () => {
    install();
    expect(priceOf("mydeepseek-chat").inputPerMTok).toBe(0.28);
    expect(costUsd("mydeepseek-chat", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.28);
    expect(effectivePriceTable()["mydeepseek-half-priced"]).toBeUndefined();
    expect(() => priceOf("mydeepseek-half-priced")).toThrow(/未知 model 价格/);
    // 用户填的价不打 calibrated：它仍留在「待标定」清单里，不能当省钱证据
    expect(priceOf("mydeepseek-chat").calibrated).toBeUndefined();
  });

  it("卸掉之后一切回到内置行为（零装配 = 零改变；内置 deepseek 两行不受影响）", () => {
    install();
    installCustomProviders([]);
    expect(isKnownProviderId("mydeepseek")).toBe(false);
    expect(envKeyOf("mydeepseek")).toBeNull();
    expect(effectiveModelTable()).toHaveLength(14); // 12（旧四家三档）+ deepseek 内置两行
    expect(() => priceOf("mydeepseek-chat")).toThrow();
    // 内置 deepseek 仍在：档位与价都在（这才是「卸掉自定义 ≠ 卸掉内置」）
    expect(effectiveModelTable().some((s) => s.id === "deepseek-cheap")).toBe(true);
    expect(priceOf("deepseek-cheap").inputPerMTok).toBe(0.3);
  });

  it("未知 provider 仍然 fail-visible（不许因为多了自定义这条路就放宽）", () => {
    install();
    expect(() => providerKindFromEnv("mistral")).toThrow(/未知 M0A_PROVIDER/);
    expect(providerKindFromEnv("deepseek")).toBe("deepseek"); // 现在走内置白名单
    expect(providerKindFromEnv("mydeepseek")).toBe("mydeepseek");
    expect(providerKindFromEnv("demo")).toBe("demo");
  });
});

describe("选择与落盘", () => {
  it("resolveMainModel 走 custom 分支，并交回 providerId", () => {
    install();
    const s = resolveMainModel({ configuredKind: "mydeepseek", settingsModel: "" });
    expect(s.kind).toBe("custom");
    expect(selectionProviderId(s)).toBe("mydeepseek");
    if (s.kind === "demo") throw new Error("不该是 demo");
    expect(s.spec.model).toBe("deepseek-chat");
    expect(s.spec.ctxWindow).toBe(131_072);
    expect(s.modelExplicit).toBe(false);
  });

  it("内置 deepseek 的缺省拨号：无 standard 档 ⇒ 落到第一行（cheap = deepseek-flash）", () => {
    const s = resolveMainModel({ configuredKind: "deepseek", settingsModel: "" });
    expect(s.kind).toBe("deepseek"); // 内置家，不再是 custom 分支
    if (s.kind === "demo" || s.kind === "custom") throw new Error("不该是 demo/custom");
    expect(s.spec.model).toBe("deepseek-flash");
    expect(s.spec.ctxWindow).toBe(1_000_000);
  });

  it("缺 key 时点名要配哪个变量（且不把值带进错误文本）", () => {
    install();
    expect(() => assertProviderKeyConfigured("mydeepseek")).toThrow(/DEEPSEEK_API_KEY/);
    process.env.DEEPSEEK_API_KEY = "sk-test";
    expect(() => assertProviderKeyConfigured("mydeepseek")).not.toThrow();
  });

  it("设置：装上了才允许落盘，没装上的 id 仍被拒（否则用户以为切过去了却在拨 demo）", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "mydeepseek" }).provider).toBe("demo");
    // deepseek 是内置家：不装自定义也允许落盘（白名单来自 PROVIDER_KINDS）
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "deepseek" }).provider).toBe("deepseek");
    install();
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "mydeepseek" }).provider).toBe("mydeepseek");
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

    const spec = effectiveModelTable().find((s) => s.id === "mydeepseek-chat");
    if (spec === undefined) throw new Error("档位表里没有 mydeepseek-chat");
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
