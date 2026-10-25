import { describe, expect, it } from "vitest";
import {
  capabilityForModel,
  listProviderCapabilities,
  listVerifiedProviderCapabilities,
  THINKING_EFFORTS,
  validateThinkingEffort,
} from "../src/providers/capabilities";
import { DEFAULT_MODEL_TABLE, findSpecByNameOrId, freeformModelId } from "../src/providers/registry";

describe("provider capability contract", () => {
  it("lists a capability for every registered model without inventing thinking support", () => {
    const capabilities = listProviderCapabilities(DEFAULT_MODEL_TABLE);
    expect(capabilities).toHaveLength(DEFAULT_MODEL_TABLE.length);
    expect(capabilities.every((cap) => cap.availability === "unverified")).toBe(true);
    expect(listVerifiedProviderCapabilities(DEFAULT_MODEL_TABLE)).toEqual([]);
    // 证据纪律不变：没声明档位的内置行照旧 supported=false。唯一的例外是 DeepSeek 两行——
    // 它们的 reasoningEfforts 是官方文档自述（2026-10-25 api-docs 实读：effort low/high/max），
    // 正是 capability() 注释里「上游自述」那条证据通道第一次在内置行上被官方文档填上。
    const declared = capabilities.filter((cap) => cap.provider === "deepseek");
    expect(declared).toHaveLength(2);
    for (const cap of declared) {
      expect(cap.thinking.supported).toBe(true);
      expect(cap.thinking.values).toEqual(["off", "low", "high"]); // max 归到 high，medium 未声明不可选
      expect(cap.thinking.default).toBe("off"); // 声明了支持 ≠ 替用户打开（思考要花钱）
    }
    const rest = capabilities.filter((cap) => cap.provider !== "deepseek");
    expect(rest.every((cap) => cap.thinking.supported === false)).toBe(true);
    expect(rest.every((cap) => cap.thinking.values.join(",") === "off")).toBe(true);
    expect(rest.every((cap) => cap.attachments.text && !cap.attachments.image)).toBe(true);
    // 识图证据同源：flash 官方自述收图像，pro 只收文本
    expect(declared.find((c) => c.modelId === "deepseek-cheap")?.attachments.image).toBe(true);
    expect(declared.find((c) => c.modelId === "deepseek-strong")?.attachments.image).toBe(false);
  });

  it("keeps the UI vocabulary centralized and stable", () => {
    expect(THINKING_EFFORTS).toEqual(["off", "low", "medium", "high"]);
  });

  it("defaults an omitted thinking value to the model capability default", () => {
    const spec = findSpecByNameOrId(DEFAULT_MODEL_TABLE, "glm-standard");
    expect(spec).toBeDefined();
    expect(validateThinkingEffort(spec!, undefined)).toBe("off");
  });

  it("rejects a non-off thinking value while the adapter wire support is absent", () => {
    const spec = findSpecByNameOrId(DEFAULT_MODEL_TABLE, "openai-standard");
    expect(() => validateThinkingEffort(spec!, "high")).toThrow(/不支持 thinking/);
    // 第 447 页：这句要原句证人（欠证人帽 0）；点的是那句里 ≥6 字的连续中文，不是关键词。
    expect(() => validateThinkingEffort(spec!, "high")).toThrow(/当前仅支持下列取值/);
  });

  it("DeepSeek 声明档位可校验通过；未声明的 medium 仍被拒（宁可发小一档也不猜）", () => {
    const spec = findSpecByNameOrId(DEFAULT_MODEL_TABLE, "deepseek-cheap");
    expect(validateThinkingEffort(spec!, "low")).toBe("low");
    expect(validateThinkingEffort(spec!, "high")).toBe("high");
    expect(validateThinkingEffort(spec!, undefined)).toBe("off");
    expect(() => validateThinkingEffort(spec!, "medium")).toThrow(/不支持 thinking/);
  });

  it("fails visibly for an unregistered model rather than inventing capability", () => {
    expect(() => capabilityForModel({ id: "ghost", provider: "openai" })).toThrow(/未登记/);
  });
});

/* 自由档（`--model <表外模型名>`）按设计不进 DEFAULT_MODEL_TABLE——表是 bandit 代价项与预算折钱的
   依据，塞一个查不到价的行等于让它按假价参与路由。**但它仍要能拨**。
   2026-09-28 真机跑第一版就栽在这里：`capabilityForModel` 要求登记，于是 `validateThinkingEffort`
   抛「模型 capability 未登记」⇒ `--model stealth/space-bunny-alpha` **一次都拨不出去**，
   而 README 已经把它写成可用的写法。不进表是为了不按假价参与路由，不是为了不让它跑。 */
describe("自由档 capability：表外但可拨，且能力取保守值", () => {
  const spec = { id: freeformModelId("stealth/space-bunny-alpha"), provider: "openai" } as const;

  it("合成得出，且 capability 的 modelId 就是那个自由档 id（不留孤儿行）", () => {
    const cap = capabilityForModel(spec);
    expect(cap.modelId).toBe(spec.id);
    expect(cap.provider).toBe("openai");
  });

  it("取的是保守值：thinking 只 off、附件只文本、availability 记 unverified", () => {
    const cap = capabilityForModel(spec);
    // 判据是「不因为模型可能支持就报 true」——表外的东西没有实测，凭什么开 thinking？
    expect(cap.thinking.supported).toBe(false);
    expect(cap.thinking.values).toEqual(["off"]);
    expect(cap.attachments.text).toBe(true);
    expect(cap.attachments.image).toBe(false);
    expect(cap.availability).toBe("unverified");
  });

  it("**能真的走完校验**（这才是真机跑挂掉的那一格）", () => {
    expect(validateThinkingEffort(spec, undefined)).toBe("off");
    expect(() => validateThinkingEffort(spec, "high")).toThrow(/不支持 thinking/);
  });

  it("仍然不在档位表里（豁免的是 capability 那一格，不是把模型登记进去）", () => {
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, spec.id)).toBeUndefined();
    // 少掉这一条，另一种「修法」就是往表里塞一行 ⇒ 那正是自由档要躲的假价路由。
    expect(DEFAULT_MODEL_TABLE.some((m) => m.model === "stealth/space-bunny-alpha")).toBe(false);
  });

  it("前缀仍是精确匹配，不是包含（`freeform/` 后面跟着的东西不可伪造 provider）", () => {
    expect(() => capabilityForModel({ id: "freeform-x", provider: "openai" })).toThrow(/未登记/);
    // provider 必须是登记过的那五家：自由档也不给绕过这道的口子
    expect(() => capabilityForModel({ ...spec, provider: "evil" })).toThrow(/Provider capability 未登记/);
  });
});
