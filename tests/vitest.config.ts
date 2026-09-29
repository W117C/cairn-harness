import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// M7 影响面测试（ledger / solpi-review-regression / final-budget / session-tools）要求
// PI_SCRATCH_DIR 指向一个**已存在**且**在工作区之外**的目录（mkdtemp 需要父目录存在；
// 判卷纪律：测试数据绝不落工作区）。旧实现部分文件用 `?? tmpdir()` 兜底、部分用 `!` 非空断言，
// 后者在 `pnpm test` 未注入该环境变量时整 describe 0ms 全挂（31 条假红）。
// 在此统一兜底：缺省指向 OS 临时目录下的固定子目录并确保存在。配置在主进程加载、worker fork 之前，
// 故对全部 pool 生效。
if (!process.env.PI_SCRATCH_DIR) process.env.PI_SCRATCH_DIR = join(tmpdir(), "dsh-pi-scratch");
mkdirSync(process.env.PI_SCRATCH_DIR, { recursive: true });

// M7 影响面缓存目录同理。`impactAnalysis` 2026-09-27 翻成缺省开之后，`handleAgentRun` 造的
// 缺省钩子会走进 11 个本来只跑 agent 的用例（原来只有 impact-runner-wiring 走得到），
// 而 `defaultImpactCacheDir()` 的兜底是 `~/.m0-agent-loop/impact-tags` —— 一次 `pnpm test`
// 就往用户真实应用数据目录里写建图缓存。测试数据绝不落工作区，也绝不落用户的家目录。
if (!process.env.M7_IMPACT_TAGS_DIR) process.env.M7_IMPACT_TAGS_DIR = join(tmpdir(), "dsh-impact-tags");
mkdirSync(process.env.M7_IMPACT_TAGS_DIR, { recursive: true });

// 只跑根 tests/ 下的用例；fixtures/todo-app 是独立靶子，由它目录里的 pnpm test 负责。
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // runner-gates 与 gated-tools 共用 fixtures/todo-app 靶子（重置/断言同一目录），
    // 并行跑会文件竞争 → 测试文件级串行（vitest 文件间仍各自隔离模块注册表）。
    fileParallelism: false,
  },
});
