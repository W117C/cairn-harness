// 预加载：把最小 API 面暴露给 renderer（contextBridge；renderer 无 Node 能力）。
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  AgentApi,
  AgentEvent,
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
  onEvent: (cb: (e: AgentEvent) => void) => subscribe<AgentEvent>("agent:event", cb),
  onAsk: (cb: (p: AskPayload) => void) => subscribe<AskPayload>("agent:ask", cb),
  onAskDone: (cb: (p: AskOutcomePayload) => void) => subscribe<AskOutcomePayload>("agent:ask-done", cb),
  getState: () => ipcRenderer.invoke("agent:state"),
};

contextBridge.exposeInMainWorld("agent", api);
