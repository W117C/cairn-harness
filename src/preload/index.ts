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
  run: (req: RunRequest & { sessionId?: string }) => ipcRenderer.invoke("agent:run", req),
  decide: (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always") =>
    ipcRenderer.invoke("agent:decide", askId, approved, scope),
  submitClarify: (callId: string, answers: Record<string, string | string[]>) =>
    ipcRenderer.invoke("agent:clarify", callId, answers),
  decidePlan: (approved: boolean, callId?: string) => ipcRenderer.invoke("agent:plan", approved, callId),
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
};

contextBridge.exposeInMainWorld("agent", api);
