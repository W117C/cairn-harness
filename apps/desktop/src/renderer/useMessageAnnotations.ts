import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anchorKeyOf, runKey, type AnchoredEvent } from "./state/session-identity";

type MarkState<Value> = {
  identity: string | null;
  values: ReadonlyMap<string, Value>;
  pending: ReadonlySet<string>;
  loading: boolean;
};
type MarkSource<Value> = {
  label: string;
  load: (sessionId: string, workspace: string | undefined) => Promise<ReadonlyMap<string, Value>>;
  save: (sessionId: string, anchor: AnchoredEvent, value: Value | undefined, workspace: string | undefined) => Promise<{ ok: boolean; error?: string }>;
};
type ReportError = (message: string, sessionId?: string, workspace?: string | null) => void;

/** 两类消息标记共用归属、读写与逐条回滚；同一条标记有请求时禁止重复提交。
 *  workspace 跟着会话走：同 id 跨工作区时主进程按显式根做存在性检查（缺 workspace 只能靠归属
 *  解析，歧义即拒——标记落不下）；sidecar 本身是 host 级存储，不因根不同而分家。 */
function useSessionMarks<Value>(sessionId: string | null, workspace: string | null, source: MarkSource<Value>, onError: ReportError) {
  const identity = sessionId === null ? null : runKey(workspace, sessionId);
  const [state, setState] = useState<MarkState<Value>>({ identity: null, values: new Map(), pending: new Set(), loading: true });
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  useEffect(() => {
    const version = ++generation.current;
    locks.current.clear();
    setState({ identity, values: new Map(), pending: new Set(), loading: identity !== null });
    if (sessionId !== null) {
      void source.load(sessionId, workspace ?? undefined).then((values) => {
        if (generation.current === version) setState({ identity, values, pending: new Set(), loading: false });
      }).catch((error: unknown) => {
        if (generation.current !== version) return;
        setState({ identity, values: new Map(), pending: new Set(), loading: false });
        onError(`${source.label}读取失败：${error instanceof Error ? error.message : String(error)}。请刷新后重试。`, sessionId, workspace);
      });
    }
    return () => { generation.current += 1; };
  }, [identity, sessionId, workspace, source, onError]);

  const set = useCallback(async (anchor: AnchoredEvent, value: Value | undefined): Promise<void> => {
    const key = anchorKeyOf(anchor);
    if (sessionId === null || state.identity !== identity || state.loading || locks.current.has(key)) return;
    locks.current.add(key); // 同帧连点也只发一次，不依赖 React 下一帧的 disabled。
    const version = generation.current;
    const previous = state.values.get(key);
    const update = (nextValue: Value | undefined, pending: boolean) => {
      setState((current) => {
        if (current.identity !== identity) return current;
        const values = new Map(current.values);
        if (nextValue === undefined) values.delete(key); else values.set(key, nextValue);
        const nextPending = new Set(current.pending);
        if (pending) nextPending.add(key); else nextPending.delete(key);
        return { ...current, values, pending: nextPending };
      });
    };
    update(value, true);
    try {
      const result = await source.save(sessionId, anchor, value, workspace ?? undefined);
      if (!result.ok) throw new Error(result.error ?? "未知错误");
      if (generation.current === version) update(value, false);
    } catch (error: unknown) {
      if (generation.current !== version) return;
      update(previous, false);
      onError(`${source.label}提交失败：${error instanceof Error ? error.message : String(error)}`, sessionId, workspace);
    } finally {
      if (generation.current === version) locks.current.delete(key);
    }
  }, [identity, sessionId, workspace, state, source, onError]);
  const current = state.identity === identity;
  return useMemo(() => ({
    values: current ? state.values : new Map<string, Value>(),
    busy: (anchor: AnchoredEvent) => !current || state.loading || state.pending.has(anchorKeyOf(anchor)),
    pending: (anchor: AnchoredEvent) => current && state.pending.has(anchorKeyOf(anchor)),
    set,
  }), [current, state, set]);
}

const feedbackSource: MarkSource<"up" | "down"> = {
  label: "反馈",
  load: async (sid, ws) => new Map((await window.agent.listFeedback(sid, ws)).map((item) => [anchorKeyOf(item), item.rating])),
  save: (sid, anchor, value, ws) => window.agent.submitFeedback({ sessionId: sid, ...(ws !== undefined ? { workspace: ws } : {}), eventId: anchor.eventId, rating: value ?? "none", ...(anchor.eventRef !== undefined ? { eventRef: anchor.eventRef } : {}) }),
};
const pinSource: MarkSource<true> = {
  label: "置顶",
  // sidecar 是 host 级，但存在性检查仍需会话自己的根；读写同源，同 id 跨工作区不靠归属猜。
  load: async (sid, ws) => new Map((await window.agent.listMessagePins(sid, ws)).map((anchor) => [anchorKeyOf(anchor), true as const])),
  save: (sid, anchor, value, ws) => window.agent.setMessagePinned({ sessionId: sid, ...(ws !== undefined ? { workspace: ws } : {}), eventId: anchor.eventId, pinned: value === true, ...(anchor.eventRef !== undefined ? { eventRef: anchor.eventRef } : {}) }),
};

export function useMessageAnnotations(sessionId: string | null, workspace: string | null, onError: ReportError) {
  const feedback = useSessionMarks(sessionId, workspace, feedbackSource, onError);
  const pins = useSessionMarks(sessionId, workspace, pinSource, onError);
  return useMemo(() => ({
    feedback: feedback.values,
    feedbackBusy: feedback.busy,
    onFeedback: (anchor: AnchoredEvent, rating: "up" | "down" | null) => { void feedback.set(anchor, rating ?? undefined); },
    pinnedEventIds: new Set(pins.values.keys()),
    pinBusy: pins.busy,
    annotationPending: (anchor: AnchoredEvent) => feedback.pending(anchor) || pins.pending(anchor),
    onPin: (anchor: AnchoredEvent, pinned: boolean) => { void pins.set(anchor, pinned ? true : undefined); },
  }), [feedback, pins]);
}
