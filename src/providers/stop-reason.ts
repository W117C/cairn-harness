// 三家的「这一轮为什么停了」 vocabulary 解码器（§3.3 provider 协议层）。
// 这个字段一直在线上（fixtures/providers/**/*.sse 逐字记着 end_turn / stop / STOP / tool_use），
// 但四个适配器只声明了类型、从不读它 ⇒ 被 max_tokens 拦腰砍断的一轮与答完的一轮
// 在事件流里长得一模一样，loop 据「有没有 tool_call」判定任务结束，于是截断＝成功。
import type { TurnTruncatedEvent } from "../events";

/** 归一化后的单轮收尾结局。 */
export type TurnOutcome =
  /** 模型自己认为答完了（或命中 stop_sequence）。 */
  | "completed"
  /** 本轮以工具调用收尾——不是终态，loop 会继续。 */
  | "tool_use"
  /** 输出预算到点，正文被拦腰砍断。 */
  | "output_budget"
  /** 内容策略拦停（拒绝 / 审查 / 安全）。 */
  | "content_blocked"
  /** 词表里没有：可能是新 provider，也可能上游自己加了值——不猜。 */
  | "unknown";

// 键一律小写：Anthropic/OpenAI 用 lower_snake，Gemini 用 UPPER_SNAKE，一家一个大小写体系，
// 不归一就得为每家维护两份表。
const OUTCOMES: Readonly<Record<string, TurnOutcome>> = {
  // 正常收尾
  end_turn: "completed", // anthropic
  stop_sequence: "completed", // anthropic：命中调用方给的停止序列，正文是完整的
  stop: "completed", // openai / glm
  // 工具调用
  tool_use: "tool_use", // anthropic
  tool_calls: "tool_use", // openai / glm
  function_call: "tool_use", // gemini 旧形态
  // 输出预算
  max_tokens: "output_budget", // anthropic
  length: "output_budget", // openai / glm
  // 内容策略
  refusal: "content_blocked", // anthropic
  content_filter: "content_blocked", // openai / glm
  safety: "content_blocked", // gemini
  blocklist: "content_blocked", // gemini
  prohibited_content: "content_blocked", // gemini
  recitation: "content_blocked", // gemini
  spi: "content_blocked", // gemini
};

/** 把 provider 原生停止原因解码成中立结局。缺失 / 非字符串 / 未收录 → "unknown"。 */
export function normalizeStopReason(raw: unknown): TurnOutcome {
  if (typeof raw !== "string") return "unknown";
  const key = raw.trim().toLowerCase();
  if (key === "") return "unknown";
  return OUTCOMES[key] ?? "unknown";
}

/** 「没说完就被收走」的两种（也是仅有两种）可判原因——turn_truncated 事件的 outcome 真身。 */
export type TurnTruncation = "output_budget" | "content_blocked";

/** 这一轮是不是「没说完就被收走」，是哪一种。
 *  tool_use 与 unknown 都返回 null：前者本来就还要继续，后者是「不知道」不是「知道它坏了」，
 *  把不知道说成坏就是自造证据。 */
export function truncationOf(raw: unknown): TurnTruncation | null {
  const o = normalizeStopReason(raw);
  return o === "output_budget" || o === "content_blocked" ? o : null;
}

/** 三个适配器共用的那一跳：把「停止原因」折成证据事件，正常收尾返回 null（不落、不多一个字节）。
 *  刻意收在这里而不让各家自己拼 payload——一份政策两份实现，其中一支迟早悄悄少做几件事
 *  （sidechat 与 worker 回传的输出扫描就是这么撞车的，见 worker-report.scanModelOutput）。 */
export function turnTruncatedEvent(
  callId: string,
  raw: unknown,
  outputTokens?: number | null,
): TurnTruncatedEvent | null {
  const outcome = truncationOf(raw);
  if (outcome === null || typeof raw !== "string") return null;
  // 第二支运行时是冗余的（truncationOf 已证明过），但 TS 不能穿过返回值收窄 raw，
  // 去掉它下面 raw.trim() 就不过编译——留着，别当重复守卫删。
  const tokens = asTokenCount(outputTokens);
  return {
    type: "turn_truncated",
    callId,
    outcome,
    // 存 trim 后的原文，不存未 trim 的线上值：查表只保证 trim+小写后的值在表内，
    // 原文可以带任意空白。大小写**故意保留**——max_tokens 与 MAX_TOKENS 是两家的不同观测。
    // 这条事件是模型可见文本（投影与摘要输入都会读它），不剪就等于把长度交给网关心情。
    stop_reason: raw.trim(),
    ...(tokens !== null ? { output_tokens: tokens } : {}),
  };
}

/** 线上 JSON 的数字字段没有编译期保证：`?? 0` 会把字符串原样放过（gemini 那行的 `+` 于是变拼接）。
 *  这个数会被拼进摘要输入的**散文行**（compaction.serializeConversation），非有限值等于让上游
 *  往滚动摘要里塞任意文本 ⇒ 宁可缺字段，也不存一个不能当数用的值。 */
function asTokenCount(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}
