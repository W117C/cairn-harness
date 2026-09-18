// 预加载：把最小 API 面暴露给 renderer（contextBridge；renderer 无 Node 能力）。
// M1e：settings（布局/设置页持久化）+ 会话列表 + compact（M1d 遗留接线补上）。
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  AgentApi,
  AgentEvent,
  AppSettings,
  AskOutcomePayload,
  AskPayload,
  RunRequest,
} from "../main/ipc-protocol";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: AgentApi = {
  run: (req: RunRequest) => ipcRenderer.invoke("agent:run", req),
  decide: (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always") =>
    ipcRenderer.invoke("agent:decide", askId, approved, scope),
  submitClarify: (callId: string, answers: Record<string, string | string[]>) =>
    ipcRenderer.invoke("agent:clarify", callId, answers),
  decidePlan: (approved: boolean, callId?: string) => ipcRenderer.invoke("agent:plan", approved, callId),
  runCancel: () => ipcRenderer.invoke("agent:run-cancel"), // P3（审查）：交互 run 取消入口
  compact: () => ipcRenderer.invoke("agent:compact"),
  onEvent: (cb: (e: AgentEvent) => void) => subscribe<AgentEvent>("agent:event", cb),
  onAsk: (cb: (p: AskPayload) => void) => subscribe<AskPayload>("agent:ask", cb),
  onAskDone: (cb: (p: AskOutcomePayload) => void) => subscribe<AskOutcomePayload>("agent:ask-done", cb),
  getState: () => ipcRenderer.invoke("agent:state"),
  getProviderInfo: () => ipcRenderer.invoke("agent:provider-info"),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("agent:settings-get"),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke("agent:settings-set", patch),
  listSessions: () => ipcRenderer.invoke("agent:sessions-list"),
  createSession: (name?: string) => ipcRenderer.invoke("agent:sessions-create", name),
  openSession: (id: string) => ipcRenderer.invoke("agent:sessions-open", id),
  renameSession: (oldId: string, newName: string) => ipcRenderer.invoke("agent:sessions-rename", oldId, newName),
  deleteSession: (id: string) => ipcRenderer.invoke("agent:sessions-delete", id),
  // ---- M2g 任务 4：preload 清账（三条历史欠账 + sidechat 四通道一次性接通）----
  // M2d 遗留：记忆删除（仅用户经记忆面板；模型无删除权 §8.1.7）
  deleteMemory: (scope: "project" | "global", topic: string) =>
    ipcRenderer.invoke("agent:memory-delete", scope, topic),
  // M2e 遗留：插件信任卡决议（未信任不激活）
  pluginDecide: (plugin: string, trusted: boolean) =>
    ipcRenderer.invoke("plugin:decide", plugin, trusted),
  // M2f 遗留：辅助对话（sidechat）+ /promote
  sidechatCreate: (parentSessionId: string, name?: string) =>
    ipcRenderer.invoke("agent:sidechat-create", parentSessionId, name),
  sidechatAsk: (sidechatId: string, message: string, parentSessionId?: string) =>
    ipcRenderer.invoke("agent:sidechat-ask", sidechatId, message, parentSessionId),
  sidechatPromote: (req: {
    sidechatId: string;
    parentSessionId: string;
    sourceEventIds: number[];
    note?: string;
  }) => ipcRenderer.invoke("agent:sidechat-promote", req),
  sidechatState: (parentSessionId?: string) => ipcRenderer.invoke("agent:sidechat-state", parentSessionId),
  // M3a：card_action 回写协议（worker 审批应答 / agent 取消）
  cardAction: (req: {
    cardId: string;
    sourceEventId: number;
    cardType: string;
    action: string;
    payload?: Record<string, unknown>;
    scope?: "once" | "session_kind" | "always";
    targetAgentId?: string;
  }) => ipcRenderer.invoke("agent:card-action", req),
  // M4a：定时任务（schedule 面板四通道，§12.2.6）；upsert form 缺省 true，既有任务开关传 false
  scheduleSnapshot: () => ipcRenderer.invoke("agent:schedule-snapshot"),
  scheduleUpsert: (def: unknown, form?: boolean) => ipcRenderer.invoke("agent:schedule-upsert", def, form ?? true),
  scheduleDelete: (id: string) => ipcRenderer.invoke("agent:schedule-delete", id),
  scheduleRunNow: (id: string) => ipcRenderer.invoke("agent:schedule-run-now", id),
  // M4b：BYOK key（safeStorage）/ license / 更新检查（§2.1/§2.2/§2.3）
  providerKeySet: (provider: string, key: string) => ipcRenderer.invoke("agent:provider-key-set", provider, key),
  providerKeyDelete: (provider: string) => ipcRenderer.invoke("agent:provider-key-delete", provider),
  providerKeyStatus: () => ipcRenderer.invoke("agent:provider-key-status"),
  checkUpdate: () => ipcRenderer.invoke("agent:update-check"),
  openExternal: (url: string) => ipcRenderer.invoke("agent:update-open", url),
};

contextBridge.exposeInMainWorld("agent", api);
