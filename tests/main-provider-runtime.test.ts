import { describe, expect, it } from "vitest";
import { envKeyOf, ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { DEFAULT_MODEL_TABLE, PROVIDER_IDS as REGISTRY_PROVIDER_IDS } from "../src/providers/registry";
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
    expect(demo).toMatchObject({ kind: "demo", model: "mock-script", models: [], keyConfigured: false });
  });

  it("reports key presence from the provider-specific env without exposing values", () => {
    expect(providerKeyConfigured("openai", {})).toBe(false);
    expect(providerKeyConfigured("openai", { [PROVIDER_ENV_KEYS.openai]: "secret-value" })).toBe(true);
    expect(providerKeyConfigured("demo", {})).toBe(false);
  });
});
