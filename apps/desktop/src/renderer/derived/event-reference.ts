// 来源视图 → 渲染行（计划 Task 5 · 派生层：纯函数，不读 IO/时钟）。
//
// 分叉会话的转录 = 视图里的祖先前缀 + 本地有效历史 + **快照之后新到的本地事件**。
// 快照的水位是 `localEvents.length`：实时事件的物理行号从它往后推，不用合成历史的长度
// （否则父前缀一变，所有本地行的反馈锚点都漂）。
import type { AgentEvent, EventRef, SessionView } from "../../../../../src/events";

export interface ReferencedEvent {
  event: AgentEvent;
  /** 该事件在**所属文件**里的物理行号（父第 2 行与子第 2 行是两格）。 */
  ref: EventRef;
  /** true = 来自祖先文件（不是本地会话自己的行）。 */
  inherited: boolean;
}

/** 视图快照 + 实时本地事件（含快照时刻的本地部分）→ 带来源的事件序列。
 *  `liveLocal` 的前 `view.localEvents.length` 条与快照重复，只取尾部增量。 */
export function mergeViewEvents(view: SessionView, liveLocal: readonly AgentEvent[]): ReferencedEvent[] {
  const out: ReferencedEvent[] = view.entries.map((entry) => ({
    event: entry.event,
    ref: entry.ref,
    inherited: entry.inherited,
  }));
  const watermark = view.localEvents.length;
  for (let index = watermark; index < liveLocal.length; index++) {
    out.push({
      event: liveLocal[index]!,
      ref: { workspace: view.session.workspace, sessionId: view.session.sessionId, eventId: index + 1 },
      inherited: false,
    });
  }
  return out;
}

/** 显示序（mergeViewEvents 的下标）→ 来源引用；渲染行按 seq 取它。 */
export function refsByDisplayIndex(merged: readonly ReferencedEvent[]): ReadonlyMap<number, EventRef> {
  const out = new Map<number, EventRef>();
  merged.forEach((entry, index) => out.set(index, entry.ref));
  return out;
}

/** 祖先行的显示序集合（渲染层据此挂「来自 …」来源标记）。 */
export function inheritedDisplayIndexes(merged: readonly ReferencedEvent[]): ReadonlySet<number> {
  const out = new Set<number>();
  merged.forEach((entry, index) => { if (entry.inherited) out.add(index); });
  return out;
}

/** 某显示序的物理引用（缺省 null）。 */
export function refAt(merged: readonly ReferencedEvent[], index: number): EventRef | null {
  return merged[index]?.ref ?? null;
}
