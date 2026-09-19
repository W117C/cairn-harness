// 靶场剧本的「按轮切分」——把冻结剧本喂给 loop 的唯一取数口径。
//
// 为什么要有它：明卷原先直接用 createMockProvider，其语义是「一次 stream() 把剩余剧本全吐完」，
// 于是一个会话**只有一次请求**。后果不是跑得慢，而是量不到：每轮才发生的事
// （上下文逐轮增长、prompt 缓存命中、压缩触发、跨轮保持目标）在靶场里全都退化成 n=1，
// 「这次改动买到分数了吗 / 多花了多少 token」读不出曲线（BLOCKED 裁决 3 的实测结论：
// 三条冻结 case 的装配账 requests 全是 1）。
//
// 切轮的口径与真 API 一致：**一次请求 = 一条 assistant 文本 + 它那一个 tool_call**（吐到
// tool_call 为止，含它）。只改「一次给几条」，不改剧本内容也不改事件顺序（loop 是拉取与执行
// 交错的），所以明卷基线的 score / usage / turns / changedFiles 逐字段不变。
// ⇒ 剧本纪律：每轮最多一个 tool_call（要并行调用的，拆成两轮写）。
import { readFile } from "node:fs/promises";

import type { AgentEvent } from "../../events";
import type { ModelOutput, Provider } from "../../providers";

/** 读剧本并校验形状：只接受 assistant_message / tool_call，别的显式抛错（不静默少装）。 */
export async function loadScriptOutputs(scriptPath: string): Promise<ModelOutput[]> {
  const raw = await readFile(scriptPath, "utf8");
  const out: ModelOutput[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const e = JSON.parse(t) as AgentEvent;
    if (e.type === "assistant_message" || e.type === "tool_call") out.push(e as unknown as ModelOutput);
    else throw new Error(`装配探针剧本只接受 assistant_message/tool_call，读到: ${JSON.stringify(e.type)}`);
  }
  return out;
}

/** 纯函数：从 cursor 起取一轮 = 到第一个 tool_call 为止（含它）；剧本耗尽则取到末尾。 */
export function takeRound(script: readonly ModelOutput[], cursor: number): { outputs: ModelOutput[]; next: number } {
  const outputs: ModelOutput[] = [];
  let i = cursor;
  for (; i < script.length; i++) {
    outputs.push(script[i]);
    if (script[i].type === "tool_call") {
      i += 1; // 这一轮到 tool_call 为止，剩下的下轮再给
      break;
    }
  }
  return { outputs, next: i };
}

/** 明卷 provider：按轮吐冻结剧本（跑完即空 = 任务结束），语义与 createRoundTransport 同一条链。 */
export function createRoundScriptedProvider(scriptPath: string): Provider {
  let script: ModelOutput[] | null = null;
  let cursor = 0;
  return {
    async *stream() {
      if (!script) script = await loadScriptOutputs(scriptPath);
      if (cursor >= script.length) return;
      const round = takeRound(script, cursor);
      cursor = round.next;
      for (const output of round.outputs) yield output;
    },
  };
}
