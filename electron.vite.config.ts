import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// 产物路径固定为 out/main/index.js、out/preload/index.js、out/renderer/index.html（任务 1 验收锚点）。
// package.json type=module → 输出 ESM；ESM preload 需要 sandbox:false（见 src/main/index.ts）。

/** PERF-01：内联 CSS 的有界压缩。规则见 renderer 插件 inline-css-minify 的注释。 */
function minifyCss(css: string): string {
  const strings: string[] = [];
  const guarded = css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (s: string): string => {
    strings.push(s);
    return "\u0000" + (strings.length - 1) + "\u0000";
  });
  const out = guarded
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
  return out.replace(/\u0000(\d+)\u0000/g, (_: string, i: string) => strings[Number(i)]);
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // electron 在 devDependencies，electron-vite 不会自动外置；不外置会把 node_modules/electron/index.js
        // 打进 bundle，__dirname 变成 out/main/ → path.txt 误判缺失 → 误触发下载分支后崩溃。
        external: ["electron"],
        output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "[name]-[hash].js" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ["electron"],
        output: { format: "es", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    plugins: [
      // I8（审查 P2）：prod CSP 收紧——renderer 与主进程走 IPC、无出网需求，裸 `ws:`
      // 允许连任意 WebSocket 主机；dev 下 HMR 需要 ws:，故只对 build 产物移除。
      {
        name: "csp-prod-harden",
        apply: "build",
        transformIndexHtml: (html: string): string =>
          html.replace("connect-src 'self' ws:", "connect-src 'self'"),
      },
      {
        // PERF-01：Vite 只处理 link/import 的 CSS，**不处理 HTML 里的内联 <style>**，
        // 于是 89KB 原始格式的 CSS 随 HTML 明文下发——而渲染层走本地文件加载、没有 gzip，
        // 字节即解析量（内联 CSS 占首屏载荷 66%）。这里在产物侧做一次有界压缩。
        // 规则（都是有界的，宁欠勿过）：① 字符串先保护（content:"…" 不许动）② 去注释
        // ③ 折叠空白 ④ 只去 {} ; : , > 周围的空白——**绝不动 + - * /**，calc(20% - 1px)
        // 里运算符两侧的空格是语法 ⑤ 去掉 } 前的分号。源文件保持可读，只压产物。
        name: "inline-css-minify",
        apply: "build",
        transformIndexHtml: (html: string): string =>
          html.replace(/<style>([\s\S]*?)<\/style>/, (_h: string, css: string): string => "<style>" + minifyCss(css) + "</style>"),
      },
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
      },
    },
  },
});