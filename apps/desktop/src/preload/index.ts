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
  // v21：完成通知点击（main 已聚焦窗口）；载荷形状由 renderer 侧校验，这里原样透传。
  onNotificationOpen: (cb: (p: unknown) => void) => subscribe(PUSH_CHANNELS.onNotificationOpen, cb),
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
// 窗口材质只在主进程显式开启时生效；这里只加一个数据集，默认路径不变。
if (process.env.CAIRN_WINDOW_VIBRANCY === "sidebar" || process.env.CAIRN_WINDOW_VIBRANCY === "1" || process.argv.includes("--cairn-vibrancy")) {
  const markVibrancy = (): void => { document.documentElement.dataset.vibrancy = "sidebar"; };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", markVibrancy, { once: true });
  else markVibrancy();
}
