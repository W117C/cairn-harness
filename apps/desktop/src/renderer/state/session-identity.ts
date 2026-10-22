// 渲染层的会话/事件身份键（计划 Task 5）。
// 键必须与 core 同族（JSON 元组）：`session id` 在两个已登记工作区里可能同名，
// 只用 id 做 map/timer 的键会把 A 的迟到状态写进 B。工作区未知时**不生成裸 id 键**（返回 null）。
import { eventRefKey, sessionRefKey } from "../../../../../src/events/session-ref";
import type { EventRef, SessionRef } from "../../../../../src/events";

export { eventRefKey, sessionRefKey };

/** 有可信 workspace 才给键；缺省/空工作区返回 null（调用方必须走「无键不写」的支路）。 */
export function sessionKeyOf(workspace: string | null | undefined, sessionId: string | null | undefined): string | null {
  if (workspace === null || workspace === undefined || workspace === "") return null;
  if (sessionId === null || sessionId === undefined || sessionId === "") return null;
  return sessionRefKey({ workspace, sessionId });
}

export function refOf(workspace: string | null | undefined, sessionId: string): SessionRef | null {
  if (workspace === null || workspace === undefined || workspace === "") return null;
  return { workspace, sessionId };
}

/** 行级 DOM/跳转键：有来源引用就用事件引用，否则退回显示序号（旧行为）。 */
export function rowKeyOf(seq: number, ref: EventRef | null | undefined): string {
  return ref === null || ref === undefined ? `s${String(seq)}` : `e${eventRefKey(ref)}`;
}

/** 祖先行：来源会话与当前本地会话不同（或显式标了 inherited）。 */
export function isInheritedRef(current: SessionRef | null, ref: EventRef | null | undefined): boolean {
  if (ref === null || ref === undefined || current === null) return false;
  return ref.workspace !== current.workspace || ref.sessionId !== current.sessionId;
}

/** 活动会话的迟到事件：同名 id、但来自另一个已登记工作区 ⇒ 不得写进当前转录/运行灯。
 *  推送不带 workspace（旧 host）时返回 false —— 保持旧行为，不靠猜。 */
export function isStaleForActive(args: {
  activeId: string | null;
  activeWorkspace: string | null;
  eventSessionId: string | undefined;
  eventWorkspace: string | undefined;
}): boolean {
  const { activeId, activeWorkspace, eventSessionId, eventWorkspace } = args;
  if (activeId === null || eventSessionId !== activeId) return false;
  if (eventWorkspace === undefined || eventWorkspace === "" || activeWorkspace === null) return false;
  return eventWorkspace !== activeWorkspace;
}

/** 运行/结果等状态 map 的键：有 workspace 用 ref 键，没有就退回裸 id（旧行为）。 */
export function runKey(workspace: string | null | undefined, sessionId: string): string {
  return sessionKeyOf(workspace, sessionId) ?? sessionId;
}

/** 注释锚点（反馈/置顶）：本地行只有 eventId，祖先行带来源引用。 */
export interface AnchoredEvent { eventId: number; eventRef?: EventRef }

/** 注释的解析键：有来源用 eventRefKey，否则 `#eventId`（旧数字记录按 owner 自己的行号解释）。 */
export function anchorKeyOf(anchor: AnchoredEvent): string {
  return anchor.eventRef === undefined ? `#${String(anchor.eventId)}` : eventRefKey(anchor.eventRef);
}
