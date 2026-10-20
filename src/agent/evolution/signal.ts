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
import { eventsForCurrentRun } from "../delivery-guard";

export interface EvolutionSignals {
  /** verify 失败按 cause 计数（cause 缺席 = 模型自调且未归因，记 "unknown"）。 */
  verifyFailuresByCause: Record<string, number>;
  /** 最后一拍 verify 的失败原因；绿色或无 verify 时为 null。 */
  lastVerifyFailureCause?: VerifyCause | "unknown" | null;
  /** 同一 cause 连续 ≥3 次失败 ⇒ 升级信号；具体处置由 cause 归因决定。 */
  repeatedVerifyCause: VerifyCause | "unknown" | null;
  /** verify 全绿 / 全红 / 未跑。 */
  verifyOutcome: "green" | "red" | "none";
  /** 目标漂移条数（goal-drift 的真读数）。 */
  goalDriftCount: number;
  /** 目标漂移**是否可测**（有没有助手的散文可读）。**可选**：缺省 = 可测
   *  （手搭的信号字面量没这一格时，按"给了 count 就是测过了"读——`extractSignals` 恒给）。
   *  `goalDriftCount === 0` 有两种成因：**测过了没有**，与**根本没得测**（这一跑只有工具调用、
   *  助手一句散文都没写）——旧实现把两者都读成 0，于是"没测过"被当成"漂移已消解"
   *  ⇒ 上一轮的 goal-reconfirm 补丁被**删掉**，审计轨迹还记着"已消解"（为一个从没测过的漂移）。
   *  同 `costMeasurable` 那一格（2026-10-16「不可测 ≠ 无前进」），此处补上对应的可测标记。 */
  goalDriftMeasurable?: boolean;
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
  // 只读当前用户轮的主会话：历史轮次与 worker 子流都不能替父会话表态。
  const scoped = eventsForCurrentRun(events);
  const verifyResults = scoped.filter(
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
      repeatedVerifyCause = null;
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
    // 只保留当前连续失败段：恢复或切换 cause 后，旧升级信号必须失效。
    repeatedVerifyCause = runOfCause >= 3 ? cause as VerifyCause | "unknown" : null;
  }

  const lastVerify = verifyResults[verifyResults.length - 1];
  const verifyOutcome: "green" | "red" | "none" =
    lastVerify === undefined ? "none" : lastVerify.ok ? "green" : "red";

  const turns = assistantTurnsFromEvents(scoped);
  const drift = goalDriftFindings(turns);
  const cost = costPerProgress(scoped);

  return {
    verifyFailuresByCause,
    lastVerifyFailureCause: lastVerify !== undefined && !lastVerify.ok ? lastVerify.cause ?? "unknown" : null,
    repeatedVerifyCause,
    verifyOutcome,
    goalDriftCount: drift.length,
    goalDriftMeasurable: turns.length > 0,
    costMeasurable: cost.measurable,
    tokensPerBoundary: cost.tokensPerBoundary,
    spendAfterLastBoundary: cost.spendAfterLastBoundary,
    eventCount: scoped.length,
  };
}
