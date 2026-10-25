import { runKey } from "./session-identity";
import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useRunReadings: extracted without changing event or callback behavior.
import { useEffect } from "react";
import type { AgentEvent,AskPayload,ProviderInfo } from "../../../../../src/main/ipc-protocol";
import { deriveRunPhase,elapsedSecondsFor,hasAssistantTextThisRun,pendingClarifyOf,pendingPlanOf,runPhaseLabel } from "../projections";

interface RunReadingsDeps {
  sessionErrors: ReadonlyMap<string, string>;
  activeId: string | null;
  sessionNotices: ReadonlyMap<string, string>;
  runningSet: MutableRefObject<Set<string>>;
  setElapsedSec: Dispatch<SetStateAction<number>>;
  runStartBySession: MutableRefObject<Map<string, number>>;
  events: AgentEvent[];
  askBySid: ReadonlyMap<string, AskPayload>;
  stoppedIds: ReadonlySet<string>;
  lastDeltaAt: MutableRefObject<Map<string, number>>;
  selections: MutableRefObject<Map<string, string | null>>;
  providerInfo: ProviderInfo | null;
  activeWorkspace: string | null;
}

export function useRunReadings(deps: RunReadingsDeps) {
  const { sessionErrors, activeId, sessionNotices, runningSet, setElapsedSec, runStartBySession, events, askBySid, stoppedIds, lastDeltaAt, selections, providerInfo, activeWorkspace } = deps;
  const lastError = sessionErrors.get(activeId ?? "") ?? null;
  const lastNotice = sessionNotices.get(activeId ?? "") ?? null;
  const runningActive = activeId !== null && runningSet.current.has(runKey(activeWorkspace, activeId));
  // 运行秒表：起点在 send() 里按会话盖；这里只负责 interval 的开与关（终态由 runningActive 翻假收掉）。
  // 依赖里有 activeId：切会话时重算起点（否则切回一个还在跑的会话，秒表会接着别人的起点算）。
  useEffect(() => {
    if (!runningActive || activeId === null) return;
    setElapsedSec(elapsedSecondsFor(runStartBySession.current, activeId, Date.now()));
    const id = setInterval(
      () => setElapsedSec(elapsedSecondsFor(runStartBySession.current, activeId, Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [runningActive, activeId]);
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // 只认当前会话那张卡（判定唯一处在 send-queue.askBelongsToSession）；归属未知落 "" 键，照旧显示。
  const askForActive = activeId !== null
    ? askBySid.get(activeId) ?? askBySid.get("") ?? null
    : askBySid.get("") ?? null;
  const phase = deriveRunPhase(events, askForActive !== null, pendingClarify !== null, pendingPlan !== null);
  const stopped = activeId !== null && stoppedIds.has(activeId) && !runningActive;
  const hasAnswerText = hasAssistantTextThisRun(events);
  const lastDelta = activeId !== null ? (lastDeltaAt.current.get(activeId) ?? 0) : 0;
  // 正文已停 >1.5s，run 还没回 ⇒ 主进程在跑收尾（Stop hook / 安全报告 / 记忆沉淀等），
  // 不是模型还在想。没有时间戳（如重载后接管在跑会话）就不猜，按生成中显示。
  const answerQuiet = hasAnswerText && lastDelta > 0 && Date.now() - lastDelta > 1500;
  // 文案口径在 projections.runPhaseLabel 一处（纯函数，好判卷）：
  // 2026-10-20 独立评审追出 MEDIUM-HIGH——旧实现先判 `finishing`，而 `answerQuiet`
  // （正文停了 >1.5s）**恰好是"工具在跑"的形状** ⇒ 任何超过 1.5s 的构建都被报成"收尾中"。
  const phaseLabel = runPhaseLabel({ phase, stopped, running: runningActive, hasAnswerText, answerQuiet });
  const chosen = activeId !== null ? selections.current.get(activeId) : undefined;
  const pickerValue = chosen !== undefined ? chosen : (providerInfo?.modelId ?? null);

  return { lastError, lastNotice, runningActive, pendingClarify, pendingPlan, askForActive, phase, stopped, phaseLabel, chosen, pickerValue };
}
