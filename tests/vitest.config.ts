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

    /* `testTimeout` 对齐**实测**，不是放松判据（断言一条没动，改的只是"允许多久之内跑完"）。
     *
     * 为什么给：`head-cert-deps.test.ts` 有一条**真读本机 `git worktree list`** 的用例
     * （"真读现喂：…不许崩，且绝不点到自己这棵"），树一多在**有并发负载**时就会越过 vitest 缺省
     * 的 5 秒。2026-10-01 实测：单独跑绿，整表并发跑时红成 `Test timed out in 5000ms.`
     * ——那是**假红灯**，而假红灯会训练人忽略红灯（本仓第 123 页的账）。
     *
     * **这里刻意不设 `hookTimeout`**：钩子那半边（`prose-needle-scan` 的整仓扫 10.8s > 缺省 10s）
     * 已由第 291 页在**那两个重钩子**上显式声明 `HOOK_BUDGET_MS = 30_000` 解决，并配了
     * "恰好两支钩子声明了预算"的形状判卷与变异锚点。在 config 里再给一个全局默认
     * ＝同一个问题两套机制（本仓反复点名的"抄第二份迟早漂"），所以那半边不在这重复落地。 */
    testTimeout: 30_000,
  },
});
