// 来源视图 → 模型协议投影（ADR 0005 产品接入 · Task 2）。
//
// 为什么不能直接 `projectContext(view.entries.map(e => e.event))`：projectContext 按**数组位置**
// 解释旧的 `compressed_event_ids` / `summary_offset`，而来源视图里「父第 2 行」与「子第 2 行」是两格。
// 本文件先把视图**编译**成一份 raw 形状的合成事件表：
//   · 跨来源的摘除/锚点先按 EventRef 解释，再换成合成表里的位置（位置只活在本函数内）；
//   · tool-call 的 wire id 按来源限定（父/子同 raw id 不串），raw id 不改；
//   · 之后交给 `projectContext` 走原来那套消息整形（delta 合并、孤儿收束、自动验证拍……）。
// 合成表与 wire id **只存在于模型投影**，不写回任何日志。
import {
  eventRefKey, isEventRef, isNumericCompaction, isReferencedCompaction,
  type AgentEvent, type CompactionEvent, type EventRef, type SessionView, type SessionViewEntry,
} from "../events";
import { projectContext, type ContextMessage } from "./context";

const fail = (message: string): never => { throw new Error(`来源视图投影失败（fail closed）：${message}`); };

/** 压缩记录的形状校验：新旧字段互斥，来源形式必须整套在场。 */
function validateCompaction(e: CompactionEvent, where: string): void {
  const hasRefFields = "reference_version" in e || "compressed_event_refs" in e ||
    "summary_anchor" in e || "superseded_summary_refs" in e;
  const hasNumericFields = "compressed_event_ids" in e || "summary_offset" in e;
  if (hasRefFields && hasNumericFields) fail(`${where} 新旧压缩字段混用`);
  if (hasRefFields) {
    if (!isReferencedCompaction(e)) return fail(`${where} reference_version 必须是 1（未知版本）`);
    const compressed = e.compressed_event_refs;
    const supersededRefs = e.superseded_summary_refs;
    if (!Array.isArray(compressed) || !Array.isArray(supersededRefs)) {
      return fail(`${where} 缺少 compressed_event_refs / superseded_summary_refs`);
    }
    for (const ref of [...compressed, ...supersededRefs]) {
      if (!isEventRef(ref)) return fail(`${where} 含坏 EventRef：${JSON.stringify(ref)}`);
    }
    const anchor = e.summary_anchor;
    const ok = anchor !== null && typeof anchor === "object" &&
      (("end" in anchor && anchor.end === true) || ("before" in anchor && isEventRef(anchor.before)));
    if (!ok) return fail(`${where} summary_anchor 形状不合法`);
    return;
  }
  if (!isNumericCompaction(e) || !Array.isArray(e.compressed_event_ids) || !Number.isSafeInteger(e.summary_offset)) {
    return fail(`${where} 既不是完整旧数字形式，也不是完整来源形式`);
  }
}

interface Latest {
  entry: SessionViewEntry;
  event: CompactionEvent;
  index: number;
}

interface CompiledView {
  events: AgentEvent[];
  replacements: Map<number, string> | undefined;
}

