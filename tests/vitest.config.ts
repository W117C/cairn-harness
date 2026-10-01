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

    /* 超时对齐**实测**，不是放松判据（断言一条没动，改的只是"允许多久之内跑完"）。
     *
     * 为什么必须显式给：vitest 缺省 hookTimeout=10s、testTimeout=5s，而这两条现在是**确定性红**：
     *   · `prose-needle-scan.test.ts` 的 `beforeAll` 调 `scanRepo(root)` 整仓扫一遍，
     *     2026-10-01 实测 **10.8 秒**（`node --import tsx -e 'scanRepo(process.cwd())'` 计时），
     *     已越过 10s 缺省 ⇒ 干净检出上这条 suite 必红（合并前 e42b4af 与合并后 d1371dd 同样红，
     *     与本笔的改动无关；这是**仓库长大了**，不是代码坏了）。
     *   · `head-cert-deps.test.ts` 有一条真读本机 `git worktree list` 的用例，树一多就过 5s。
     * 注意这是**按仓库规模增长**的开销：值给宽是买时间，不是治本。
     * 治本是让 `scanRepo` 能增量/缓存（那属于 `scripts/prose-needle-scan.ts` 的活），
     * 在那之前，给足余量比留一条"必红的已知项"好——假红灯会训练人忽略红灯（本仓第 123 页的账）。 */
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
