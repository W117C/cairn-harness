// 状态簇·消息级动作（Phase 2 · 批 2.3）。
//
// 分层契约（见 src/renderer/LAYERING.md）：本层**不含 JSX**、**不 import components/**；
// 钩子只吐「状态 + 动作」。搬移口径：代码逐行原样搬过来（判卷钉的是声明行与依赖数组的写法）。
//
// 装的是哪几样：流里那根操作条的动作——分叉（fork 到该轮）、编辑并重发、回放（fork + 注入原文）、
// 朗读（macOS say）、手动压缩（/compact）、目标动作（暂停/继续/清除）、快照还原。
// 为什么住一起：它们都作用在**某一条消息/某一轮**上，且共用同两件东西——事件流与当前会话 id。
import { useCallback, useState } from "react";
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import { roundOfEvent, userTextOfRound } from "../projections";
import { stripMarkdownForSpeech } from "../speech";
import { STR } from "../strings";
import { toast } from "../toast";

export interface MessageActionsDeps {
  /** 当前会话 id 的镜像 ref（回调在事件时刻读最新值）。 */
  activeIdRef: React.MutableRefObject<string | null>;
  /** 事件流的镜像 ref。 */
  eventsRef: React.MutableRefObject<AgentEvent[]>;
  /** 会话清单（编辑并重发要取原会话标题）。 */
  sessions: { id: string; title?: string }[];
  /** 当前工作区的镜像 ref（建新会话时归属用）。 */
  activeWorkspaceRef: React.MutableRefObject<string | null>;
  refreshSessions: () => Promise<void>;
  openSession: (id: string, workspace?: string) => void;
  injectText: (text: string) => void;
  setEditCtx: (v: { originId: string; originTitle: string; forkId: string; round: number } | null) => void;
  setLastError: (message: string, sessionId?: string) => void;
  setEvents: React.Dispatch<React.SetStateAction<AgentEvent[]>>;
}

export interface MessageActionsState {
  /** 正在朗读的事件 id（按钮点亮态）。 */
  speakingEventId: number | null;
  setSpeakingEventId: (v: number | null) => void;
  handleBranch: (round: number) => void;
  compactNow: () => void;
  goalAct: (req: { pause?: boolean; resume?: boolean; clear?: boolean }) => void;
  handleEditUser: (round: number, text: string) => void;
  handleReplay: (eventId: number) => void;
  handleRestoreSnapshot: (path: string, snapshotId: string) => void;
  handleSpeak: (eventId: number, text: string) => void;
}

