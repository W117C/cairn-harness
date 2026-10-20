import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MarkState<Value> = {
  sessionId: string | null;
  values: ReadonlyMap<number, Value>;
  pending: ReadonlySet<number>;
  loading: boolean;
};
type MarkSource<Value> = {
  label: string;
  load: (sessionId: string) => Promise<ReadonlyMap<number, Value>>;
  save: (sessionId: string, eventId: number, value: Value | undefined) => Promise<{ ok: boolean; error?: string }>;
};
type ReportError = (message: string, sessionId?: string) => void;

/** 两类消息标记共用归属、读写与逐条回滚；同一条标记有请求时禁止重复提交。 */
function useSessionMarks<Value>(sessionId: string | null, source: MarkSource<Value>, onError: ReportError) {
  const [state, setState] = useState<MarkState<Value>>({ sessionId: null, values: new Map(), pending: new Set(), loading: true });
  const generation = useRef(0);
  const locks = useRef(new Set<number>());
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

  const set = useCallback(async (eventId: number, value: Value | undefined): Promise<void> => {
    if (sessionId === null || state.sessionId !== sessionId || state.loading || locks.current.has(eventId)) return;
    locks.current.add(eventId); // 同帧连点也只发一次，不依赖 React 下一帧的 disabled。
    const version = generation.current;
    const previous = state.values.get(eventId);
    const update = (nextValue: Value | undefined, pending: boolean) => {
      setState((current) => {
        if (current.sessionId !== sessionId) return current;
        const values = new Map(current.values);
        if (nextValue === undefined) values.delete(eventId); else values.set(eventId, nextValue);
        const nextPending = new Set(current.pending);
        if (pending) nextPending.add(eventId); else nextPending.delete(eventId);
        return { ...current, values, pending: nextPending };
      });
    };
    update(value, true);
    try {
      const result = await source.save(sessionId, eventId, value);
      if (!result.ok) throw new Error(result.error ?? "未知错误");
      if (generation.current === version) update(value, false);
    } catch (error: unknown) {
      if (generation.current !== version) return;
      update(previous, false);
      onError(`${source.label}提交失败：${error instanceof Error ? error.message : String(error)}`, sessionId);
    } finally {
      if (generation.current === version) locks.current.delete(eventId);
    }
  }, [sessionId, state, source, onError]);
  const current = state.sessionId === sessionId;
  return useMemo(() => ({
    values: current ? state.values : new Map<number, Value>(),
    busy: (eventId: number) => !current || state.loading || state.pending.has(eventId),
    pending: (eventId: number) => current && state.pending.has(eventId),
    set,
  }), [current, state, set]);
}

const feedbackSource: MarkSource<"up" | "down"> = {
  label: "反馈",
  load: async (sid) => new Map((await window.agent.listFeedback(sid)).map((item) => [item.eventId, item.rating])),
  save: (sid, eventId, value) => window.agent.submitFeedback({ sessionId: sid, eventId, rating: value ?? "none" }),
};
const pinSource: MarkSource<true> = {
  label: "置顶",
  load: async (sid) => new Map((await window.agent.listMessagePins(sid)).map((id) => [id, true as const])),
  save: (sid, eventId, value) => window.agent.setMessagePinned({ sessionId: sid, eventId, pinned: value === true }),
};

export function useMessageAnnotations(sessionId: string | null, onError: ReportError) {
  const feedback = useSessionMarks(sessionId, feedbackSource, onError);
  const pins = useSessionMarks(sessionId, pinSource, onError);
  return useMemo(() => ({
    feedback: feedback.values,
    feedbackBusy: feedback.busy,
    onFeedback: (eventId: number, rating: "up" | "down" | null) => { void feedback.set(eventId, rating ?? undefined); },
    pinnedEventIds: new Set(pins.values.keys()),
    pinBusy: pins.busy,
    annotationPending: (eventId: number) => feedback.pending(eventId) || pins.pending(eventId),
    onPin: (eventId: number, pinned: boolean) => { void pins.set(eventId, pinned ? true : undefined); },
  }), [feedback, pins]);
}
