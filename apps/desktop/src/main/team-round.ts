// 群会话的「一轮」：轮次序号 + 下一位发言者（ADR 0015 §四 第三件在群里的第一刀）。
//
// 状态存在哪：**群里自己的事件日志**（`session_meta_update.patch` 的 `round` 键）。
// 不新增事件种类、不新增存储面；重放能还原「现在是第几轮、轮到谁」。
//
// 顺序怎么定：成员按**名单顺序**轮转（`turnOrder`）。主持优先（`chairFirst`）留给「一轮内」的
// 内部次序，那要等编排引擎把群会话当计划来跑，属下一批；本层只回答「下一位是谁、第几轮」。
import { createEventLog, type AgentEvent } from "../../../../src/events";
import { pathOf, readSessionEvents } from "../../../../src/main/sessions";

export const ROUND_KEY = "round";

export interface GroupRoundResult {
  ok: boolean;
  /** 这一轮的序号（1-based）。 */
  round?: number;
  /** 下一位发言者（成员 id）。 */
  speaker?: string;
  error?: string;
}

/** 从事件里读当前轮次（没有就 0）。 */
export function roundOf(events: readonly AgentEvent[]): number {
  let round = 0;
  for (const event of events) {
    if (event.type !== "session_meta_update") continue;
    const raw = (event.patch as Record<string, string>)[ROUND_KEY];
    if (typeof raw === "string" && /^\d+$/.test(raw)) round = Number(raw);
  }
  return round;
}

/**
 * 群里的「这一轮要干什么」：取群会话里**最后一条** user_message 当任务书（没有就返回 null）。
 * 为什么取最后一条：群的话题就是最后那句话；更早的是历史，不该被当成新任务重复派。
 */
export function groupTaskOf(events: readonly AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type !== "user_message") continue;
    const content = (event as { content?: unknown }).content;
    if (typeof content === "string" && content.trim() !== "") return content.trim();
  }
  return null;
}

/** 下一轮：round+1，发言者按名单轮转（名单为空 ⇒ 拒）。 */
export async function advanceGroupRound(
  input: { sessionsRoot: string; sessionId: string; memberIds: readonly string[] },
  deps: {
    read: (root: string, id: string) => Promise<AgentEvent[]>;
    append: (path: string, event: AgentEvent) => Promise<void>;
    pathOf: (root: string, id: string) => string;
  } = { read: readSessionEvents, append: (p, e) => createEventLog(p).append(e), pathOf },
): Promise<GroupRoundResult> {
  const members = input.memberIds.filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  if (members.length === 0) return { ok: false, error: "团队里还没有成员，轮次无从谈起" };
  const events = await deps.read(input.sessionsRoot, input.sessionId).catch(() => [] as AgentEvent[]);
  const current = roundOf(events);
  const next = current + 1;
  const speaker = members[(next - 1) % members.length]!;
  try {
    await deps.append(deps.pathOf(input.sessionsRoot, input.sessionId), {
      type: "session_meta_update",
      patch: { [ROUND_KEY]: String(next) },
    } as AgentEvent);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, round: next, speaker };
}