/** 把一份来源视图编译成 raw 形状的事件表 + 按合成位置索引的替换表。 */
function compileView(view: SessionView, replacements?: ReadonlyMap<string, string>): CompiledView {
  const keys = view.entries.map((entry) => eventRefKey(entry.ref));
  const indexByKey = new Map<string, number>();
  keys.forEach((key, index) => { if (!indexByKey.has(key)) indexByKey.set(key, index); });

  const compactions: Latest[] = [];
  view.entries.forEach((entry, index) => {
    if (entry.event.type !== "compaction") return;
    if (typeof entry.event.agent_id === "string" && entry.event.agent_id !== "") return; // worker 压缩不影响主投影
    validateCompaction(entry.event, `compaction@${keys[index]!}`);
    compactions.push({ entry, event: entry.event, index });
  });

  // 被更新的摘要取代掉的旧摘要（来源形式显式列出）。
  const superseded = new Set<string>();
  for (const { event } of compactions) {
    if (isReferencedCompaction(event)) for (const ref of event.superseded_summary_refs) superseded.add(eventRefKey(ref));
  }

  const excluded = new Set<number>();
  for (const { entry, event, index } of compactions) {
    if (isNumericCompaction(event)) {
      const own = entry.ref.sessionId;
      const ids = new Set(event.compressed_event_ids);
      view.entries.forEach((candidate, at) => {
        if (at === index) return; // 压缩本体永不被压
        if (candidate.ref.sessionId !== own) return; // 旧数字形式只解释本文件的行号
        if (candidate.event.type === "compaction") return; // 旧 compaction 事件不被新压缩吞掉
        if (ids.has(candidate.ref.eventId)) excluded.add(at);
      });
      continue;
    }
    for (const ref of event.compressed_event_refs) {
      const at = indexByKey.get(eventRefKey(ref));
      if (at === undefined) fail(`compressed_event_refs 指向视图外的事件：${eventRefKey(ref)}`);
      if (at === index || view.entries[at!]!.event.type === "compaction") fail(`compressed_event_refs 指向压缩本体：${eventRefKey(ref)}`);
      excluded.add(at!);
    }
  }

  // 最新一份未被取代的摘要 + 锚点（锚点 = 合成表里「在它之前注入」的原始 entry 下标，或末尾）。
  let latest: Latest | null = null;
  for (const item of compactions) if (!superseded.has(keys[item.index]!)) latest = item;
  let anchorAt: number | "end" | null = null;
  if (latest !== null) {
    if (isNumericCompaction(latest.event)) {
      anchorAt = resolveNumericAnchor(view, excluded, latest.entry.ref.sessionId, latest.event.summary_offset);
    } else {
      const anchor = latest.event.summary_anchor;
      if ("end" in anchor) anchorAt = "end";
      else {
        const at = indexByKey.get(eventRefKey(anchor.before));
        if (at === undefined) fail(`summary_anchor 指向视图外的事件：${eventRefKey(anchor.before)}`);
        if (excluded.has(at!)) fail(`summary_anchor 指向被本记录摘除的事件：${eventRefKey(anchor.before)}`);
        anchorAt = at!;
      }
    }
  }

  // 合成表：被摘除的事件不出现；压缩事件本体不出现（其效果 = 摘要 + 摘除）。
  const wire = wireIds(view);
  const out: AgentEvent[] = [];
  const replacementIndex = new Map<number, string>();
  const injectAt = anchorAt === "end" ? view.entries.length : anchorAt;
  let injected = false;
  let syntheticAt = -1;
  view.entries.forEach((entry, index) => {
    if (entry.event.type === "compaction") return;
    if (excluded.has(index)) return;
    if (!injected && injectAt !== null && index >= injectAt) {
      syntheticAt = out.length;
      out.push(placeholderCompaction(latest!));
      injected = true;
    }
    out.push(wire(entry));
    const replaced = replacements?.get(keys[index]!);
    if (replaced !== undefined) replacementIndex.set(out.length, replaced);
  });
  if (!injected && latest !== null) {
    syntheticAt = out.length;
    out.push(placeholderCompaction(latest));
  }
  if (syntheticAt >= 0) {
    // projectContext 只读最新一条 compaction 的 summary_offset ⇒ 用它在合成表里的 1-based 位置。
    out[syntheticAt] = { ...(out[syntheticAt] as import("../events").NumericCompaction), summary_offset: syntheticAt + 1 };
  }
  return { events: out, replacements: replacementIndex.size > 0 ? replacementIndex : undefined };
}

function resolveNumericAnchor(view: SessionView, excluded: Set<number>, sessionId: string, offset: number): number | "end" {
  for (let i = 0; i < view.entries.length; i++) {
    const entry = view.entries[i]!;
    if (entry.ref.sessionId !== sessionId) continue;
    if (entry.event.type === "compaction") continue;
    if (entry.ref.eventId < offset) continue;
    if (excluded.has(i)) continue;
    return i;
  }
  return "end";
}

/** 合成表里的摘要占位：摘除已在编译时完成，所以 `compressed_event_ids` 为空。 */
function placeholderCompaction(latest: Latest): CompactionEvent {
  return {
    type: "compaction", trigger: latest.event.trigger, reason: latest.event.reason,
    compressed_event_ids: [],
    summary: latest.event.summary,
    summary_offset: 0,
    tokens_before: latest.event.tokens_before, tokens_after: latest.event.tokens_after,
  };
}

/** tool-call wire id：按「工作区 + 来源会话 + agent 域 + 原始 id」限定。
 *  单文件视图（无继承）保持原 id，零行为变化；有继承时父/子同 raw id 必须分开。 */
function wireIds(view: SessionView): (entry: SessionViewEntry) => AgentEvent {
  const sourced = view.entries.some((entry) => entry.inherited);
  if (!sourced) return (entry) => entry.event;
  const domain = (agentId: string | undefined): string => agentId ?? "";
  const keyOf = (ref: EventRef, agentId: string | undefined, raw: string): string =>
    JSON.stringify([ref.workspace, ref.sessionId, domain(agentId), raw]);
  const byKey = new Map<string, string>();
  view.entries.forEach((entry) => {
    const e = entry.event;
    if (e.type !== "tool_call") return;
    const raw = e.id;
    byKey.set(keyOf(entry.ref, e.agent_id, raw), `toolu:${keyOf(entry.ref, e.agent_id, raw)}`);
  });
  return (entry) => {
    const e = entry.event;
    if (e.type === "tool_call") {
      const id = byKey.get(keyOf(entry.ref, e.agent_id, e.id)) ?? e.id;
      return { ...e, id };
    }
    if (e.type === "tool_result") {
      const id = byKey.get(keyOf(entry.ref, e.agent_id, e.callId)) ?? `toolu:${keyOf(entry.ref, e.agent_id, e.callId)}`;
      return { ...e, callId: id };
    }
    return e;
  };
}

/** 组装来源视图的模型历史。替换键 = `eventRefKey`（跨来源的裁剪不会误伤同号事件）。 */
export function projectViewContext(
  view: SessionView,
  replacements?: ReadonlyMap<string, string>,
): ContextMessage[] {
  const resolved = compileView(view, replacements);
  return projectContext(resolved.events, resolved.replacements);
}
