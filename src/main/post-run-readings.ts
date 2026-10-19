// 一场 run 收束后的三支**观测读数**：目标漂移 / cost-per-progress / 自进化落盘。
//
// 2026-10-17 从 `agent-runner.ts` 的 `runAgent` 收束路径整段搬出（结构债审查报告 #2 的 run 管线缝）。
// 说明为什么只切这一段：那条缝的主体（一个 462 行的 `try`）当时正被另一会话的 delivery-guard 改动
// 占着，而这三支在 `try` **之后**、且与装配根的模块级状态零耦合（只读事件流、只印 stderr）——
// 是这条缝上唯一能安全先切的一段。
//
// 三支共同的纪律（原文随块搬来，未改一字）：**只观测、不驱动任何决策**，所以只印 stderr、不落事件流
// （落流要新增事件类型，而事件流是重放契约）；失败**不许静默**——「没量到」不许被读成「没问题」。
import { assistantTurnsFromEvents, goalDriftCell, goalDriftFindings } from "../agent/goal-drift";
import { costPerProgress } from "../agent/cost-per-progress";
import { eventsForCurrentRun } from "../agent/delivery-guard";
import { runEvolution } from "../agent/evolution";
import { replay, type AgentEvent } from "../events";

export interface PostRunReadingInput {
  logPath: string;
  workspace: string;
  /** 会话 id（自进化那一支的归属键）；缺席时退回 logPath。 */
  sessionId?: string;
}

/** 收束时调一次。**任何一支失败都不抛**——它不参与这一场的结果。 */
export async function emitPostRunReadings(input: PostRunReadingInput): Promise<void> {
  let events: AgentEvent[];
  try {
    events = eventsForCurrentRun(await replay(input.logPath), { includeWorkers: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[goal-drift] 读数失败（这一格未检，不等于没有漂移）: " + reason);
    console.warn("[cost-per-progress] 读数失败（这一格未检）: " + reason);
    console.warn("[evolution] 读数/落盘失败（不影响主流程）: " + reason);
    return;
  }
  // 目标漂移读数（能力 4「长任务不遗忘」的真读数，此前这个模块**零生产消费者**：
  // 只有 tests/goal-drift.test.ts 引用它，于是「长任务会不会改口」永远只有单测证据、没有运行证据）。
  //
  // 为什么印 stderr 而**不落事件流**：落流就得新增一种事件类型，而事件流是重放契约
  // （每条都要能 replay 往返，新增类型会让旧日志重放多一个分支）；而这条读数是
  // **事后观测**，不驱动任何决策、不影响这一轮的行为。真要让它可回放，正确做法是下一波
  // 把它并进既有的 `goal_stopped` 那类事件，而不是现在偷加一个类型。
  //
  // 取料口径与被判对象**同一份**（`assistantTurnsFromEvents` 从事件流重组），不另拼一套
  // ——「同一条判据各抄一份」是本仓最忌的一种腐坏。
  try {
    const drift = goalDriftFindings(assistantTurnsFromEvents(eventsForCurrentRun(events)));
    if (drift.length > 0) console.warn("[goal-drift] " + goalDriftCell(drift));
  } catch (err) {
    // 读数失败不许影响主流程（它只是观测），但也不许静默：这一格取不到就是「没量到」，
    // 静默会把「没量到」读成「没漂移」——本仓反复点名的同一族坑。
    console.warn("[goal-drift] 读数失败（这一格未检，不等于没有漂移）: " + (err instanceof Error ? err.message : String(err)));
  }
  // cost-per-progress：同 goal-drift 的纪律——观测读数，不落事件流，不影响主流程。
  try {
    const cpp = costPerProgress(events);
    if (cpp.measurable && cpp.tokensPerBoundary !== null) {
      console.warn(
        "[cost-per-progress] 每 verified 边界约 " + cpp.tokensPerBoundary + " token" +
          "｜主面 " + cpp.mainTokens + " token" +
          "｜边界后死跑 " + cpp.spendAfterLastBoundary + " token" +
          (cpp.excludedWorkerTokens > 0 ? "（worker 开销 " + cpp.excludedWorkerTokens + " 已单列不入比值）" : ""),
      );
    } else {
      console.warn("[cost-per-progress] 本跑不可测（" + String(cpp.reason) + "）——不许折成 0 或 Infinity");
    }
  } catch (err) {
    console.warn("[cost-per-progress] 读数失败（这一格未检）: " + (err instanceof Error ? err.message : String(err)));
  }
  // 自进化闭环：抽信号 → 生补丁 → 落 .agent/evolution.json。失败不阻塞主流程。
  try {
    const evo = await runEvolution(events, input.workspace, input.sessionId ?? input.logPath);
    if (evo.persistedTo !== null && evo.patches.length > 0) {
      console.warn("[evolution] 本跑产出 " + evo.patches.length + " 条策略补丁，已落 " + String(evo.persistedTo));
    }
  } catch (err) {
    console.warn("[evolution] 读数/落盘失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
  }
}
