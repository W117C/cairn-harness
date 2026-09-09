import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 只跑根 tests/ 下的用例；fixtures/todo-app 是独立靶子，由它目录里的 pnpm test 负责。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src/renderer", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
