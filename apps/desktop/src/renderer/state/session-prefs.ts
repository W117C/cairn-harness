// 会话级模型/思考档回读（2026-10-30 · v35）。
// 日志旁的偏好 sidecar 保存 model/thinking；列表带回来后按工作区/会话灌进两张内存表。
// 纪律：**只在本地还没有该会话选择时灌入**——用户刚点过、尚未落盘成功的选择不能被一次刷新打回旧值。
import { useEffect, type MutableRefObject } from "react";
import { runKey } from "./session-identity";

export interface SessionPrefsSource {
  id: string;
  workspace?: string;
  model?: string;
  thinking?: string;
}

/** 纯回读：只补本地还没有的键（用户当前选择优先）。返回是否有变化。 */
export function hydrateSessionPrefs(
  sessions: readonly SessionPrefsSource[],
  selections: Map<string, string | null>,
  thinking: Map<string, string>,
): boolean {
  let changed = false;
  for (const s of sessions) {
    const key = runKey(s.workspace, s.id);
    if (s.model !== undefined && !selections.has(key)) {
      selections.set(key, s.model);
      changed = true;
    }
    if (s.thinking !== undefined && !thinking.has(key)) {
      thinking.set(key, s.thinking);
      changed = true;
    }
  }
  return changed;
}

export function useSessionPrefsHydration(input: {
  sessions: readonly SessionPrefsSource[];
  selections: MutableRefObject<Map<string, string | null>>;
  thinking: MutableRefObject<Map<string, string>>;
  force: (updater: (n: number) => number) => void;
}): void {
  const { sessions, selections, thinking, force } = input;
  useEffect(() => {
    if (hydrateSessionPrefs(sessions, selections.current, thinking.current)) force((n) => n + 1);
  }, [sessions, selections, thinking, force]);
}

/** IPC 正常返回也可能拒绝保存；统一转成异常，模型/思考档的现有错误条才能收到拒因。 */
export async function saveSessionPrefs(
  sessionId: string,
  prefs: { model?: string | null; thinking?: string | null },
  workspace?: string,
): Promise<void> {
  const result = workspace === undefined ? await window.agent.sessionPrefsSet(sessionId, prefs)
    : await window.agent.sessionPrefsSet(sessionId, prefs, workspace);
  if (!result.ok) throw new Error(result.error ?? "会话偏好保存被拒绝");
}

/** 模型选择：有会话 ⇒ 只改本会话并落 sidecar（v35）；主页 ⇒ 只改全局缺省。
 *  此前有会话时**同时**写全局缺省：在一个会话里换模型会悄悄改掉所有新会话的默认。
 *  provider 不随会话存：RunRequest.model 是稳定 registry id，主进程按注册表解析 provider。 */
export function applySessionModelPick(input: {
  activeId: string | null;
  activeWorkspace?: string | null;
  registryId: string | null;
  selections: MutableRefObject<Map<string, string | null>>;
  force: (updater: (n: number) => number) => void;
  providerInfo: { models: readonly { id: string; provider: string }[] } | null;
  refreshProviderInfo: () => Promise<void>;
  setLastError: (message: string) => void;
}): void {
  if (input.activeId !== null) {
    input.selections.current.set(runKey(input.activeWorkspace, input.activeId), input.registryId);
    input.force((n) => n + 1);
    void saveSessionPrefs(input.activeId, { model: input.registryId }, input.activeWorkspace ?? undefined).catch((err: unknown) => {
      input.setLastError(`会话模型保存失败：${err instanceof Error ? err.message : String(err)}`);
    });
    return;
  }
  const picked = input.registryId === null ? undefined : input.providerInfo?.models.find((m) => m.id === input.registryId);
  const nextProvider = input.registryId === null ? "demo" : picked?.provider;
  void window.agent
    .setSettings({ model: input.registryId ?? "", ...(nextProvider !== undefined ? { provider: nextProvider as never } : {}) })
    .then(() => input.refreshProviderInfo())
    .catch((err: unknown) => input.setLastError(`模型缺省保存失败：${err instanceof Error ? err.message : String(err)}`));
}
