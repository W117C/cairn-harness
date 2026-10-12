import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { envKeyOf, ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { DEFAULT_MODEL_TABLE, lookupModel, PROVIDER_IDS as REGISTRY_PROVIDER_IDS } from "../src/providers/registry";
import { PROVIDER_IDS as STORABLE_PROVIDER_IDS } from "../src/main/provider-keys";
import {
  buildProviderInfo,
  providerKeyConfigured,
  providerKindFromEnv,
  resolveMainModel,
} from "../src/main/provider-runtime";
import { DEFAULT_SETTINGS, PROVIDER_KINDS, validateSettings } from "../src/main/settings";

describe("CX-02/CX-03 main provider registry", () => {
  it("uses one four-provider catalog across settings, env mapping, registry, and BYOK storage", () => {
    expect([...PROVIDER_KINDS]).toEqual(["demo", ...REGISTRY_PROVIDER_IDS]);
    expect([...STORABLE_PROVIDER_IDS]).toEqual([...REGISTRY_PROVIDER_IDS]);
    expect([...ENV_KEYED_PROVIDERS]).toEqual([...REGISTRY_PROVIDER_IDS]);
    for (const provider of REGISTRY_PROVIDER_IDS) expect(envKeyOf(provider)).toBe(PROVIDER_ENV_KEYS[provider]);
  });

  it("validates every real settings provider while keeping demo explicit and unknown fail-closed", () => {
    for (const provider of REGISTRY_PROVIDER_IDS) {
      expect(validateSettings({ ...DEFAULT_SETTINGS, provider }).provider).toBe(provider);
    }
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "demo" }).provider).toBe("demo");
    expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "not-a-provider" }).provider).toBe("demo");
    expect(validateSettings({ ...DEFAULT_SETTINGS, model: "gpt-4o" }).model).toBe("gpt-4o");
    expect(validateSettings({ ...DEFAULT_SETTINGS, model: "unregistered-model" }).model).toBe("");
  });

  it("maps env explicitly and rejects unknown provider names instead of falling through", () => {
    expect(providerKindFromEnv(undefined)).toBeUndefined();
    expect(providerKindFromEnv("")).toBeUndefined();
    expect(providerKindFromEnv("mock")).toBe("demo");
    for (const provider of REGISTRY_PROVIDER_IDS) expect(providerKindFromEnv(provider)).toBe(provider);
    expect(() => providerKindFromEnv("typo-provider")).toThrow(/未知 M0A_PROVIDER/);
  });

  it("selects registered defaults, exact per-run model ids, and legacy settings model names", () => {
    expect(resolveMainModel({ configuredKind: "demo", settingsModel: "" })).toEqual({ kind: "demo" });
    expect(resolveMainModel({ configuredKind: "demo", settingsModel: "gpt-4o" })).toEqual({ kind: "demo" });
    expect(resolveMainModel({ forcedKind: "glm", configuredKind: "demo", settingsModel: "" }).kind).toBe("glm");
    expect(resolveMainModel({ configuredKind: "openai", settingsModel: "" }).kind).toBe("openai");
    const glmDefault = resolveMainModel({ configuredKind: "glm", settingsModel: "" });
    if (glmDefault.kind !== "demo") expect(glmDefault.modelExplicit).toBe(false);
    const exact = resolveMainModel({ configuredKind: "glm", requestModel: "anthropic-cheap", settingsModel: "" });
    const legacy = resolveMainModel({ configuredKind: "openai", settingsModel: "gpt-4o" });
    const envLegacy = resolveMainModel({ configuredKind: "glm", settingsModel: "", legacyEnvModel: "glm-5.2" });
    if (exact.kind === "demo" || legacy.kind === "demo" || envLegacy.kind === "demo") throw new Error("expected real provider");
    expect(exact.spec.id).toBe("anthropic-cheap");
    expect(legacy.spec.id).toBe("openai-standard");
    expect(envLegacy.spec.id).toBe("glm-standard");
  });

  it("fails visibly for unknown or mismatched models; forced demo never leaks a stale real model", () => {
    expect(() => resolveMainModel({ configuredKind: "openai", settingsModel: "ghost-model" })).toThrow(/未登记/);
    expect(() => resolveMainModel({ configuredKind: "glm", settingsModel: "gpt-4o" })).toThrow(/不匹配/);
    expect(() => resolveMainModel({ forcedKind: "openai", configuredKind: "openai", settingsModel: "", requestModel: "glm-standard" })).toThrow(/不匹配/);
    expect(resolveMainModel({ forcedKind: "demo", configuredKind: "openai", settingsModel: "gpt-4o" })).toEqual({ kind: "demo" });
  });

  it("自由档位（--model）点名表外模型名：合成 spec，且不落回 demo 也不进档位表", () => {
    const free = resolveMainModel({ forcedKind: "openai", configuredKind: "openai", settingsModel: "", explicitModel: "stealth/space-bunny-alpha" });
    if (free.kind === "demo") throw new Error("expected real provider");
    expect(free.spec.model).toBe("stealth/space-bunny-alpha");
    expect(free.spec.provider).toBe("openai");
    expect(free.modelExplicit).toBe(true);
    // 表外 ⇒ 查不到任何登记行：bandit 与预算折钱因此都拿不到它（前者不路由、后者惰掉并明写）
    expect(lookupModel(DEFAULT_MODEL_TABLE, free.spec.id)).toBeUndefined();
    // 上下文按保守缺省：低估只提前压缩，高估会撞爆
    expect(free.spec.ctxWindow).toBe(Math.min(...DEFAULT_MODEL_TABLE.map((s) => s.ctxWindow)));
    // settings.model 是登记名，--model 是线上名：显式的那个赢
    expect(resolveMainModel({ configuredKind: "openai", settingsModel: "gpt-4o", explicitModel: "x/y" })).toMatchObject({ kind: "openai" });
  });

  it("自由档位点名了却只剩 demo 可选时 fail-visible，不静默收敛成预录剧本", () => {
    expect(() => resolveMainModel({ forcedKind: "demo", configuredKind: "openai", settingsModel: "", explicitModel: "x/y" }))
      .toThrow(/demo/);
  });

  it("--ctx-window 申报的窗口盖过缺省（M-1：缺省对更小的模型是高估 ⇒ 撞远端 400）", () => {
    const base = { forcedKind: "openai" as const, configuredKind: "openai" as const, settingsModel: "", explicitModel: "stealth/small" };
    const declared = resolveMainModel({ ...base, explicitCtxWindow: 32_000 });
    if (declared.kind === "demo") throw new Error("expected real provider");
    expect(declared.spec.ctxWindow, "申报值必须真的落到合成 spec 上").toBe(32_000);
    // 缺省那条不受影响：不给申报时仍是表内最小窗口
    const dflt = resolveMainModel(base);
    if (dflt.kind === "demo") throw new Error("expected real provider");
    expect(dflt.spec.ctxWindow).toBe(Math.min(...DEFAULT_MODEL_TABLE.map((s) => s.ctxWindow)));
  });

  it("接线：合成 spec 上的窗口真被递进 session（否则申报只改到一半，M-2 那一族）", () => {
    /* 这一格**故意留成结构断言**：包住它的是 `createProvider`，没有导出，而真跑一次要一把真 key。
     * 上下两端都另有行为判卷在盯——spec 那一面在上面这条，预算那一面在 tests/session-provider.test.ts
     * 的「自由档位的窗口申报落到预算面」。缺的只是这两端之间那根线，而线断了**只有**这里会红：
     * 上面的 spec 照样带窗口（它只查 resolveMainModel），下面的预算照样认 opts.ctxWindow
     * （它只喂 session），中间没人把前者的值送到后者手上。边界用代码标识，不用注释文字。 */
    const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");
    expect(src, "自由档位的窗口没递进 session ⇒ --ctx-window 只落在 spec 上，预算那一面看不见")
      .toMatch(/\.\.\.\(selection\.modelExplicit \? \{ ctxWindow: selection\.spec\.ctxWindow \} : \{\}\),/);
  });

  it("exposes only registered models with the shared capability map", () => {
    const selection = resolveMainModel({ configuredKind: "anthropic", settingsModel: "claude-haiku-4-5-20251001" });
    const info = buildProviderInfo(selection);
    expect(info).toMatchObject({ kind: "anthropic", modelId: "anthropic-cheap", model: "claude-haiku-4-5-20251001" });
    expect(info.models.map((model) => model.id)).toEqual(DEFAULT_MODEL_TABLE.map((model) => model.id));
    expect(info.models.every((model) => model.capability.provider === model.provider)).toBe(true);
    expect(info.models.every((model) => model.capability.availability === "unverified")).toBe(true);
    expect(info.models.every((model) => !model.capability.thinking.supported)).toBe(true);
    expect(info.models.every((model) => model.capability.attachments.text && !model.capability.attachments.image)).toBe(true);

    const demo = buildProviderInfo({ kind: "demo" });
    // 2026-10-06 契约修正：demo 只表示「没选模型时跑预录剧本」，**不再**表示「没有模型可选」。
    // 旧判据（models: []）正是用户实测里「回对话页选不到刚加的模型」的根因 —— demo 是缺省通道，
    // 它交回空面 ⇒ 模型选择器在全新安装上永远空着，用户在设置里加好的模型也选不上。
    expect(demo).toMatchObject({ kind: "demo", model: "mock-script", keyConfigured: false });
    expect(demo.models.map((model) => model.id)).toEqual(DEFAULT_MODEL_TABLE.map((model) => model.id));
    expect(demo.models.every((model) => model.capability.provider === model.provider)).toBe(true);
  });

  it("reports key presence from the provider-specific env without exposing values", () => {
    expect(providerKeyConfigured("openai", {})).toBe(false);
    expect(providerKeyConfigured("openai", { [PROVIDER_ENV_KEYS.openai]: "secret-value" })).toBe(true);
    expect(providerKeyConfigured("demo", {})).toBe(false);
  });
});
