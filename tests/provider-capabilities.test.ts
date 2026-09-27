import { describe, expect, it } from "vitest";
import {
  capabilityForModel,
  listProviderCapabilities,
  listVerifiedProviderCapabilities,
  THINKING_EFFORTS,
  validateThinkingEffort,
} from "../src/providers/capabilities";
import { DEFAULT_MODEL_TABLE, findSpecByNameOrId } from "../src/providers/registry";

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
