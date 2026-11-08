// 危险权限档确认（2026-10-31）：composer 菜单已有内联确认；命令面板的循环此前直达
// auto/full-access。这里把「待确认态 + 确认后落盘」收成一条，workbench 只做接线。
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { PermissionMode } from "../../../../../src/main/ipc-protocol";
import { runKey } from "./session-identity";
import { MODE_LABEL, permissionNeedsConfirm } from "../permission-labels";

export interface PermissionConfirmApi {
  permissionConfirm: PermissionMode | null;
  setPermissionConfirm: (mode: PermissionMode | null) => void;
  apply: (next: PermissionMode) => void;
  cycle: (next: PermissionMode) => void;
}

export function usePermissionConfirm(input: {
  mode: PermissionMode;
  setMode: Dispatch<SetStateAction<PermissionMode>>;
  activeId: string | null;
  activeWorkspace: string | null;
  runningSet: { readonly current: ReadonlySet<string> };
  setLastNotice: (message: string, sessionId?: string) => void;
  setLastError: (message: string, sessionId?: string) => void;
}): PermissionConfirmApi {
  const [permissionConfirm, setPermissionConfirm] = useState<PermissionMode | null>(null);

  const apply = useCallback((next: PermissionMode): void => {
    const runningHere = input.activeId !== null && input.runningSet.current.has(runKey(input.activeWorkspace, input.activeId));
    void window.agent.setSettings({ mode: next }).then(() => {
      input.setMode(next);
      const info = MODE_LABEL[next];
      input.setLastNotice(`权限档已切到「${info.label}」（${info.desc}）${runningHere ? "——本轮仍在原档下跑，下一条消息起生效" : ""}`);
    }).catch((err: unknown) => {
      input.setLastError(`权限档保存失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [input.activeId, input.activeWorkspace, input.runningSet, input.setLastError, input.setLastNotice, input.setMode]);

  const cycle = useCallback((next: PermissionMode): void => {
    if (permissionNeedsConfirm(input.mode, next)) {
      setPermissionConfirm(next);
      return;
    }
    apply(next);
  }, [apply, input.mode]);

  return { permissionConfirm, setPermissionConfirm, apply, cycle };
}
