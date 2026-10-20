// preload 桥：invoke 通道程序化生成——通道表的映射类型已钉死完整性，
// 这里不逐通道抄第二份（抄了就有漂移面）。推送三通道显式包装（要退订语义）。
import { contextBridge, ipcRenderer, webUtils } from "electron";
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
  onTerminalData: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onTerminalData, cb),
  onTerminalExit: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onTerminalExit, cb),
  onBrowserState: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onBrowserState, cb),
  onPreviewState: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onPreviewState, cb),
  // 载荷是命令 id 字符串（main 侧只发 id）；subscribe 的入参是 unknown，这里显式过一手。
  onMenu: (cb: (id: string) => void) => subscribe(PUSH_CHANNELS.onMenu, (v) => { cb(String(v)); }),
};

function subscribe(channel: string, cb: (v: unknown) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: unknown) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  ...invokeApi,
  ...pushApi,
  /** 拖放引用（蓝本 §3.1）：DOM File → 磁盘绝对路径（Electron 唯一合法途径 webUtils）。
   *  非 IPC 通道（不占协议版本）；只读映射，不碰任何文件内容。 */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
} as unknown as AgentApi;
contextBridge.exposeInMainWorld("agent", api);
