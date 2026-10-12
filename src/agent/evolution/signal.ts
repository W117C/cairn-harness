// 自进化的信号抽取层：从一份已落盘的事件流里读出「这次跑得怎么样」，
// 全是纯函数（给定 events ⇒ 给定 signals），不碰 IO、不碰 provider。
//
// 设计取舍（沿用本仓三条纪律）：
// 1. **证据指针**：每条信号都带 callId / eventId / cause，无出处不产出——
//    这与 `memory/lessons.ts`「无出处不写盘」是同一道门的两端。
// 2. **不可测 ≠ 零**：`costPerProgress` 的 `measurable:false` 原样透传，
//    不许折成 0 或 Infinity（同 cost-per-progress 模块的纪律）。
// 3. **只读既有判据**：verify 失败归因取 `VerifyResultEvent.cause`（已由
//    `verify.ts` 算好），目标漂移取 `goal-drift.ts`，成本取 `cost-per-progress.ts`——
//    不抄第二份判据。

import type { AgentEvent, VerifyCause } from "../../events";
import { goalDriftFindings, assistantTurnsFromEvents } from "../goal-drift";
import { costPerProgress } from "../cost-per-progress";

export interface EvolutionSignals {
  /** verify 失败按 cause 计数（cause 缺席 = 模型自调且未归因，记 "unknown"）。 */
  verifyFailuresByCause: Record<string, number>;
  /** 同一 cause 连续 ≥3 次失败 ⇒ 升级信号（模型照着红改本来正确的代码那一族）。 */
  repeatedVerifyCause: VerifyCause | "unknown" | null;
  /** verify 全绿 / 全红 / 未跑。 */
  verifyOutcome: "green" | "red" | "none";
  /** 目标漂移条数（goal-drift 的真读数）。 */
  goalDriftCount: number;
  /** 成本÷前进是否可测。 */
  costMeasurable: boolean;
  /** 可测时的 tokensPerBoundary；不可测则 null。 */
  tokensPerBoundary: number | null;
  /** 最后一次 verified 边界之后仍花的 token（死跑成本）。 */
  spendAfterLastBoundary: number;
  /** 总事件数，供补丁做「这是一条多长的跑」的粗判。 */
  eventCount: number;
}

/** 从事件流抽取自进化信号。纯函数。 */
export function extractSignals(events: readonly AgentEvent[]): EvolutionSignals {
  const verifyResults = events.filter(
    (e): e is Extract<AgentEvent, { type: "verify_result" }> => e.type === "verify_result",
  );
  const verifyFailuresByCause: Record<string, number> = {};
  let lastCause: string | null = null;
  let runOfCause = 0;
  let repeatedVerifyCause: VerifyCause | "unknown" | null = null;

  for (const v of verifyResults) {
    if (v.ok) {
      lastCause = null;
      runOfCause = 0;
      continue;
    }
    const cause = v.cause ?? "unknown";
    verifyFailuresByCause[cause] = (verifyFailuresByCause[cause] ?? 0) + 1;
    if (cause === lastCause) {
      runOfCause += 1;
    } else {
      lastCause = cause;
      runOfCause = 1;
    }
    if (runOfCause >= 3 && repeatedVerifyCause === null) {
      repeatedVerifyCause = cause as VerifyCause | "unknown";
    }
  }

  const lastVerify = verifyResults[verifyResults.length - 1];
  const verifyOutcome: "green" | "red" | "none" =
    lastVerify === undefined ? "none" : lastVerify.ok ? "green" : "red";

  const drift = goalDriftFindings(assistantTurnsFromEvents(events));
  const cost = costPerProgress(events);

  return {
    verifyFailuresByCause,
    repeatedVerifyCause,
    verifyOutcome,
    goalDriftCount: drift.length,
    costMeasurable: cost.measurable,
    tokensPerBoundary: cost.tokensPerBoundary,
    spendAfterLastBoundary: cost.spendAfterLastBoundary,
    eventCount: events.length,
  };
}
