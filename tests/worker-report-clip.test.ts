// worker 报告裁剪的计量面（能力 9）。§6.2 的先例是「2000 token + 类型化裁剪提示」，
// 但旧实现按 chars/4 计量：一份中文报告写满 2000 token 实际是 8000 字符 ≈ 8000 token，
// 提示行自己也不在预算内。两处现在都归到 text-budget 的一份实现上。
import { describe, expect, it } from "vitest";
import { clipWorkerSummary } from "../src/agent/worker-report";
import { SUMMARY_TOKEN_CAP } from "../src/agent/orchestrator-config";
import { estimateTextTokens } from "../src/agent/text-budget";

describe("clipWorkerSummary 按字符类别计量", () => {
  it("恰好 2000 字的中文报告不截（旧口径会当成 500 token）", () => {
    const r = clipWorkerSummary("报".repeat(SUMMARY_TOKEN_CAP));
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("报".repeat(SUMMARY_TOKEN_CAP));
  });

  it("超预算的中文报告截完真的 ≤ 预算，且提示行计入预算", () => {
    const r = clipWorkerSummary("告".repeat(SUMMARY_TOKEN_CAP * 4));
    expect(r.truncated).toBe(true);
    expect(estimateTextTokens(r.text)).toBeLessThanOrEqual(SUMMARY_TOKEN_CAP);
    expect(r.text.length).toBeLessThan(SUMMARY_TOKEN_CAP + 60); // 旧实现会留 cap*4 字符
  });

  it("提示文案逐字保留（agents-check G5b 按这条字符串断言）", () => {
    const r = clipWorkerSummary("x".repeat(SUMMARY_TOKEN_CAP * 8));
    expect(r.text).toContain("[truncated: summary 超 2000 token 上限，已类型化裁剪]");
  });

  it("短的英文报告逐字不变（零回归）", () => {
    const r = clipWorkerSummary("done: 3 tests pass, no risk");
    expect(r).toEqual({ text: "done: 3 tests pass, no risk", truncated: false });
  });
});
