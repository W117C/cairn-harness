/** 第 335 页 · 十条能力的零花费现读（跑在干净 HEAD 树里，读数只归这一棵树）。
 *  动机：门的「绿」只说"没坏"，不说"这一格有数字"。本脚本把每条能力**实际能报出来的那行读数**抓下来，
 *  分三态记：有数字／只有绿／根本没有观测者。全部命令零模型花费。
 *  用法：node outputs/capability-rescore-2026-10-04/rescore.mjs <干净树绝对路径> */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// 复用仓里那把剥色尺（scripts/lib/vitest-summary.ts）。本脚本第一版自己抄了一份 `[ESC]\[[0-9;]*m`，
// 字符类没闭合 ⇒ 实际等价于"删掉任意一个 m 和它前面的数字/分号"，读数里的 `[map-check]`、`transform`、
// `src/main/…` 全被静默吃掉——数字看着还对，字已经不在了。
import { stripAnsi } from "../../scripts/lib/vitest-summary.ts";

const TREE = process.argv[2];
if (TREE === undefined || TREE === "") { console.error("用法：node --import tsx rescore.mjs <干净树路径>"); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "capability-readings.log");

const CAPS = [
  ["①仓库级代码理解", "map-check", ["--import", "tsx", "scripts/map-check.ts"]],
  ["①模型可见文本的证人面", "probe-promise-recall", ["--import", "tsx", "scripts/probe-promise-recall.ts"]],
  ["②精确编辑（补丁形状与最小面）", "assertion-health", ["--import", "tsx", "scripts/assertion-health.ts"]],
  ["③工具调用与环境操作", "web-fetch-check", ["--import", "tsx", "scripts/web-fetch-check.ts"]],
  ["④长程规划与目标漂移", "vitest-goal-drift", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/goal-drift.test.ts"]],
  ["⑤执行-验证-修正（返修那一拍，真轨迹）", "vitest-repair", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/repair-loop-real-verify.test.ts"]],
  ["⑤自动验证补的绿", "vitest-autoverify", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/auto-verify-repair.test.ts"]],
  ["⑥记忆与上下文", "memory-check", ["--import", "tsx", "scripts/memory-check.ts"]],
  ["⑥上下文压缩", "compaction-check", ["--import", "tsx", "scripts/compaction-check.ts"]],
  ["⑦安全与权限", "security-check", ["--import", "tsx", "scripts/security-check.ts"]],
  ["⑦沙箱", "sandbox-check", ["--import", "tsx", "scripts/sandbox-check.ts"]],
  ["⑧人机协作（档位与表面）", "model-surface-check", ["--import", "tsx", "scripts/model-surface-check.ts"]],
  ["⑧自主档", "autonomy-check", ["--import", "tsx", "scripts/autonomy-check.ts"]],
  ["⑨成本可观测", "cost-per-progress-check", ["--import", "tsx", "scripts/cost-per-progress-check.ts"]],
  ["⑩评估：每 run 终态记分卡", "vitest-scorecard", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/replay-run-scorecard.test.ts"]],
  ["⑩基准可达性（零花费）", "loop-eval-feasibility", ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", "fixtures/bench/tasks.json", "--feasibility"]],
];

const lines = [];
const say = (s) => { lines.push(s); };
say("# 十条能力零花费现读 · 树=" + TREE);
say("");
for (const [cap, name, args] of CAPS) {
  const r = spawnSync(process.execPath, args, { cwd: TREE, encoding: "utf8", timeout: 240000 });
  const out = stripAnsi((r.stdout ?? "") + (r.stderr ?? ""));
  const code = r.status === null ? "取不到（超时或被杀）" : String(r.status);
  say("=== " + cap + " ｜ " + name + " ｜ exit=" + code);
  const keep = out.split("\n").filter((l) => l.trim() !== "").slice(-120);
  for (const l of keep) say("  " + l.slice(0, 200));
  say("");
}
writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log("写好了：" + OUT + "（" + String(lines.length) + " 行）");
