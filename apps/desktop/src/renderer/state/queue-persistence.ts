import type { MutableRefObject } from "react";
import { takeQueued, toSessionQueueEntries, type QueuedSend } from "../send-queue";
import { runKey } from "./session-identity";

/** desired 队列保留在窗口内；写入/出队共享串行链，失败不能把消息当成已落盘。 */
export function createQueuePersistence(deps: {
  sendQueue: MutableRefObject<Map<string, QueuedSend[]>>;
  queueWrites: MutableRefObject<Map<string, Promise<unknown>>>;
  queueDirty: MutableRefObject<Set<string>>;
  setQueueLocal: (key: string, list: QueuedSend[]) => void;
  setLastError: (message: string, sid?: string) => void;
  changed: () => void;
}) {
  const failed = new Set<string>();
  const update = (key: string, list: QueuedSend[]) => {
    deps.queueDirty.current.add(key);
    deps.setQueueLocal(key, list);
  };
  const serialize = <T,>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = deps.queueWrites.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    deps.queueWrites.current.set(key, next); deps.changed();
    const cleanup = () => {
      if (deps.queueWrites.current.get(key) === next) {
        deps.queueWrites.current.delete(key); deps.changed();
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  };
  const persist = async (sid: string, workspace: string | null, key: string): Promise<boolean> => {
    const snapshot = deps.sendQueue.current.get(key);
    try {
      const result = await window.agent.queueSet(sid, toSessionQueueEntries(snapshot ?? []), workspace ?? undefined);
      if (!result.ok) throw new Error(result.error ?? "未知错误");
      failed.delete(key);
      if (deps.sendQueue.current.get(key) === snapshot) deps.queueDirty.current.delete(key);
      return true;
    } catch (error) {
      failed.add(key);
      deps.setLastError(`发送队列保存失败，未保存的更改已保留在本窗口：${error instanceof Error ? error.message : String(error)}`, sid);
      return false;
    }
  };
  const setQueueFor = (sid: string, list: QueuedSend[], workspace: string | null): Promise<boolean> => {
    const key = runKey(workspace, sid);
    update(key, list);
    return serialize(key, () => persist(sid, workspace, key));
  };
  const takeQueuedHead = (sid: string, workspace: string | null, retry = false): Promise<QueuedSend | null> => {
    const key = runKey(workspace, sid);
    return serialize(key, async () => {
      if (failed.has(key) && (!retry || !(await persist(sid, workspace, key)))) return null;
      const { head, rest } = takeQueued(deps.sendQueue.current.get(key) ?? []);
      if (head === null) return null;
      update(key, rest);
      if (await persist(sid, workspace, key)) return head;
      // 同一笔保存等待期间还可入队；恢复队首时合并最新 desired 列表，不用旧快照覆盖新消息。
      update(key, [head, ...(deps.sendQueue.current.get(key) ?? []).filter((item) => item.id !== head.id)]);
      return null;
    });
  };
  return { setQueueFor, takeQueuedHead };
}
