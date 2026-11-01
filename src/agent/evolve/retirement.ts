// 退役与冲突（Cairn Evolve · P4）：把“过期 / 负证据 / 同触发冲突”折成可审计的 playbook delta。
//
// 纯函数只产出 findings 与 ops；是否 apply 由调用方（CLI，默认 dry-run）决定。
// 过期：retire（不再注入，保留 tombstone）；负证据：dormant（可经因果证据重新激活）；
// 冲突：两条都 deprecate（可经 patch 复活，留给人裁决）。
//
// 负证据只读观测账（Successes/trials），不是因果——小样本会被最小场次挡住，且 apply 由人决定。

import {
  detectConflicts,
  isExpired,
  type ExperienceEntry,
  type PlaybookOp,
} from "./playbook";

export type RetirementReason = "expired" | "conflict" | "negative";

export interface RetirementFinding {
  id: string;
  reason: RetirementReason;
  detail: string;
}

/** 观测账的最小形状（与 `observationalStatsOf` 的行兼容；额外字段忽略）。 */
export interface RetirementObservation {
  trials: number;
  successes: number;
}

export interface RetirementOptions {
  /** 判负证据的最少可测场次（缺省 5）：更少的样本按噪声处理，不降级。 */
  minNegativeTrials?: number;
  /** 成功率上限（缺省 0.2）：≤ 它才算负证据。 */
  maxNegativeSuccessRate?: number;
}

export const RETIREMENT_MIN_NEGATIVE_TRIALS = 5;
export const RETIREMENT_MAX_NEGATIVE_SUCCESS_RATE = 0.2;

export function retirementFindings(
  entries: readonly ExperienceEntry[],
  now: number,
  observations: ReadonlyMap<string, RetirementObservation> = new Map(),
  options: RetirementOptions = {},
): RetirementFinding[] {
  const out: RetirementFinding[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.status !== "active" && entry.status !== "shadow" && entry.status !== "candidate") continue;
    if (!isExpired(entry, now)) continue;
    out.push({
      id: entry.id,
      reason: "expired",
      detail: "expiresAt " + String(entry.expiresAt) + " ≤ now " + String(now) + "（" + entry.kind + "）",
    });
    seen.add(entry.id);
  }

  const minTrials = options.minNegativeTrials ?? RETIREMENT_MIN_NEGATIVE_TRIALS;
  const maxRate = options.maxNegativeSuccessRate ?? RETIREMENT_MAX_NEGATIVE_SUCCESS_RATE;
  for (const entry of entries) {
    if (entry.status !== "active" || seen.has(entry.id)) continue;
    const stat = observations.get(entry.id);
    if (stat === undefined || stat.trials < minTrials) continue;
    const rate = stat.successes / stat.trials;
    if (rate > maxRate) continue;
    out.push({
      id: entry.id,
      reason: "negative",
      detail: "观测 " + String(stat.successes) + "/" + String(stat.trials)
        + "（成功率 " + String(Math.round(rate * 100)) + "% ≤ " + String(Math.round(maxRate * 100)) + "%）——建议 dormant",
    });
    seen.add(entry.id);
  }

  for (const conflict of detectConflicts(entries)) {
    if (!seen.has(conflict.a)) {
      out.push({ id: conflict.a, reason: "conflict", detail: "与 " + conflict.b + " 冲突：" + conflict.reason });
      seen.add(conflict.a);
    }
    if (!seen.has(conflict.b)) {
      out.push({ id: conflict.b, reason: "conflict", detail: "与 " + conflict.a + " 冲突：" + conflict.reason });
      seen.add(conflict.b);
    }
  }

  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** findings ⇒ delta；过期 retire、负证据 dormant、冲突 deprecate（可恢复）。 */
export function retirementOps(findings: readonly RetirementFinding[], now: number): PlaybookOp[] {
  return findings.map((finding): PlaybookOp => {
    if (finding.reason === "expired") {
      return { v: 1, op: "retire", ts: now, id: finding.id, evidence: [], reason: "retire: " + finding.detail };
    }
    if (finding.reason === "negative") {
      return {
        v: 1, op: "patch", ts: now, id: finding.id,
        fields: { status: "dormant" }, evidence: [], reason: "dormant: " + finding.detail,
      };
    }
    return { v: 1, op: "deprecate", ts: now, id: finding.id, evidence: [], reason: "deprecate: " + finding.detail };
  });
}
