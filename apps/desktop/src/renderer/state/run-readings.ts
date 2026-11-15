import { runKey } from "./session-identity";
import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useRunReadings: extracted without changing event or callback behavior.
import { useEffect, useMemo } from "react";
import type { AgentEvent,AskPayload,ProviderInfo } from "../../../../../src/main/ipc-protocol";
import { countRunSteps,countToolSteps,deriveRunPhase,elapsedSecondsFor,hasAssistantTextThisRun,pendingClarifyOf,pendingPlanOf,runPhaseLabel } from "../projections";
import { waitingForModel } from "../derived/model-waiting";
import type { SurfaceError } from "../surface-error";

interface RunReadingsDeps {
  /** 错误条载荷：一句话，或结构化的 SurfaceError（原因/依据/下一步，2026-11-02 真机订正）。 */
  sessionErrors: ReadonlyMap<string, string | SurfaceError>;
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
  const activeKey = activeId === null ? null : runKey(activeWorkspace, activeId);
  const lastError = sessionErrors.get(activeKey ?? "") ?? null;
  const lastNotice = sessionNotices.get(activeKey ?? "") ?? null;
  const runningActive = activeKey !== null && runningSet.current.has(activeKey);
  // 运行秒表：起点在 send() 里按 runKey 盖；这里只负责 interval 的开与关（终态由 runningActive 翻假收掉）。
  // 依赖带 activeKey：切会话或切工作区时重算起点（同 id 跨工作区不能用另一场的起点）。
  useEffect(() => {
    if (!runningActive || activeKey === null) return;
    setElapsedSec(elapsedSecondsFor(runStartBySession.current, activeKey, Date.now()));
    const id = setInterval(
      () => setElapsedSec(elapsedSecondsFor(runStartBySession.current, activeKey, Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [runningActive, activeKey]);
  const pendingClarify = pendingClarifyOf(events);
  const pendingPlan = pendingPlanOf(events);
  // 只认当前会话那张卡（判定唯一处在 send-queue.askBelongsToSession）；归属未知落 "" 键，照旧显示。
  const askForActive = activeKey !== null
    ? askBySid.get(activeKey) ?? askBySid.get("") ?? null
    : askBySid.get("") ?? null;
  const phase = deriveRunPhase(events, askForActive !== null, pendingClarify !== null, pendingPlan !== null);
  const stopped = activeKey !== null && stoppedIds.has(activeKey) && !runningActive;
  const hasAnswerText = hasAssistantTextThisRun(events);
  const lastDelta = activeKey !== null ? (lastDeltaAt.current.get(activeKey) ?? 0) : 0;
  // 正文已停 >1.5s，run 还没回 ⇒ 主进程在跑收尾（Stop hook / 安全报告 / 记忆沉淀等），
  // 不是模型还在想。没有时间戳（如重载后接管在跑会话）就不猜，按生成中显示。
  const answerQuiet = hasAnswerText && lastDelta > 0 && Date.now() - lastDelta > 1500;
  // 文案口径在 projections.runPhaseLabel 一处（纯函数，好判卷）：
  // 2026-10-20 独立评审追出 MEDIUM-HIGH——旧实现先判 `finishing`，而 `answerQuiet`
  // （正文停了 >1.5s）**恰好是"工具在跑"的形状** ⇒ 任何超过 1.5s 的构建都被报成"收尾中"。
  const phaseLabel = runPhaseLabel({ phase, stopped, running: runningActive, hasAnswerText, answerQuiet });
  const chosen = activeId !== null ? selections.current.get(runKey(activeWorkspace, activeId)) : undefined;
  const pickerValue = chosen !== undefined ? chosen : (providerInfo?.modelId ?? null);
  const chosenCtx = providerInfo?.models.find((model) => model.id === pickerValue)?.ctxWindow;
  const steps = countToolSteps(events);
  const runSteps = countRunSteps(events);

  const startedAt = runStartBySession.current.get(activeKey ?? "");
  const blocked = askForActive !== null || pendingClarify !== null || pendingPlan !== null;
  const modelWaiting = useMemo(() => waitingForModel({ events, running: runningActive, startedAt, blocked }), [events, runningActive, startedAt, blocked]);
  return { lastError, lastNotice, runningActive, modelWaiting, pendingClarify, pendingPlan, askForActive, phase, stopped, phaseLabel, chosen, pickerValue, chosenCtx, steps, runSteps };
}
