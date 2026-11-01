// 进化分区容器：取当前窗口工作区的 EvolveReport；卸载后的迟到响应不回写。
import { useCallback, useEffect, useRef, useState } from "react";
import { EvolvePanel, type EvolvePanelState } from "./EvolvePanel";

export function EvolveSection(): React.JSX.Element {
  const [state, setState] = useState<EvolvePanelState>({ status: "loading" });
  const [frozenBusy, setFrozenBusy] = useState(false);
  const [activateBusyId, setActivateBusyId] = useState<string | null>(null);
  const [dormantBusyId, setDormantBusyId] = useState<string | null>(null);
  const [globalBusyId, setGlobalBusyId] = useState<string | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [globalFrozenBusy, setGlobalFrozenBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setState({ status: "loading" });
    setActionError(undefined);
    try {
      const report = await window.agent.evolveReport();
      if (current === generation.current) setState({ status: "ready", report });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setState({ status: "error", error: message });
    }
  }, []);
  const setFrozen = useCallback(async (frozen: boolean) => {
    const current = ++generation.current;
    setFrozenBusy(true);
    try {
      const report = await window.agent.evolveSetFrozen(frozen);
      if (current === generation.current) setState({ status: "ready", report });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setState({ status: "error", error: message });
    } finally {
      if (current === generation.current) setFrozenBusy(false);
    }
  }, []);
  const activate = useCallback(async (id: string) => {
    const current = ++generation.current;
    setActivateBusyId(id);
    setActionError(undefined);
    try {
      const result = await window.agent.evolveActivate(id);
      if (current === generation.current) {
        setState({ status: "ready", report: result.report });
        if (!result.ok) setActionError(result.reason ?? "激活被拒");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setActionError(message);
    } finally {
      if (current === generation.current) setActivateBusyId(null);
    }
  }, []);
  const dormant = useCallback(async (id: string) => {
    const current = ++generation.current;
    setDormantBusyId(id);
    setActionError(undefined);
    try {
      const result = await window.agent.evolveDormant(id);
      if (current === generation.current) {
        setState({ status: "ready", report: result.report });
        if (!result.ok) setActionError(result.reason ?? "转休眠被拒");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setActionError(message);
    } finally {
      if (current === generation.current) setDormantBusyId(null);
    }
  }, []);
  const revokeGlobal = useCallback(async (id: string) => {
    const current = ++generation.current;
    setGlobalBusyId(id);
    setActionError(undefined);
    try {
      const result = await window.agent.evolveGlobalRevoke(id);
      if (current === generation.current) {
        setState({ status: "ready", report: result.report });
        if (!result.ok) setActionError(result.reason ?? "撤销被拒");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setActionError(message);
    } finally {
      if (current === generation.current) setGlobalBusyId(null);
    }
  }, []);
  const restoreGlobal = useCallback(async (id: string) => {
    const current = ++generation.current;
    setRestoreBusyId(id);
    setActionError(undefined);
    try {
      const result = await window.agent.evolveGlobalActivate(id);
      if (current === generation.current) {
        setState({ status: "ready", report: result.report });
        if (!result.ok) setActionError(result.reason ?? "恢复被拒");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setActionError(message);
    } finally {
      if (current === generation.current) setRestoreBusyId(null);
    }
  }, []);
  const setGlobalFrozen = useCallback(async (frozen: boolean) => {
    const current = ++generation.current;
    setGlobalFrozenBusy(true);
    try {
      const report = await window.agent.evolveGlobalSetFrozen(frozen);
      if (current === generation.current) setState({ status: "ready", report });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (current === generation.current) setState({ status: "error", error: message });
    } finally {
      if (current === generation.current) setGlobalFrozenBusy(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  return (
    <EvolvePanel
      state={state}
      onRetry={() => { void load(); }}
      onSetFrozen={(frozen) => { void setFrozen(frozen); }}
      frozenBusy={frozenBusy}
      onActivate={(id) => { void activate(id); }}
      activateBusyId={activateBusyId}
      onDormant={(id) => { void dormant(id); }}
      dormantBusyId={dormantBusyId}
      onRevokeGlobal={(id) => { void revokeGlobal(id); }}
      globalBusyId={globalBusyId}
      onRestoreGlobal={(id) => { void restoreGlobal(id); }}
      restoreBusyId={restoreBusyId}
      onSetGlobalFrozen={(frozen) => { void setGlobalFrozen(frozen); }}
      globalFrozenBusy={globalFrozenBusy}
      {...(actionError !== undefined ? { actionError } : {})}
    />
  );
}
