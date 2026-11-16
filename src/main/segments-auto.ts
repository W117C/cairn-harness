// 段的**自动触发点**（设计规格 §2 的 `compaction` 理由）：压缩之后，下一轮开新段。
//
// 为什么在「下一轮开始时」写、而不是在压缩那一刻写：
//  ① 会话日志有一条既有纪律——`compaction` 必须是日志的最后一条（三条判据钉着它）；
//     压缩那一刻再追加一条元数据补丁会当场把那条纪律踩掉。
//  ② 语义上也更准：压缩写的是「就地检查点」，真正「换段」发生在你要继续说下一句的时刻。
//
// 幂等：判据是「有效集合的最后一条是不是 compaction」——写完一条补丁之后最后一条就变成补丁，
// 同一个日志再跑一次不会重复开段（run 失败重试、进程重启都安全）。
import { createEventLog, replay, type AgentEvent } from "../events";
import { effectiveControlEntries } from "../events/projection";
import { openSegmentPatch } from "../agent/segments";

/**
 * 如果这份日志停在一次压缩上，就开新段（`segment_reason = compaction`）。
 * 返回新段序数；没开就返回 null（调用方据此决定要不要出声）。
 */
export async function openSegmentAfterCompaction(logPath: string): Promise<number | null> {
  const events = await replay(logPath).catch(() => [] as AgentEvent[]);
  if (events.length === 0) return null;
  const entries = effectiveControlEntries(events);
  const last = entries[entries.length - 1];
  if (last === undefined || last.event.type !== "compaction") return null;
  const patch = openSegmentPatch(events, "compaction");
  await createEventLog(logPath).append({ type: "session_meta_update", patch } as AgentEvent);
  return Number(patch.segment);
}