export function useMessageActions(deps: MessageActionsDeps): MessageActionsState {
  const {
    activeIdRef, eventsRef, sessions, activeWorkspaceRef,
    refreshSessions, openSession, injectText, setEditCtx, setLastError, setEvents,
  } = deps;

  // ---- v7 消息操作条：分叉（forkSession 到该轮，P3-1 挪到 user 行）+ 回放（agent 行）+ 朗读（macOS say）----
  const [speakingEventId, setSpeakingEventId] = useState<number | null>(null);
  const handleBranch = useCallback((round: number) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    void window.agent.forkSession(sid, round, true).then((r) => {
      if (r.ok !== true || r.id === undefined) { setLastError(`分叉失败：${r.error ?? "未知原因"}`, sid); return; }
      void refreshSessions();
      openSession(r.id); // 分叉 = 前 N 轮的全量拷贝；切过去并载入转录/队列（裸 activate 会留旧流）
    }, (err: unknown) => {
      setLastError(`分叉失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [refreshSessions, openSession, setLastError]);
  /** 手动压缩（2026-10-18）：斜杠 /compact、上下文菜单、命令面板三处共用这一条——
   *  必须带当前会话 id（旧协议不带，主进程会落到 lastLogPath，压错会话或报无日志）。 */
  const compactNow = useCallback((): void => {
    const sid = activeIdRef.current;
    if (sid === null) { toast.error(STR.composer.compactNoSession); return; }
    const compact = window.agent.compact;
    if (compact === undefined) { toast.error(STR.composer.compactUnavailable); return; }
    void compact(sid).then((r) => {
      if (!r.ok) { setLastError(r.error ?? "压缩失败", sid); return; }
      toast.success(STR.composer.compactDone);
    }, (err: unknown) => {
      setLastError(STR.composer.compactFail.replace("{reason}", err instanceof Error ? err.message : String(err)), sid);
    });
  }, [setLastError, toast]);
  /** 目标动作（暂停/继续/清除）：只发 IPC；事件由主进程推回，芯片读同一份事件流自更新。 */
  const goalAct = useCallback((req: { pause?: boolean; resume?: boolean; clear?: boolean }): void => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    void window.agent.setGoal({ sessionId: sid, ...req }).then((r) => {
      if (!r.ok) setLastError(r.error ?? "目标操作失败", sid);
    }, (err: unknown) => setLastError(err instanceof Error ? err.message : String(err), sid));
  }, [setLastError]);
  const handleEditUser = useCallback((round: number, text: string): void => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const originTitle = sessions.find((s) => s.id === sid)?.title ?? sid;
    const inject = (id: string): void => {
      refreshSessions();
      openSession(id); // 必须载入新会话转录：第 1 轮编辑会建空会话，裸 activate 会把原会话历史留在屏上
      injectText(text);
      setEditCtx({ originId: sid, originTitle, forkId: id, round });
    };
    if (round <= 1) {
      void window.agent.createSession(activeWorkspaceRef.current ?? undefined).then((r) => {
        inject(r.id);
      }, (err: unknown) => {
        setLastError(`编辑失败：${err instanceof Error ? err.message : String(err)}`, sid);
      });
      return;
    }
    void window.agent.forkSession(sid, round - 1, true).then((r) => {
      if (r.ok !== true || r.id === undefined) { setLastError(`编辑失败：${r.error ?? "未知原因"}`, sid); return; }
      inject(r.id);
    }, (err: unknown) => {
      setLastError(`编辑失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [refreshSessions, openSession, injectText, setLastError, sessions]);
  const handleReplay = useCallback((eventId: number) => {
    const sid = activeIdRef.current;
    if (sid === null) return;
    const round = roundOfEvent(eventsRef.current, eventId);
    if (round === null) { setLastError("回放失败：这条消息不在事件日志的轮次里", sid); return; }
    const text = userTextOfRound(eventsRef.current, round);
    void window.agent.forkSession(sid, round, true).then((r) => {
      if (r.ok !== true || r.id === undefined) { setLastError(`回放失败：${r.error ?? "未知原因"}`, sid); return; }
      void refreshSessions();
      openSession(r.id); // 同分叉：只 activate 会显示原会话的旧转录
      if (text !== null) injectText(text); // 注入不发送（Composer 覆盖草稿并聚焦）
    }, (err: unknown) => {
      setLastError(`回放失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [refreshSessions, openSession, injectText, setLastError]);
  /** P3-2 检查器「撤销此文件改动」：snapshotRestore（v11 通道，渲染层首个消费者）。
   *  成功 toast（STR 文案 v11 就位）；失败 fail-visible 原文上屏（不装成功）。
   *  带上 sessionId：主进程还原成功后要往**这个会话**的事件流落一条 `file_restored`，
   *  否则改动面（改动 Tab / 变更窗格 / Changes 徽标 / 交付卡的「改动已验证」）还当这个文件没撤。 */
  const handleRestoreSnapshot = useCallback((path: string, snapshotId: string): void => {
    const sid = activeIdRef.current;
    void window.agent.snapshotRestore({
      path, snapshotId,
      ...(sid !== null ? { sessionId: sid } : {}),
    }).then((r) => {
      if (r.ok !== true) { toast.error(r.error ?? "还原失败"); return; }
      toast.success(STR.toast.snapshotRestored.replace("{path}", path));
      // 主进程直接 append 事件日志、不经 run 的事件推流：不本地补一条的话，改动面/徽标/
      // 交付卡会一直停在“未还原”，直到切走再开（2026-10-20 真机：还原成功、文件已回退，
      // 但 Inspector 仍显示撤销钮；重开会话才消失）。只补到发起还原的那个会话。
      if (sid !== null && activeIdRef.current === sid) {
        setEvents((prev) => [...prev, { type: "file_restored", path, snapshotId } as AgentEvent]);
      }
    }, (err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  }, []);
  const handleSpeak = useCallback((eventId: number, text: string) => {
    if (speakingEventId === eventId) {
      // 再点 = 停止（幂等）
      setSpeakingEventId(null);
      void window.agent.stopSpeaking();
      return;
    }
    const clean = stripMarkdownForSpeech(text);
    setSpeakingEventId(eventId); // 先点亮：say 是 fire-and-return，真实声音随后到
    void window.agent.speakText(clean).then((r) => {
      if (!r.ok) {
        setSpeakingEventId(null); // fail-visible：出错熄灭按钮态，错误照常上屏
        setLastError(`朗读失败：${r.error ?? "未知原因"}`);
      }
    }, (err: unknown) => {
      setSpeakingEventId(null);
      setLastError(`朗读失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [speakingEventId, setLastError]);

  return {
    speakingEventId,
    setSpeakingEventId,
    handleBranch,
    compactNow,
    goalAct,
    handleEditUser,
    handleReplay,
    handleRestoreSnapshot,
    handleSpeak,
  };
}
