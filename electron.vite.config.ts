import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// 产物路径固定为 out/main/index.js、out/preload/index.js、out/renderer/index.html（任务 1 验收锚点）。
// package.json type=module → 输出 ESM；ESM preload 需要 sandbox:false（见 src/main/index.ts）。
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
    plugins: [react()],
  },
});