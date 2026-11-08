// 上下文容量分解（2026-11-04 业主截图形制）：把「上一轮实际带进去的 token」按来源拆成
// 消息 / 工具 / 技能 / 记忆 / 系统提示词 / 其他 六桶，给分段条与图例用。
//
// 口径与 UsageMeter.contextBudget 同源：总桶 = lastInputTokens（上一轮实际输入——正是下一轮
// 要带的上下文）。分桶估算走字符占比：surface_account 记了四个固定块的字符数（工具面 /
// 系统提示词 / 技能块 / 记忆块），消息侧字符从事件流现算（真实流式会话只有 delta、没有
// assistant_message——以 2026-11-03 agnes 会话日志实查为准）；换算系数 K = 总 token ÷ 总字符
// （同一请求同一种语言混合，按比例摊派是这套显示面的诚实近似——面板注明「估算」）。
// 其他 = 符号地图 + 附件引用 + 进化注入 + 取整残差。
import type { AgentEvent } from "../../../../src/events";

export type ContextShareKey = "messages" | "tools" | "skills" | "memory" | "system" | "other";

export interface ContextShare {
  key: ContextShareKey;
  /** 估算 token 数（面板注明估算；不冒充精确值）。文案名在 strings.ts（ctxBucket*），不在这里。 */
  tokens: number;
  /** 占总桶的百分比（1 位小数；合计恒 = 100——残差归消息桶）。 */
  pct: number;
}

export interface ContextBreakdown {
  shares: readonly ContextShare[];
  /** 上一轮实际输入（总桶）。 */
  used: number;
}

/** 消息侧字符：user_message + assistant_delta + tool_result.output。
 *  流式会话没有 assistant_message（实查 2026-11-03 日志），非流式会话两者不并存——
 *  两类都数会在非流式会话把同一段话数两遍？不会：非流式会话不发 delta（loop 逐字落实）。 */
export function transcriptCharsOf(events: readonly AgentEvent[]): number {
  let chars = 0;
  // 落盘日志不受类型担保（旧日志/外部导入可缺字段）：与 derived/stream.ts 同口径，
  // 字段不是字符串就不计——这是用量浮层的估算，不许为它把整个会话面炸成错误边界。
  const len = (v: unknown): number => (typeof v === "string" ? v.length : 0);
  for (const e of events) {
    if (e.type === "user_message") chars += len(e.content);
    else if (e.type === "assistant_delta") chars += len(e.text);
    else if (e.type === "tool_result") chars += len(e.output);
  }
  return chars;
}

/** 取最后一条 surface_account（每轮请求前都记，最后一条 = 上一轮的实际送出面）。 */
function lastSurface(events: readonly AgentEvent[]): {
  sentToolSpecChars: number; baseSystemChars: number; memoryChars: number;
  skillsBlockChars: number; mapChars: number; attachmentContextChars: number;
} | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "surface_account") {
      return {
        sentToolSpecChars: e.sentToolSpecChars ?? 0,
        baseSystemChars: e.baseSystemChars ?? 0,
        memoryChars: e.memoryChars ?? 0,
        skillsBlockChars: e.skillsBlockChars ?? 0,
        mapChars: e.mapChars ?? 0,
        attachmentContextChars: e.attachmentContextChars ?? 0,
      };
    }
  }
  return null;
}

export function contextBreakdown(
  events: readonly AgentEvent[],
  lastInputTokens: number,
): ContextBreakdown | null {
  if (lastInputTokens <= 0) return null;
  const surface = lastSurface(events);
  const transcript = transcriptCharsOf(events);
  // 没有 surface_account（老会话/未跑过）⇒ 消息桶吃满，不给假分解。
  if (surface === null) {
    return { shares: [{ key: "messages", tokens: lastInputTokens, pct: 100 }], used: lastInputTokens };
  }
  const otherChars = surface.mapChars + surface.attachmentContextChars;
  const allChars = transcript + surface.sentToolSpecChars + surface.baseSystemChars
    + surface.skillsBlockChars + surface.memoryChars + otherChars;
  if (allChars <= 0) return null;
  const k = lastInputTokens / allChars;
  // 固定桶先取整；「消息」作为最大的桶吃掉全部取整残差 ⇒ 图例合计恒等于总桶（截图里
  // 71.7+14.7+11.4+1.2+0.7+0.3 = 100.0 那种读法）。pct 也从残差后的 token 重算，不自说自话。
  const other = Math.round(otherChars * k);
  const tools = Math.round(surface.sentToolSpecChars * k);
  const skills = Math.round(surface.skillsBlockChars * k);
  const memory = Math.round(surface.memoryChars * k);
  const system = Math.round(surface.baseSystemChars * k);
  const messages = Math.max(0, lastInputTokens - other - tools - skills - memory - system);
  const pctOf = (tokens: number): number => Math.round((tokens / lastInputTokens) * 1000) / 10;
  const shares = [
    { key: "messages" as const, tokens: messages, pct: pctOf(messages) },
    { key: "tools" as const, tokens: tools, pct: pctOf(tools) },
    { key: "skills" as const, tokens: skills, pct: pctOf(skills) },
    { key: "memory" as const, tokens: memory, pct: pctOf(memory) },
    { key: "system" as const, tokens: system, pct: pctOf(system) },
    { key: "other" as const, tokens: other, pct: pctOf(other) },
  ];
  return { shares, used: lastInputTokens };
}
