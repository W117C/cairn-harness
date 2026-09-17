// 全局类型胶水：preload 经 contextBridge 暴露的 window.agent（IPC 契约见 ../main/ipc-protocol）。
// 前身叶入口 main.tsx 退役后，保留给 panels/cards 等被测试引用的纯功能模块使用。
import type { AgentApi } from "../main/ipc-protocol";

declare global {
  interface Window {
    agent: AgentApi;
  }
}

export {};