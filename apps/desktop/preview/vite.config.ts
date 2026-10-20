import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 独立预览入口：和产品 vite.config.ts 分开，避免预览依赖进入桌面主构建。
// host 固定回环地址，端口 strictPort——被占用直接报错，不静默漂移。
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 4188, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
