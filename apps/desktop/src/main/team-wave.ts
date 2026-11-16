// 一轮里的**波次**：被 @ 到的多个人按顺序跑，**每人开跑前重读共享流**。
//
// 为什么按顺序而不是真并行：两个原因都成立——
//  ① 密钥注入是进程级的（v75 串行闸），并行会串键；
//  ② 真并行时 A 看不到 B「这一轮刚说的」，那正是台账里挂了几轮的限制。
// 按顺序 + 每次重读 ⇒ 后面的成员**看得见前面刚说完的话**，而且不串键。代价是慢一点，写清楚。
import type { AgentEvent } from "../../../../src/events";
import { projectGroupStream } from "../../../../src/agent/team/stream";
import { composeRoundTask } from "../../../../src/agent/team/round-context";

export interface WaveInput {
  speakers: readonly string[];
  /** 群里这一轮的任务书（最后一条 user_message）。 */
  task: string;
  read: () => Promise<readonly AgentEvent[]>;
  start: (memberId: string, task: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  onSkip?: (memberId: string, reason: string) => void;
}

export interface WaveResult {
  ok: boolean;
  ran: { memberId: string; sessionId?: string; sawPrior: boolean }[];
  failed?: { memberId: string; error: string };
}

export async function runWave(input: WaveInput): Promise<WaveResult> {
  const ran: WaveResult["ran"] = [];
  for (const memberId of input.speakers) {
    // 每次**重读**：前一个人刚说的话要进后一个人的任务书。
    const events = await input.read();
    const items = projectGroupStream(events).items;
    const sawPrior = items.some((i) => i.kind === "agent");
    const composed = composeRoundTask({ task: input.task, items, speaker: memberId });
    const started = await input.start(memberId, composed);
    if (started.ok !== true) {
      return { ok: false, ran, failed: { memberId, error: started.error ?? "开跑失败" } };
    }
    ran.push({ memberId, ...(started.sessionId === undefined ? {} : { sessionId: started.sessionId }), sawPrior });
  }
  return { ok: true, ran };
}
