import { describe, expect, it } from "vitest";
import {
  newCandidate,
  paretoFront,
  selectParents,
  validateCandidate,
  type CandidateRecord,
  type CandidateScores,
} from "../src/agent/evolve/candidates";

function candidate(
  overrides: Partial<Parameters<typeof newCandidate>[0]> = {},
  holdout: CandidateScores | null = null,
): CandidateRecord {
  return newCandidate({
    workspace: "/w",
    operator: "experiment",
    target: { kind: "experience", id: "exp_0123456789abcdef" },
    body: "candidate body",
    evidence: ["ep_1"],
    status: "passed",
    eval: { holdout },
    now: 1_000,
    ...overrides,
  });
}

describe("候选档案", () => {
  it("同输入同 id；形状校验拒绝越界", () => {
    const a = candidate();
    const b = candidate();
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^cand_[0-9a-f]{16}$/u);
    expect(validateCandidate(a)).toEqual([]);
    expect(validateCandidate({ ...a, id: "bad" }).join("\n")).toContain("id");
    expect(validateCandidate({ ...a, status: "bogus" as never }).join("\n")).toContain("status");
  });

  it("Pareto 只收有 holdout 的候选，非支配集保留权衡", () => {
    const fast = candidate({ body: "fast" }, { success: 0.8, costUsd: 1, latencyMs: 100, safety: "pass" });
    const cheap = candidate({ body: "cheap" }, { success: 0.7, costUsd: 0.5, latencyMs: 100, safety: "pass" });
    const dominated = candidate({ body: "dominated" }, { success: 0.8, costUsd: 1.2, latencyMs: 120, safety: "pass" });
    const unscored = candidate({ body: "unscored" }, null);

    const front = paretoFront([fast, cheap, dominated, unscored]);
    expect(front.map((item) => item.id).sort()).toEqual([fast.id, cheap.id].sort());
    expect(front.map((item) => item.id)).not.toContain(dominated.id);
    expect(front.map((item) => item.id)).not.toContain(unscored.id);
  });

  it("父代选择先看元生产力，再稳定 id", () => {
    const a = candidate({ body: "a" }, { success: 0.8, costUsd: 1, latencyMs: 100, safety: "pass" });
    const b = candidate({ body: "b" }, { success: 0.7, costUsd: 0.5, latencyMs: 100, safety: "pass" });
    const withYield = (item: CandidateRecord, yieldPerKToken: number): CandidateRecord => ({
      ...item,
      metaproductivity: { trials: 2, accepted: 1, yieldPerKToken },
    });
    const parents = selectParents([withYield(a, 0.1), withYield(b, 0.9)], 2);
    expect(parents.map((item) => item.id)).toEqual([b.id, a.id]);
  });
});
