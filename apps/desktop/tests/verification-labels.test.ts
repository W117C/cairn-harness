// 验证状态的四个词只有一套（第 944 页）：编排面 EVIDENCE_LABEL 与交付卡 STATUS_LABEL
// 此前各写一份（「验证失败/验证过期」vs「验证未过/证据已过期」），同样四个状态两套说法。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERIFICATION_NOT_REQUIRED, verificationLabel } from "../src/renderer/derived/verification-labels";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("验证状态词表", () => {
  it("四个状态一套词；认不出的原样返回（不替事件流编词）", () => {
    expect(verificationLabel("verified")).toBe("已验证");
    expect(verificationLabel("failed")).toBe("验证失败");
    expect(verificationLabel("stale")).toBe("证据已过期");
    expect(verificationLabel("absent")).toBe("未验证");
    expect(verificationLabel("weird")).toBe("weird");
    expect(VERIFICATION_NOT_REQUIRED).toBe("无需验证");
  });

  it("两个消费面都读同一份，且不再各自写表", () => {
    const orchestration = read("../src/renderer/derived/orchestration.ts");
    expect(orchestration).toContain('from "./verification-labels"');
    expect(orchestration).toContain("verificationLabel(evidence)");
    expect(orchestration).not.toContain("EVIDENCE_LABEL");

    const card = read("../src/renderer/components/ChangeSummaryCard.tsx");
    expect(card).toContain('from "../derived/verification-labels"');
    expect(card).toContain("verificationLabel(status)");
    expect(card).not.toContain("STATUS_LABEL");
    expect(card).not.toContain("验证未过");
  });
});
