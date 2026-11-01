// 发送队列条的在场面：读的是「当前会话」的队列表（限定键），写回也走同一个键。
//
// ⚠️ 2026-10-28（第 750 页）：读队列表必须与写**同键**——写方 `setQueueFor` 用
// `runKey(workspace, sid)`（限定键），曾经这里按**裸 sid** 读 ⇒ 读到 undefined ⇒ `?? []`
// ⇒ `promoteQueued([], i)` 得 `[]` ⇒ 写回空表 ⇒ **整条队列被静默清空**。
// 从现在起：本文件所有 `queue.current.get` 都只吃 `runKey(...)`；改动请同步跑 queue-key 判卷。
import type { MutableRefObject } from "react";
import { dropQueued, editQueued, moveQueued, promoteQueued, type QueuedSend } from "../send-queue";
import { runKey } from "../state/session-identity";
import { SendQueueStrip } from "../components/SendQueueStrip";

export function QueueDock(props: {
  activeId: string;
  activeWorkspace: string | null;
  queue: MutableRefObject<Map<string, QueuedSend[]>>;
  running: boolean;
  queueLoading: boolean;
  queueSaving?: boolean;
  queueSaveFailed?: boolean;
  pendingSend: boolean;
  pendingClarify: unknown;
  pendingPlan: unknown;
  setQueueFor: (sid: string, list: QueuedSend[], workspace?: string | null) => void;
  cancelRunHeal: (sid: string, workspace?: string | null) => void;
  resumeQueueFor: (sid: string, workspace?: string | null) => void;
}) {
  // 打断并发送 / 移出 / 编辑：都按目标会话的限定键读当前表，再交给纯函数改一条。
  const items = props.queue.current.get(runKey(props.activeWorkspace, props.activeId)) ?? [];
  const blocked = props.queueLoading || props.queueSaving === true;
  const editAt = (index: number, change: (list: QueuedSend[], at: number) => QueuedSend[]): boolean => {
    const sid = props.activeId;
    if (blocked) return false;
    const key = runKey(props.activeWorkspace, sid);
    const id = items[index]?.id;
    const current = props.queue.current.get(key) ?? [];
    const at = current.findIndex((item) => item.id === id);
    if (id === undefined || at < 0) return false;
    props.setQueueFor(sid, change(current, at), props.activeWorkspace);
    return true;
  };
  return (
    <SendQueueStrip
      items={items}
      running={props.running}
      disabled={blocked}
      saving={props.queueSaving}
      saveFailed={props.queueSaveFailed}
      onRetrySave={() => {
        if (!blocked) props.setQueueFor(props.activeId, props.queue.current.get(runKey(props.activeWorkspace, props.activeId)) ?? [], props.activeWorkspace);
      }}
      onInterruptSend={(index) => {
        if (blocked) return;
        /** 「打断并发送」：先把它提到队首，再打断本轮——收束在轮界，runOn 随即先派它。
         *  打断走 cancelRunHeal：陈旧旗（main 无在跑）时摘旗并把这条当场派出去，不再是死点。 */
        if (editAt(index, (list, at) => promoteQueued(list, at))) props.cancelRunHeal(props.activeId, props.activeWorkspace);
      }}
      onRemove={(index) => { editAt(index, (list, at) => dropQueued(list, at)); }}
      onEdit={(index, text) => { editAt(index, (list, at) => editQueued(list, at, text)); }}
      onMove={(index, delta) => { editAt(index, (list, at) => moveQueued(list, at, delta)); }}
      {...(!props.running && !blocked && !props.pendingSend && props.pendingClarify === null && props.pendingPlan === null
        ? { onResume: () => { props.resumeQueueFor(props.activeId, props.activeWorkspace); } }
        : {})}
    />
  );
}
