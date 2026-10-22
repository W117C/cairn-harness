// 用量账本的**纯投影**（2026-10-21 批 131）：
// 面板（当前会话）与主进程跨会话汇总必须用**同一套**口径，否则两个数字会慢慢分叉。
// 这里只做事件折叠，不碰文件与 Electron——渲染层可直接 import（纯函数，无 Node 依赖）。
import type { AgentEvent } from "../events";

/** 六个维度 = 面板展示的六行；token 缺字段当 0（旧日志防御），缓存「没量到」不冒充 0。 */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usageCount: number;
  toolSteps: number;
  rounds: number;
}

export function emptyUsageTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 0, toolSteps: 0, rounds: 0 };
}

/** 子 agent 子流事件带 agent_id；主会话的事件不带。旧日志没有该字段 ⇒ 按主会话计入（旧口径）。 */
function isWorkerSubflow(e: AgentEvent): boolean {
  if (e.type === "agent_spawned") return false;
  const id = (e as { agent_id?: unknown }).agent_id;
  return typeof id === "string";
}

/** 把一条事件折进累加器。口径逐条写死，别处不要再算第二遍：
 *  · usage：全部计入（含 worker——token 是真实花掉的，不分主/子）；缺字段当 0。
 *  · 工具步数：只数主会话 tool_call（worker 的步数在各自子流里，不算进这条对话）。
 *  · 对话轮数：只数主会话 user_message（worker 的任务描述不是用户对这条对话说的话）。 */
export function foldUsageEvent(acc: UsageTotals, e: AgentEvent): void {
  if (e.type === "usage") {
    acc.usageCount += 1;
    acc.inputTokens += typeof e.inputTokens === "number" ? e.inputTokens : 0;
    acc.outputTokens += typeof e.outputTokens === "number" ? e.outputTokens : 0;
    const cacheRead = (e as { cacheReadInputTokens?: unknown }).cacheReadInputTokens;
    if (typeof cacheRead === "number") acc.cacheReadTokens += cacheRead;
    return;
  }
  if (isWorkerSubflow(e)) return;
  if (e.type === "tool_call") acc.toolSteps += 1;
  else if (e.type === "user_message") acc.rounds += 1;
}

export function usageTotals(events: readonly AgentEvent[]): UsageTotals {
  const acc = emptyUsageTotals();
  for (const e of events) foldUsageEvent(acc, e);
  return acc;
}

export function addUsageTotals(target: UsageTotals, delta: UsageTotals): UsageTotals {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.usageCount += delta.usageCount;
  target.toolSteps += delta.toolSteps;
  target.rounds += delta.rounds;
  return target;
}
