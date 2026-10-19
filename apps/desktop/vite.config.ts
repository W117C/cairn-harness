import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// SEMA §3.5/§12：renderer 的期望协议版本在**构建期**注入（define 换成字面量，产物零运行时
// import src——「renderer 只经 IPC 协议类型访问核心服务」的红线不破）。
import { IPC_PROTOCOL_VERSION } from "../../src/main/ipc-protocol";

/**
 * 生产构建注入 CSP（2026-10-17）：消掉 Electron 的「无 CSP / unsafe-eval」安全提示。
 * 只在 build 生效——dev（vite + @vitejs/plugin-react）会往 index.html 里插内联 preamble，
 * 静态写在 index.html 里会把 dev 模式一起打死。口径：
 *   · 脚本只跑打包产物（'self'，无 eval）；
 *   · 样式必须放 inline（Radix / xterm 都写行内样式）；
 *   · 图片允许 data:/blob:/https:（消息里的远程图照常显示，不静默改成破图）；
 *   · 连接面允许 http(s)/ws(s)（本地预览与 dev HMR）；不放 object/base。
 */
const CSP_CONTENT = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

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
