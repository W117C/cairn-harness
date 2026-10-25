import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { envKeyOf, ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { DEFAULT_MODEL_TABLE, lookupModel, PROVIDER_IDS as REGISTRY_PROVIDER_IDS } from "../src/providers/registry";
import { PROVIDER_IDS as STORABLE_PROVIDER_IDS } from "../src/main/provider-keys";
import {
  buildProviderInfo,
  preferCheapSelection,
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
    /* 这一格**故意留成结构断言**：包住它的是 `createProvider`（2026-10-17 起从
     * `./provider-assembly.ts` 导出），而真跑一次要一把真 key。
     * 上下两端都另有行为判卷在盯——spec 那一面在上面这条，预算那一面在 tests/session-provider.test.ts
     * 的「自由档位的窗口申报落到预算面」。缺的只是这两端之间那根线，而线断了**只有**这里会红：
     * 上面的 spec 照样带窗口（它只查 resolveMainModel），下面的预算照样认 opts.ctxWindow
     * （它只喂 session），中间没人把前者的值送到后者手上。边界用代码标识，不用注释文字。 */
    // 并料读两份：函数随 provider 装配面搬走了，尺量的是「这根线在不在」，不是「必须写在哪个文件里」
    // （同 `usage-attribution.test.ts` / `orchestrator-hold.test.ts` 的 ORCH_SRC_ALL 先例）。
    const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8")
      + readFileSync(fileURLToPath(new URL("../src/main/provider-assembly.ts", import.meta.url)), "utf8");
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
    // DeepSeek 两行带官方文档自述的档位/模态证据（2026-10-25），是 thinking/识图开门的唯一
    // 内置例外；其余行照旧「无证据不开门」。
    const ds = info.models.filter((m) => m.provider === "deepseek");
    expect(ds.every((m) => m.capability.thinking.supported)).toBe(true);
    expect(ds.find((m) => m.id === "deepseek-cheap")?.capability.attachments.image).toBe(true);
    const rest = info.models.filter((m) => m.provider !== "deepseek");
    expect(rest.every((model) => !model.capability.thinking.supported)).toBe(true);
    expect(rest.every((model) => model.capability.attachments.text && !model.capability.attachments.image)).toBe(true);

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

// 自进化「便宜档偏置」（闭环 v2 批次 A4）：偏置的三条边界（显式不动 / 只降一档 / 同家找档）
// 与尽力而为语义（找不到目标档原样返回）在这里判卷——生产接线在 agent-runner 装配缝。
describe("preferCheapSelection（自进化便宜档偏置）", () => {
  // MainModelSelection 是含 demo 的联合：取 spec 统一走这个小口（demo ⇒ null，判卷里 expect 非 null）。
  const specOf = (s: ReturnType<typeof preferCheapSelection>) => (s.kind === "demo" ? null : s.spec);
  const glmStandard = { kind: "glm" as const, spec: DEFAULT_MODEL_TABLE.find((s) => s.id === "glm-standard")!, modelExplicit: false };
  const glmStrong = { kind: "glm" as const, spec: DEFAULT_MODEL_TABLE.find((s) => s.id === "glm-strong")!, modelExplicit: false };
  const glmPinned = { ...glmStandard, modelExplicit: true };

  it("standard/strong 缺省档 ⇒ 同家降一档到 glm-flash；modelExplicit 落 false", () => {
    const demoted = preferCheapSelection(glmStandard);
    expect(specOf(demoted)?.id).toBe("glm-flash");
    if (demoted.kind !== "demo") expect(demoted.modelExplicit).toBe(false);
    expect(specOf(preferCheapSelection(glmStrong))?.tier).toBe("standard"); // 只降一档，不跳到 cheap
  });

  it("反向：显式点名（modelExplicit）与 demo 不动——偏置只降缺省档", () => {
    expect(preferCheapSelection(glmPinned)).toEqual(glmPinned);
    expect(preferCheapSelection({ kind: "demo" })).toEqual({ kind: "demo" });
  });

  it("反向：已是 cheap ⇒ 原样；同家没有目标档 ⇒ 原样（尽力而为，绝不因偏置失败）", () => {
    const glmCheap = { ...glmStandard, spec: DEFAULT_MODEL_TABLE.find((s) => s.id === "glm-flash")! };
    expect(specOf(preferCheapSelection(glmCheap))?.tier).toBe("cheap");
    // 表里没有「某家没有 cheap」的内置情形，用 custom 分支构造：spec 挂在 custom 家名下，
    // effectiveModelTable 里该家没有 cheap 行 ⇒ 原样返回。
    const customOnly = { kind: "custom" as const, providerId: "no-such-provider", spec: glmStrong.spec, modelExplicit: false };
    expect(preferCheapSelection(customOnly)).toEqual(customOnly);
  });
});
