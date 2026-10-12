import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// SEMA §3.5/§12：renderer 的期望协议版本在**构建期**注入（define 换成字面量，产物零运行时
// import src——「renderer 只经 IPC 协议类型访问核心服务」的红线不破）。
import { IPC_PROTOCOL_VERSION } from "../../src/main/ipc-protocol";

export default defineConfig({
  // `base` 必须是相对路径：主进程用 win.loadFile() 起壳（file:// 协议），vite 缺省的绝对路径
  // `/assets/…` 会解析成 `file:///assets/…` ⇒ 脚本 404 ⇒ `#root` 永远空 ⇒ **整个 React 根从来没
  // 挂载过**。冒烟前半段（window.agent 类型、事件计数、run ok）都在 preload/main 侧，照常绿，
  // 所以这个洞只有 UI 面探针（侧栏条目计数 / ModelPicker）看得见——这正是 B3 说的「CAIRN_SMOKE 测不到」。
  base: "./",
  root: "src/renderer",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
  define: { __IPC_PROTOCOL_VERSION__: JSON.stringify(IPC_PROTOCOL_VERSION) },
});
