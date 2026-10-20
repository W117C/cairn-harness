/** 任务 #28 的现读（第 334 页候选）：「真跑 bin 那一族的显式 timeout 只给了一条用例」到底还剩几条。
 *  量法说明：这里数的是**调用点形状**，不是判卷条数——一条 `it` 里可能 spawn 三次（装、跑、判），
 *  而缺省超时是**每一次 spawn 各自**撞的，所以分母必须是调用点。
 *  用法：node outputs/bin-timeout-scan-2026-10-03/scan.mjs（读数由调用方 tee） */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "tests"], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".ts"));
const rows = [];
for (const f of files) {
  let t;
  try { t = readFileSync(f, "utf8"); } catch { continue; }
  const spawns = [...t.matchAll(/\b(spawnSync|execFileSync|execSync)\s*\(/g)].length;
  if (spawns === 0) continue;
  const timeouts = [...t.matchAll(/\btimeout\s*:/g)].length;
  const its = [...t.matchAll(/\bit(\.each)?\s*\(/g)].length;
  // 「真跑 bin」的形状：spawn 的是 node/npx + 仓内入口，或直接跑 dist/bin
  const binish = /(m0|bin\/|dist\/|scripts\/[a-z-]+\.ts|--import tsx)/.test(t);
  rows.push({ f, spawns, timeouts, its, binish });
}
rows.sort((a, b) => b.spawns - a.spawns);
console.log(`有 spawn 的判卷 ${String(rows.length)} 份（git 跟踪的 tests/**.ts）`);
for (const r of rows.slice(0, 16)) {
  console.log(`  ${r.f}  spawn=${String(r.spawns)}  显式timeout=${String(r.timeouts)}  it=${String(r.its)}${r.binish ? "  ← 像真跑 bin" : ""}`);
}
const bin = rows.filter((r) => r.binish);
console.log(`\n「像真跑 bin」的 ${String(bin.length)} 份：spawn 合计 ${String(bin.reduce((a, r) => a + r.spawns, 0))}｜显式 timeout 合计 ${String(bin.reduce((a, r) => a + r.timeouts, 0))}`);
const zero = bin.filter((r) => r.timeouts === 0);
console.log(`显式 timeout = 0 的份数：${String(zero.length)} ⇒ ${zero.map((r) => r.f.replace("tests/", "")).join("、") || "（都有）"}`);
console.log("注：这条尺只说形状，不说哪条用例真的撞过 30s 缺省——那要在负载态里看红名（#28 的原读数就是这么来的）。");
