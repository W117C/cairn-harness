// 段的**写入点**（设计规格 §2；这是「段」第一次有真调用方）。
//
// 语义：开新段 = 往会话事件日志追加一条 `session_meta_update`（`segment` + `segment_reason`）。
// 序数由**日志本身**算（`openSegmentPatch` 读现有事件 +1），写侧不记状态——单一真源。
//
// 纪律：
//  · 写走 `withSessionMutation`（与会话重命名/分叉同一把锁），不绕过单一写者；
//  · 会话 id 与工作区都过既有校验（`sessionIdProblem`），不自己造一套；
//  · 空会话不接受开段（没有历史就没有「下一段」可言）。
import { createEventLog, type AgentEvent } from "../../../../src/events";
import { openSegmentPatch, type SegmentReason } from "../../../../src/agent/segments";
import { pathOf, readSessionEvents, sessionIdProblem } from "../../../../src/main/sessions";
import { withSessionMutation } from "../../../../src/main/session-mutation-lock";

export interface OpenSegmentResult {
  ok: boolean;
  segment?: number;
  error?: string;
}

export async function openSegmentForSession(
  sessionsRoot: string,
  sessionId: string,
  reason: Exclude<SegmentReason, "unknown"> = "user",
): Promise<OpenSegmentResult> {
  const problem = sessionIdProblem(sessionId);
  if (problem !== null) return { ok: false, error: problem };
  return await withSessionMutation(sessionsRoot, async () => {
    const events = await readSessionEvents(sessionsRoot, sessionId);
    if (events.length === 0) return { ok: false, error: "会话还没有历史，不能开新段" };
    const patch = openSegmentPatch(events, reason);
    await createEventLog(pathOf(sessionsRoot, sessionId)).append({ type: "session_meta_update", patch } as AgentEvent);
    return { ok: true, segment: Number(patch.segment) };
  });
}
