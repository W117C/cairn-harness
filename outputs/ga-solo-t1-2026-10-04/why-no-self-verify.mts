// 一档闸已过（9/9 score=1），但它浮出一个 score 看不见的信号：
// **4/9 写过盘却从没自己调过一次通过的 verify**（`writeSessionsWithoutVerifyPass`）。
//
// 那个信号是不是 solo 策略造成的？**不用再跑模型**——2026-09-20 那一跑的
// ga-strategy 三臂事件流都在仓里，离线算一遍就能分辨：
//   · 若只有 solo 臂是 1 ⇒ 是 solo 造成的 ⇒ 一档的「全绿」不足以支持推广；
//   · 若三臂都是 1   ⇒ 是这批任务/这个模型档的基线行为 ⇒ 与策略无关。
//
// ⚠️ 口径：`projectToolChoice` 数的是**主会话**的 verify；worker 子会话里的 verify 不进这格。
//   fanout／supervise 的 worker 各自有独立事件流（`ga-strategy` 把它们写在别处），
//   所以「主会话没验」对这两臂是**公平的比较**——但它**不等于**「整个任务没人验」。
import { readFileSync } from "node:fs";
import { projectSession } from "../../src/agent/tool-choice";

const RUNS: [string, string][] = [
  ["2026-09-20 rep1", "outputs/ga-strategy-2026-09-20"],
  ["2026-09-20 rep2", "outputs/ga-strategy-2026-09-20-rep2"],
  ["2026-09-20 rep3", "outputs/ga-strategy-2026-09-20-rep3"],
];

console.log("=== 离线读数：主会话「写而不验」（2026-09-20 ga-strategy 三臂 × 3 rep）===\n");
const table: Record<string, number[]> = { solo: [], fanout: [], supervise: [] };
for (const [label, dir] of RUNS) {
  const line: string[] = [`  ${label}`];
  for (const arm of ["solo", "fanout", "supervise"] as const) {
    let s;
    try {
      s = projectSession(readEvents(`${dir}/${arm}.events.jsonl`));
    } catch (e) {
      line.push(`${arm}=读不出(${(e as Error).message.slice(0, 30)})`);
      continue;
    }
    table[arm]!.push(s.writeSessionsWithoutVerifyPass);
    line.push(
      `${arm}: 写=${s.writeSessions} 写而不验=${s.writeSessionsWithoutVerifyPass}` +
      ` verify自调=${s.verifySelfCalls} verify通过=${s.verifyPasses}` +
      ` spawn=${s.spawns} 工具=${s.toolCalls}`,
    );
  }
  console.log(line.join("\n"));
  console.log("");
}

console.log("=== 三 rep 汇总 ===");
for (const [arm, v] of Object.entries(table)) {
  if (v.length === 0) { console.log(`  ${arm.padEnd(10)} 无读数`); continue; }
  console.log(`  ${arm.padEnd(10)} 写而不验 = [${v.join(", ")}]  → ${v.filter((x) => x === 1).length}/${v.length} 支「说了但没验」`);
}

function readEvents(p: string) {
  const out = [] as any[];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 截断行跳过 */ }
  }
  return out;
}