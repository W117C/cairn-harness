import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// SEMA §3.5/§12：renderer 的期望协议版本在**构建期**注入（define 换成字面量，产物零运行时
// import src——「renderer 只经 IPC 协议类型访问核心服务」的红线不破）。
import { IPC_PROTOCOL_VERSION } from "../../src/main/ipc-protocol";
// 生产 CSP 正文（2026-11-15 抽成模块）：判卷直接 import 同一个值，不按源码文本 grep。
import { CSP_CONTENT } from "./src/main/csp";

/**
 * 生产构建注入 CSP（2026-10-17）：消掉 Electron 的「无 CSP / unsafe-eval」安全提示。
 * 只在 build 生效——dev（vite + @vitejs/plugin-react）会往 index.html 里插内联 preamble，
 * 静态写在 index.html 里会把 dev 模式一起打死。指令口径与理由见 src/main/csp.ts。
 */
const cspPlugin: Plugin = {
  name: "cairn-csp",
  apply: "build",
  transformIndexHtml(html) {
    return html.replace(
      "<title>",
      `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}" />\n    <title>`,
    );
  },
};

export default defineConfig({
  // `base` 必须是相对路径：主进程用 win.loadFile() 起壳（file:// 协议），vite 缺省的绝对路径
  // `/assets/…` 会解析成 `file:///assets/…` ⇒ 脚本 404 ⇒ `#root` 永远空 ⇒ **整个 React 根从来没
  // 挂载过**。冒烟前半段（window.agent 类型、事件计数、run ok）都在 preload/main 侧，照常绿，
  // 所以这个洞只有 UI 面探针（侧栏条目计数 / ModelPicker）看得见——这正是 B3 说的「CAIRN_SMOKE 测不到」。
  base: "./",
  root: "src/renderer",
  plugins: [react(), cspPlugin],
  build: { outDir: "../../dist", emptyOutDir: true },
  define: { __IPC_PROTOCOL_VERSION__: JSON.stringify(IPC_PROTOCOL_VERSION) },
});
