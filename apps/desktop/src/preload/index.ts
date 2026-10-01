// preload 桥：invoke 通道程序化生成——通道表的映射类型已钉死完整性，
// 这里不逐通道抄第二份（抄了就有漂移面）。推送三通道显式包装（要退订语义）。
import { contextBridge, ipcRenderer } from "electron";
import type { AgentApi } from "../../../../src/main/ipc-protocol";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "../main/channels";

const invokeApi = Object.fromEntries(
  Object.entries(INVOKE_CHANNELS).map(([key, channel]) => [
    key,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
);

const pushApi = {
  onEvent: (cb: (e: unknown) => void) => subscribe(PUSH_CHANNELS.onEvent, cb),
  onAsk: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onAsk, cb),
  onAskDone: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onAskDone, cb),
};

function subscribe(channel: string, cb: (v: unknown) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: unknown) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = { ...invokeApi, ...pushApi } as unknown as AgentApi;
contextBridge.exposeInMainWorld("agent", api);
