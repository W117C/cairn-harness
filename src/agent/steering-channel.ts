/** 第 9 点·用户干预注入（steering）的通道：从界面到 agent loop 的那条路。
 *
 *  为什么需要一只盒子（与 `image-channel.ts` 同族、理由不同）：
 *  插话**不能由调用方直接当第二条 `userMessage` 递进去**——loop 一次 run 只收一条首条任务消息，
 *  中途再递就得新开一次 run，那正好把「同一轮里补一句话」变成「重新派任务」（全部上下文与在途
 *  工具都要重来）。所以插话必须落成**本轮内部**的一条 `user_message`，而能写它的只有 loop 自己。
 *
 *  ⇒ 盒子是「界面 → loop」的单向信箱：界面 `push`，loop 在每拍轮界 `take`。
 *  `take` 取出即清空——同一条插话在两拍里各付一遍 token 是白花钱，而模型收到两遍同一句话
 *  会以为自己看漏了什么（与 `image-channel` 的 take 语义同源）。
 *
 *  **不落盘**：盒子活在进程内存里，插话真正落盘是在 loop 取走它、写成带
 *  `origin:{kind:"steering"}` 的事件那一刻。所以「推了但没被取走」（run 恰好在这一拍收束）
 *  的插话不会在日志里留下一句没人回应的话——这与 `pendingImages` 同一条纪律。 */

export interface SteeringChannel {
  /** 界面侧：用户在这一轮跑着的时候补了一句话。空串与纯空白在这里被丢弃——它们是误触，不是人要说的话。 */
  push: (text: string) => void;
  /** loop 侧：轮界取料。一次取走全部（含同一拍里连说的几句），取完即空。 */
  take: () => string[] | undefined;
  /** 当前待注入的条数（观测用：插话到底有没有送达，不能只看模型有没有照做）。 */
  size: () => number;
}

/** 单条插话的字符帽。插话是人现打的一句话，不是附件正文：
 *  给到 8k 已经远超「顺手把 README 也改了」这类指令；再大就不是插话而是新任务了。 */
export const STEERING_TEXT_MAX_CHARS = 8_000;

export function createSteeringChannel(): SteeringChannel & { push: (text: string) => void } {
  let pending: string[] = [];
  return {
    push(text) {
      const trimmed = text.trim();
      if (trimmed === "") return; // 误触不进货
      // 超帽**截断并保留**而不是拒收：插话是人的即时意图，丢掉它比截断它更坏。
      // 截断边界写进正文尾部，让模型知道这里被截过（不静默截）。
      const body = trimmed.length > STEERING_TEXT_MAX_CHARS
        ? trimmed.slice(0, STEERING_TEXT_MAX_CHARS) + "\n[插话超过 " + String(STEERING_TEXT_MAX_CHARS) + " 字符，尾部被截断]"
        : trimmed;
      pending = [...pending, body];
    },
    take() {
      if (pending.length === 0) return undefined;
      const out = pending;
      pending = [];
      return out;
    },
    size: () => pending.length,
  };
}
