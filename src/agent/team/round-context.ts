// 群的一轮里，成员**看得到别人说过什么**（ADR 0015 §五 M4 的尾巴）。
//
// 之前记在台账里的限制：一轮内多个 @ 是「同时开工」，但互相看不见对方这一轮的回答——
// 因为每个人的任务书就是群里最后一句。这一层把共享流里最近几条**编进任务书**，
// 让「同一批」至少能看见**本批之前**说过的话（真·同时开工的互相可见要等编排计划，另案）。
//
// 口径：
//  ① 只取最近 `limit` 条，**倒序拼**成时间线（旧→新），带说话人；
//  ② 自己说过的话也带上（上下文连贯），但用 `（你）` 标出来；
//  ③ 单条截断到 `LINE_MAX`，整段截断到 `TOTAL_MAX`（预算优先，任务书别被历史撑爆）；
//  ④ 没有任何历史 ⇒ 原样返回任务（不凭空加壳）。
import type { StreamItem } from "./stream";

export const ROUND_CONTEXT_LIMIT = 6;
export const ROUND_CONTEXT_LINE_MAX = 400;
export const ROUND_CONTEXT_TOTAL_MAX = 2000;

export interface RoundContextInput {
  task: string;
  /** 共享流（时间正序）。 */
  items: readonly StreamItem[];
  /** 这一轮要跑的人（成员 id 或 "main"）。 */
  speaker: string;
  limit?: number;
}

export function composeRoundTask(input: RoundContextInput): string {
  const limit = input.limit ?? ROUND_CONTEXT_LIMIT;
  const history = input.items.filter((i) => i.kind === "user" || i.kind === "agent").slice(-limit);
  if (history.length === 0) return input.task;

  const lines: string[] = [];
  let used = 0;
  for (const item of history) {
    const who = item.speaker === input.speaker ? "（你）" : item.speaker;
    const text = item.text.length > ROUND_CONTEXT_LINE_MAX ? item.text.slice(0, ROUND_CONTEXT_LINE_MAX) + "…" : item.text;
    const line = `- ${who}：${text}`;
    // 预算：超了就停（旧→新保留，最近的话优先留在里面）
    if (used + line.length > ROUND_CONTEXT_TOTAL_MAX) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return input.task;
  return ["【群里最近说过】", ...lines, "", "【这一轮你要做的】", input.task].join("\n");
}
