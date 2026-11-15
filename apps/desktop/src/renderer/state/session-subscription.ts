import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useSessionSubscription: extracted without changing event or callback behavior.
import { useCallback,useEffect } from "react";
import type { AgentEvent,AskPayload,ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { isMainSessionTerminalEvent } from "../projections";
import { isSessionEndDistillAsk,type QueuedSend } from "../send-queue";
import { isStaleForActive, markBackgroundRunning, runKey } from "./session-identity";

interface SessionSubscriptionDeps {
  refreshSessions: () => Promise<void>;
  refreshProviderInfo: () => Promise<void>;
  refreshProviderKeys: () => Promise<void>;
  setProjects: Dispatch<SetStateAction<ProjectRecord[]>>;
  setRegistryNotice: Dispatch<SetStateAction<string | null>>;
  knownSessionIds: MutableRefObject<ReadonlySet<string>>;
  refetching: MutableRefObject<boolean>;
  openPending: MutableRefObject<{ id: string; workspace: string | null; events: AgentEvent[]; } | null>;
  activeIdRef: MutableRefObject<string | null>;
  activeWorkspaceRef: MutableRefObject<string | null>;
  lastDeltaAt: MutableRefObject<Map<string, number>>;
  runningSet: MutableRefObject<Set<string>>;
  outcomes: MutableRefObject<Map<string, "ok" | "failed">>;
  force: Dispatch<SetStateAction<number>>;
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  sendQueue: MutableRefObject<Map<string, QueuedSend[]>>;
  setLastNotice: (message: string, sessionId?: string | undefined, workspace?: string | null) => void;
  askById: MutableRefObject<Map<string, AskPayload>>;
  setAskBySid: Dispatch<SetStateAction<ReadonlyMap<string, AskPayload>>>;
  waitingByAsk: MutableRefObject<Map<string, string>>;
  waitingCounts: MutableRefObject<Map<string, number>>;
}

/** 打开会话的读盘快照还在飞时，只有同一「工作区 + id」的事件能进缓冲。
 *  旧 host 不带 workspace（undefined / 空串）时沿用旧行为；未知归属也照收。 */
export function shouldBufferOpenEvent(input: {
  sessionId: string | undefined;
  eventWorkspace: string | undefined;
  open: { id: string; workspace: string | null } | null;
}): boolean {
  const { sessionId, eventWorkspace, open } = input;
  if (sessionId === undefined || open === null || open.id !== sessionId) return false;
  return eventWorkspace === undefined || eventWorkspace === "" || open.workspace === null || open.workspace === eventWorkspace;
}

export function useSessionSubscription(deps: SessionSubscriptionDeps) {
  const { refreshSessions, refreshProviderInfo, refreshProviderKeys, setProjects, setRegistryNotice, knownSessionIds, refetching, openPending, activeIdRef, activeWorkspaceRef, lastDeltaAt, runningSet, outcomes, force, setEvents, sendQueue, setLastNotice, askById, setAskBySid, waitingByAsk, waitingCounts } = deps;
  // 项目注册表读取（2026-10-30）：失败时侧栏出 notice；外部修好 projects.json 后要能**就地重试**，
  // 不必重启应用。抽成回调供首屏与「重试」共用同一条读法。
  const retryProjects = useCallback(() => {
    void window.agent.listProjects().then((registered) => {
      setProjects(registered);
      setRegistryNotice(null);
    }).catch((err: unknown) => {
      setRegistryNotice(`项目注册表不可用：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [setProjects, setRegistryNotice]);
  useEffect(() => {
    refreshSessions();
    void refreshProviderInfo();
    void refreshProviderKeys();
    retryProjects();
    const offEvent = window.agent.onEvent((e) => {
      // 第十八遍：首条消息自动命名（push-only 合成事件，同收束终态先例）——只刷侧栏让新标题
      // 落位；不进事件流（会渲染成怪行）、不点运行灯。
      if ((e as { type?: string }).type === "session_titled") {
        void refreshSessions();
        return;
      }
      const sid = (e as { session_id?: string }).session_id;
      const eventWorkspace = (e as { workspace?: string }).workspace;
      // 同名 id 的另一棵根的迟到事件：不得进当前转录、不得点当前运行灯（推送带 workspace 才判）。
      if (isStaleForActive({
        activeId: activeIdRef.current,
        activeWorkspace: activeWorkspaceRef.current,
        eventSessionId: sid,
        eventWorkspace: (e as { workspace?: string }).workspace,
      })) return;
      // 清单里「已知」按工作区限定；旧 host 不带 workspace 才退回裸 id。
      // 同秒同 id 的另一棵根第一次发事件时必须触发清单刷新，不能被另一根的已知 id 挡住。
      const knownKey = eventWorkspace !== undefined && eventWorkspace !== "" ? runKey(eventWorkspace, sid ?? "") : (sid ?? "");
      if (sid && !knownSessionIds.current.has(knownKey) && !refetching.current) {
        refetching.current = true;
        refreshSessions().finally(() => { refetching.current = false; });
      }
      // 打开会话的读盘快照还没回来：这段窗口内的 live 事件先入缓冲，快照到达后按序合并。
      // 否则 setEvents(快照) 会把这几百毫秒的增量整段覆盖掉（长会话尤其明显）。
      const open = openPending.current;
      if (open !== null && shouldBufferOpenEvent({ sessionId: sid, eventWorkspace, open })) {
        open.events.push(e);
        return;
      }
      // 运行集口径（2026-10-06 收口）：活动会话不由事件置位（置位只走发送那条路）；
      // 任何会话收到**主会话**终态 agent_status 摘位；worker 子流的终态不摘主会话旗
      // （二者同型且同带 session_id，唯一判据在 projections.isMainSessionTerminalEvent）。
      const evWorkspace = (e as { workspace?: string }).workspace ?? activeWorkspaceRef.current;
      const statusKey = sid === undefined ? undefined : runKey(evWorkspace, sid);
      const deltaSid = sid ?? (e.type === "assistant_delta" ? activeIdRef.current : null);
      const deltaKey = deltaSid === null ? null : runKey(evWorkspace, deltaSid);
      if (e.type === "assistant_delta" && deltaKey !== null) lastDeltaAt.current.set(deltaKey, Date.now());
      const terminal = isMainSessionTerminalEvent(e);
      if (sid && terminal) {
        runningSet.current.delete(statusKey!);
        lastDeltaAt.current.delete(statusKey!);
        // P1 侧栏状态记账（诚实边界）：done ⇒ 对勾、failed ⇒ 红点、cancelled ⇒ 清位
        // （用户主动停的不冒充完成也不报失败）。会话终态不落盘 ⇒ 本进程记账，重启归零如实。
        const status = (e as { status?: string }).status;
        if (status === "done") outcomes.current.set(statusKey!, "ok");
        else if (status === "failed") outcomes.current.set(statusKey!, "failed");
        else outcomes.current.delete(statusKey!);
        force((n) => n + 1);
      }
      if (sid && sid !== activeIdRef.current) {
        // 后台会话仍在跑：只在 0→1 时点亮并重渲染（终态刚在上面摘过，别又补上）。
        // 其余 delta/tool/usage 事件不 force：否则后台每来一个 token 都重画整棵工作台。
        if (!terminal && markBackgroundRunning(runningSet.current, statusKey!)) force((n) => n + 1);
        return;
      }
      setEvents((prev) => [...prev, e]);
    });
    const offAsk = window.agent.onAsk((p) => {
      const sid = p.sessionId ?? "";
      const askWorkspace = p.workspace ?? activeWorkspaceRef.current;
      const askKey = sid === "" ? "" : runKey(askWorkspace, sid);
      // 对话优先跳沉（owner 实证 2026-10-15「记忆沉淀挡住正常对话了」）：队列里还有待发消息
      // ⇒ 这轮收尾的自动沉淀不与对话抢审批，当场拒掉（快销）——distill 的合并审批一次到位，
      // run 收束后队列立即开派；沉淀只是本轮跳过（下次会话收尾再试），notice 明示不暗吞。
      // 手打的记忆写入审批（args 无 trigger）不在此列，照常弹卡。
      // ⚠️ 2026-10-28（第 750 页）：读队列表必须与写**同键**——写方按
      // `runKey(workspace, sid)`（限定键）存，这里此前按**裸 sid** 读 ⇒ 永远读到 undefined
      // ⇒ 这条「对话优先、跳沉」守卫**从不触发** ⇒ 本该被快销的沉淀审批卡照样弹出来，
      // 挡住用户已经排队的下一条消息。
      if (isSessionEndDistillAsk(p) && (sendQueue.current.get(askKey)?.length ?? 0) > 0) {
        void window.agent.decide(p.askId, false).catch(() => undefined);
        setLastNotice("已跳过本轮全局记忆写入（你在继续对话；下次收尾再试）", sid, askWorkspace);
        return;
      }
      askById.current.set(askKey, p);
      setAskBySid(new Map(askById.current));
      // P1：等门集会记账（侧栏黄点数据面；归属未知的空串不计）。
      if (sid !== "") {
        waitingByAsk.current.set(p.askId, askKey);
        waitingCounts.current.set(askKey, (waitingCounts.current.get(askKey) ?? 0) + 1);
        force((n) => n + 1);
      }
    });
    const offDone = window.agent.onAskDone((p) => {
      // 只摘这一张（按 askId 反查会话）：另一会话仍停在门上的卡不能被顺手抹掉。
      for (const [sid, payload] of askById.current) {
        if (payload.askId === p.askId) askById.current.delete(sid);
      }
      setAskBySid(new Map(askById.current));
      // P1：凭 askId 反查会话减计数（outcome 载荷无 sessionId——反查表是唯一桥梁）。
      const askKey = waitingByAsk.current.get(p.askId);
      if (askKey !== undefined) {
        waitingByAsk.current.delete(p.askId);
        const left = (waitingCounts.current.get(askKey) ?? 1) - 1;
        if (left <= 0) waitingCounts.current.delete(askKey); else waitingCounts.current.set(askKey, left);
        force((n) => n + 1);
      }
    });
    return () => { offEvent(); offAsk(); offDone(); };
  }, [refreshSessions, refreshProviderInfo, refreshProviderKeys, retryProjects]);


  return { retryProjects };
}
