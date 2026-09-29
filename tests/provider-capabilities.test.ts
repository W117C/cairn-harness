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
    expect(capabilities.every((cap) => cap.thinking.supported === false)).toBe(true);
    expect(capabilities.every((cap) => cap.thinking.values.join(",") === "off")).toBe(true);
    expect(capabilities.every((cap) => cap.attachments.text && !cap.attachments.image)).toBe(true);
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
    // provider 必须是登记过的那四家：自由档也不给绕过这道的口子
    expect(() => capabilityForModel({ ...spec, provider: "evil" })).toThrow(/Provider capability 未登记/);
  });
});
