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
    // runner-gates 与 gated-tools 共用 fixtures/todo-app 靶子（重置/断言同一目录），
    // 并行跑会文件竞争 → 测试文件级串行（vitest 文件间仍各自隔离模块注册表）。
    fileParallelism: false,
  },
});
