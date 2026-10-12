// goal 轨迹（设过什么目标 / 第几轮 / 有没有停）的**唯一一份** reduce。
//
// 为什么单开一个文件而不留在 goal.ts：渲染层的实时芯片必须与主进程的续跑判据读同一份语义，
// 否则「芯片显示第 3 轮、判据以为第 5 轮」就是本仓库点名的第二事实源。而 goal.ts 顶层 import 了
// worker-report（→ memory/inject、security/scan），那条链不能进 renderer 包。本文件只 import 类型
// （编译期擦除），所以两端都能安全地用它。
import type { AgentEvent } from "../events";

/** 轮次闸的三个数。放在本文件是因为**两端都要用**：判据拿它们停，渲染层拿它们写表单的缺省与提示。
 *  留在 goal.ts 里，渲染层就 import 不到（那条链带 worker-report），只能自己抄一份数——
 *  抄数即第二事实源：改帽那天芯片显示的区间就开始说谎。 */
export const GOAL_TURN_CAP_DEFAULT = 8;
export const GOAL_TURN_CAP_MIN = 1;
export const GOAL_TURN_CAP_MAX = 25;

export interface GoalSpec {
  objective: string;
  maxTurns: number;
  /** 美元上限；0 = 闸关（不设钱闸，只按轮次闸停）。 */
  maxUsd: number;
}

export interface GoalTrace {
  spec: GoalSpec;
  /** 已发生的 run 轮数（≥1）：1 + 该 `goal_set` 之后 origin.kind==="goal" 的续跑轮数。
   *  人手发的下一条消息**不**计入——那是人在接管，不是 agent 自己烧的一轮。 */
  turn: number;
  /** 已停下来的原因原文（`goal_stopped`）；null = 还没停。 */
  stopped: string | null;
  /** 已**挂起**的理由原文（`goal_paused`）；null = 没挂起。与 `stopped` 分开：挂起可恢复、
   *  停止是终态。判据两者都短路，但只有停止会挡住「用户再发一条也不复活」那条语义。 */
  paused: string | null;
  /** 最后一条 `goal_set` 在事件流里的下标（证据窗口 = 其后那段）。-1 = 没设过。 */
  at: number;
}

/** 与目标态有关的事件（其余一律不影响芯片读数）。
 *  渲染层为芯片只留这一小段筛选后的数组：goal_set / goal_stopped / goal_paused / goal_resumed
 *  各一轮至多一条，goal 代发轮更被轮次帽卡死 ⇒ 不随会话长度增长，也不必自造第二份「当前目标」状态。 */
export function goalRelevant(e: AgentEvent): boolean {
  if (e.type === "goal_set" || e.type === "goal_stopped" || e.type === "goal_paused" || e.type === "goal_resumed") return true;
  return e.type === "user_message" && e.origin?.kind === "goal";
}

function step(prev: GoalTrace | null, e: AgentEvent, index: number): GoalTrace | null {
  if (e.type === "goal_set") {
    // 模型自设的那一条只改措辞：**不重置轮次、不移动窗口锚点、不清停止状态、不改两条闸**。
    // 这句为什么必须写在这里而不是只写在工具里：工具是唯一入口 = 权限只写在调用方，
    // 绕过工具直接造事件就能把轮次帽归零（本仓对这类"闸只在一层"的一贯判死）。
    if (e.set_by === "model") {
      if (prev === null) return null; // 没有已武装的目标 ⇒ 模型自设不构成武装（连 spec 都不给）
      return {
        ...prev,
        spec: { objective: e.objective, maxTurns: prev.spec.maxTurns, maxUsd: prev.spec.maxUsd },
      };
    }
    return {
      spec: { objective: e.objective, maxTurns: e.max_turns, maxUsd: e.max_usd },
      turn: 1,
      stopped: null,
      paused: null,
      at: index,
    };
  }
  if (prev === null) return null;
  // 停止是终态：它压过挂起位（`paused` 一并清掉，两种「不续跑」的理由不并存，消费者只看一个）。
  if (e.type === "goal_stopped") return { ...prev, stopped: e.reason, paused: null };
  // 已停的目标再点挂起是无意义的：不落状态（否则「停止」与「挂起」会同时为真）
  if (e.type === "goal_paused") return prev.stopped !== null ? prev : { ...prev, paused: e.reason };
  // 恢复只清挂起位：不动 spec/turn/stopped/窗口锚点（恢复 ≠ 改设，已完成的工作不作废）
  if (e.type === "goal_resumed") return prev.paused === null ? prev : { ...prev, paused: null };
  if (e.type === "user_message" && e.origin?.kind === "goal") return { ...prev, turn: prev.turn + 1 };
  return prev;
}

/** 全量重算，无中间状态：渲染层每个 goal 相关事件落地后重跑一次，杜绝"逐步累加"与"快照重算"
 *  两条路各数一遍的双算（replay/live 混流时最容易漏的那一类）。 */
export function traceGoal(events: AgentEvent[]): GoalTrace | null {
  let trace: GoalTrace | null = null;
  for (let i = 0; i < events.length; i++) trace = step(trace, events[i], i);
  return trace;
}
