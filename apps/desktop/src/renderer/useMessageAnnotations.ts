import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anchorKeyOf, type AnchoredEvent } from "./state/session-identity";

type MarkState<Value> = {
  sessionId: string | null;
  values: ReadonlyMap<string, Value>;
  pending: ReadonlySet<string>;
  loading: boolean;
};
type MarkSource<Value> = {
  label: string;
  load: (sessionId: string) => Promise<ReadonlyMap<string, Value>>;
  save: (sessionId: string, anchor: AnchoredEvent, value: Value | undefined) => Promise<{ ok: boolean; error?: string }>;
};
type ReportError = (message: string, sessionId?: string) => void;

/** 两类消息标记共用归属、读写与逐条回滚；同一条标记有请求时禁止重复提交。 */
function useSessionMarks<Value>(sessionId: string | null, source: MarkSource<Value>, onError: ReportError) {
  const [state, setState] = useState<MarkState<Value>>({ sessionId: null, values: new Map(), pending: new Set(), loading: true });
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  useEffect(() => {
    const version = ++generation.current;
    locks.current.clear();
    setState({ sessionId, values: new Map(), pending: new Set(), loading: sessionId !== null });
    if (sessionId !== null) {
      void source.load(sessionId).then((values) => {
        if (generation.current === version) setState({ sessionId, values, pending: new Set(), loading: false });
      }).catch((error: unknown) => {
        if (generation.current !== version) return;
        setState({ sessionId, values: new Map(), pending: new Set(), loading: false });
        onError(`${source.label}读取失败：${error instanceof Error ? error.message : String(error)}。请刷新后重试。`, sessionId);
      });
    }
    return () => { generation.current += 1; };
  }, [sessionId, source, onError]);

  const set = useCallback(async (anchor: AnchoredEvent, value: Value | undefined): Promise<void> => {
    const key = anchorKeyOf(anchor);
    if (sessionId === null || state.sessionId !== sessionId || state.loading || locks.current.has(key)) return;
    locks.current.add(key); // 同帧连点也只发一次，不依赖 React 下一帧的 disabled。
    const version = generation.current;
    const previous = state.values.get(key);
    const update = (nextValue: Value | undefined, pending: boolean) => {
      setState((current) => {
        if (current.sessionId !== sessionId) return current;
        const values = new Map(current.values);
        if (nextValue === undefined) values.delete(key); else values.set(key, nextValue);
        const nextPending = new Set(current.pending);
        if (pending) nextPending.add(key); else nextPending.delete(key);
        return { ...current, values, pending: nextPending };
      });
    };
    update(value, true);
    try {
      const result = await source.save(sessionId, anchor, value);
      if (!result.ok) throw new Error(result.error ?? "未知错误");
      if (generation.current === version) update(value, false);
    } catch (error: unknown) {
      if (generation.current !== version) return;
      update(previous, false);
      onError(`${source.label}提交失败：${error instanceof Error ? error.message : String(error)}`, sessionId);
    } finally {
      if (generation.current === version) locks.current.delete(key);
    }
  }, [sessionId, state, source, onError]);
  const current = state.sessionId === sessionId;
  return useMemo(() => ({
    values: current ? state.values : new Map<string, Value>(),
    busy: (anchor: AnchoredEvent) => !current || state.loading || state.pending.has(anchorKeyOf(anchor)),
    pending: (anchor: AnchoredEvent) => current && state.pending.has(anchorKeyOf(anchor)),
    set,
  }), [current, state, set]);
}

const feedbackSource: MarkSource<"up" | "down"> = {
  label: "反馈",
  load: async (sid) => new Map((await window.agent.listFeedback(sid)).map((item) => [anchorKeyOf(item), item.rating])),
  save: (sid, anchor, value) => window.agent.submitFeedback({ sessionId: sid, eventId: anchor.eventId, rating: value ?? "none", ...(anchor.eventRef !== undefined ? { eventRef: anchor.eventRef } : {}) }),
};
const pinSource: MarkSource<true> = {
  label: "置顶",
  load: async (sid) => new Map((await window.agent.listMessagePins(sid)).map((anchor) => [anchorKeyOf(anchor), true as const])),
  save: (sid, anchor, value) => window.agent.setMessagePinned({ sessionId: sid, eventId: anchor.eventId, pinned: value === true, ...(anchor.eventRef !== undefined ? { eventRef: anchor.eventRef } : {}) }),
};

export function useMessageAnnotations(sessionId: string | null, onError: ReportError) {
  const feedback = useSessionMarks(sessionId, feedbackSource, onError);
  const pins = useSessionMarks(sessionId, pinSource, onError);
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
