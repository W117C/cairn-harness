/** #28 的现读探针：不靠合成输入自证——同一份谓词喂**真 ps**。
 *  跑法：`node --import tsx outputs/cert-concurrency-2026-09-27/check.mts`
 *  （判卷面已有 6 条合成用例覆盖形状；这里要的是"真机取料列对得上"这一格。） */
import { spawnSync } from "node:child_process";

import { collisionHint, concurrencyReading, countConcurrentSuites } from "../../scripts/lib/head-cert-deps";

const SHAPE = "vitest.mjs run --config tests/vitest.config.ts";
// 逐字取自 09-27 真 ps（两行一套：外层 shell 把命令写全 + node 子进程；第三行是 vitest 的 worker，不该被认成第二套）
const ONE = [
  "  PID  PGID COMMAND",
  " 9113  9113 /bin/zsh -c source /tmp/snap.sh && node node_modules/" + SHAPE + " 2>&1 | tail -60",
  " 9116  9113 node node_modules/" + SHAPE,
  " 9118  9113 /usr/bin/node --require /repo/node_modules/vitest/suppress-warnings.cjs /repo/node_modules/vitest/dist/workers/forks.js",
].join("\n");
// 真机现行（变异机起的）：`run` 与 `--config` **中间**插了 --pool ⇒ 按字面串匹配会读成 0 套
const POOLED = " 95637 28142 /Users/ze/.hermes/node/bin/node /repo/.worktrees/verify-155/node_modules/vitest/vitest.mjs run --pool=threads --config tests/vitest.config.ts tests";
// 看门的那行：今天我自己写的等窗循环长这样，它带着同样的字面但没在跑判卷
const WATCHER = "  1234  1234 /bin/zsh -c pgrep -f " + SHAPE;

const checks: [string, unknown, unknown][] = [
  ["一套两行（shell 包装 + node 子进程）⇒ 数成 1", countConcurrentSuites(ONE), 1],
  ["两个 pgid ⇒ 2", countConcurrentSuites(ONE + "\n 2222  2222 node node_modules/" + SHAPE), 2],
  ["无匹配 ⇒ 0（真独占）", countConcurrentSuites("  PID  PGID COMMAND\n 100  100 node scripts/typecheck.ts\n"), 0],
  ["少 pgid 列 ⇒ -1（不许读成 0）", countConcurrentSuites("node node_modules/" + SHAPE), -1],
  ["ps 坏了 ⇒ -1", countConcurrentSuites(null), -1],
  ["插了 --pool 的现行形状 ⇒ 认得出（旧字面串在这里读成 0）", countConcurrentSuites("  PID  PGID COMMAND\n" + POOLED), 1],
  ["看门那行不算一套", countConcurrentSuites("  PID  PGID COMMAND\n" + WATCHER), 0],
  ["红+并行 ⇒ 点名套数", collisionHint(1, 0, 2)?.includes("2"), true],
  ["绿 ⇒ 不出声", collisionHint(0, 3, 3), null],
  ["没跑判卷 ⇒ 不出声", collisionHint(null, 3, 3), null],
  ["红但独占 ⇒ 不许甩锅", collisionHint(1, 0, 0), null],
  ["红但取不到 ⇒ 不许断言有人并行", collisionHint(1, -1, -1), null],
  ["未采那一支", concurrencyReading(-1, -1, false).includes("未采"), true],
  ["取不到那一支", concurrencyReading(-1, -1, true).includes("取不到"), true],
  ["独占那一支", concurrencyReading(0, 0, true).includes("独占"), true],
  ["取不到那一支不印「 0 套」", concurrencyReading(-1, -1, true).includes(" 0 套"), false],
  ["撞窗那一支印数", concurrencyReading(0, 1, true).includes("撞窗"), true],
];

let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`${ok ? "✅" : "❌"} ${name} — got=${String(got)} want=${String(want)}`);
}

// 真机取料：此刻这台机器上有几套判卷在跑（本探针跑的时候，另一棵树里的全表变异正在连续起 vitest）。
const ps = spawnSync("ps", ["-eo", "pid,pgid,command"], { encoding: "utf8" });
const realOut = ps.status === 0 ? ps.stdout : null;
const realLines = (realOut ?? "").split("\n").filter((l) => l.includes("vitest.mjs"));
console.log(`\n真 ps：status=${String(ps.status)} 含 vitest.mjs 的行 ${String(realLines.length)} 行 ⇒ 判卷套数 ${String(countConcurrentSuites(realOut))}`);
for (const l of realLines) console.log("  " + l.trim().slice(0, 130));
console.log("  汇总行样子：" + concurrencyReading(countConcurrentSuites(realOut), countConcurrentSuites(realOut), true));

console.log(bad === 0 ? `\n合成 ${String(checks.length)} 条一致` : `\n${String(bad)} 条不一致`);
process.exit(bad === 0 ? 0 : 1);
