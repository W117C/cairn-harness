// 段（设计规格 2026-11-16 §2 / ADR 0015 §五 的 P2 落地）。
//
// 一句话：**段不是文件，是一条事件的行号。** 开新段 = 追加一条 `session_meta_update`，
// `patch` 里带 `segment`（序数）与 `segment_reason`（为什么开）。
//
// 为什么能不新增存储面也不新增事件种类（三条都真）：
//  ① `patch` 是 `Record<string, string>`，缺席的键＝不变 ⇒ 加两个键不动类型面；
//  ② 投影只从**有效集合**累积补丁 ⇒ 回退（`session_rewind`）会把分界前的段一起回滚；
//  ③ `replay()` 逐字返回每一行 ⇒ 分界列表不需要别处存，也不会让「事件 id = 行号」失真。
//
// 读侧纪律（spec §7 的已知差距，别踩）：
//  · `session_meta_update.patch` 按键「最后写入生效」⇒ 它给得出**当前段**，
//    但给不出段列表。段列表必须扫事件（本模块 `segmentBoundaries` 就是干这个的）。
//  · 序数写坏（非正整数）**炸**：那是写侧违约，静默忽略会让「段」变成猜谜。
//  · `segment_reason` 写了个不认识的词**不炸**：spec §2 明写未知值按 `unknown` 记，
//    段仍然成立（分界是事实，理由只是注解）。
// effectiveControlEntries 只在 projection 模块导出（`../events` 的公开面逐字不变过，不替它扩面）。
import type { AgentEvent } from "../events";
import { effectiveControlEntries } from "../events/projection";

/** 段序数键。值必须是不小于 1 的十进制整数字符串。 */
export const SEGMENT_KEY = "segment";
/** 开段理由键。自由字符串，读侧校验。 */
export const SEGMENT_REASON_KEY = "segment_reason";

/** 开段的三种发起人（spec §2）。认不出的写侧取值一律归 `unknown`。 */
export const SEGMENT_REASONS = ["user", "steward_switch", "compaction"] as const;
export type SegmentReason = (typeof SEGMENT_REASONS)[number] | "unknown";

export interface SegmentBoundary {
  /** 分界所在事件的 1-based 行号（也就是事件 id）。 */
  eventId: number;
  /** 这条分界开启的段序数（≥ 2：第一段是隐式的）。 */
  segment: number;
  reason: SegmentReason;
}

/** 写侧理由 → 读侧词表；认不出 ⇒ `unknown`（不抛）。 */
export function segmentReasonOf(value: string | undefined): SegmentReason {
  if (value === undefined) return "unknown";
  return (SEGMENT_REASONS as readonly string[]).includes(value) ? (value as SegmentReason) : "unknown";
}

/** 序数字符串 → 正整数；写坏了就抛（写侧违约，见头注）。 */
function ordinalOf(raw: string, eventId: number): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      `session_meta_update（第 ${String(eventId)} 行）的 ${SEGMENT_KEY} 必须是 ≥1 的整数字符串，实测 ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw);
}

/**
 * 全部分界（按行号升序）。读**有效集合**：被回退砍掉的分界不算数，
 * 与「回退连同那次元数据改动一起不算数」是同一条语义。
 */
export function segmentBoundaries(events: readonly AgentEvent[]): SegmentBoundary[] {
  const out: SegmentBoundary[] = [];
  // 必须用 effectiveControlEntries：effectiveEntries 会把 session_meta_update 过滤掉（它是消息面）。
  for (const entry of effectiveControlEntries(events)) {
    const event = entry.event;
    if (event.type !== "session_meta_update") continue;
    const patch = event.patch;
    if (patch === null || typeof patch !== "object") continue;
    const raw = patch[SEGMENT_KEY];
    if (typeof raw !== "string") continue;
    out.push({
      eventId: entry.eventId,
      segment: ordinalOf(raw, entry.eventId),
      reason: segmentReasonOf(patch[SEGMENT_REASON_KEY]),
    });
  }
  return out;
}

/** 当前段序数；一条分界都没有时是第一段 ⇒ 1（隐式，不需要事件）。 */
export function currentSegment(events: readonly AgentEvent[]): number {
  const list = segmentBoundaries(events);
  return list.length === 0 ? 1 : list[list.length - 1]!.segment;
}

/**
 * 某一行的段序数：分界行本身**属于它开启的新段**（分界即新段的第一行）。
 * 早于第一条分界 ⇒ 1。
 */
export function segmentOf(events: readonly AgentEvent[], eventId: number): number {
  let segment = 1;
  for (const b of segmentBoundaries(events)) {
    if (b.eventId > eventId) break;
    segment = b.segment;
  }
  return segment;
}

/** 按段切片（只含消息事件，控制记录不进切片）。 */
export function segmentSlices(events: readonly AgentEvent[]): { segment: number; eventIds: number[] }[] {
  const boundaries = segmentBoundaries(events);
  const at = (eventId: number): number => {
    let segment = 1;
    for (const b of boundaries) {
      if (b.eventId > eventId) break;
      segment = b.segment;
    }
    return segment;
  };
  const out = new Map<number, number[]>();
  for (const entry of effectiveControlEntries(events)) {
    const type = entry.event.type;
    // 控制记录不是对话内容：段切片只装「这一段说了什么」。
    if (type === "session_meta_update" || type === "session_rewind") continue;
    const segment = at(entry.eventId);
    const bucket = out.get(segment);
    if (bucket === undefined) out.set(segment, [entry.eventId]);
    else bucket.push(entry.eventId);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([segment, eventIds]) => ({ segment, eventIds }));
}

/**
 * 写侧 helper：开新段的补丁。理由必须是三值之一（写侧不给 `unknown`——那是读侧的兜底）。
 * 只返回 patch；落盘仍走既有 `session_meta_update` 的追加路径（单一写者、单一真源都不变）。
 */
export function segmentPatch(segment: number, reason: Exclude<SegmentReason, "unknown">): Record<string, string> {
  if (!Number.isInteger(segment) || segment < 1) {
    throw new Error(`段的序数必须是 ≥1 的整数，实测 ${String(segment)}`);
  }
  if (!(SEGMENT_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`段理由必须是 ${SEGMENT_REASONS.join(" / ")}，实测 ${String(reason)}`);
  }
  return { [SEGMENT_KEY]: String(segment), [SEGMENT_REASON_KEY]: reason };
}
