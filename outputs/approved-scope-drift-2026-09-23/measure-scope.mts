/** 能力 27「批准面 vs 执行面」取证探针（三问）：
 *  ① 真语料：批准过的文件集合与实际写入集合，越界有多少？（差集今天没人算）
 *  ② 真 `deriveProgressBoundaries`：同样一场"验过了"的 run，
 *     全部在批准面内 vs 一半越界 —— 机器给不给不同的读数？（预期：一模一样 ⇒ 越界零代价还被算作前进）
 *  ③ 谁在信 `covered`：经济面消费者清单（决定这条读数的下游有多广）。
 *  跑法：TERM=dumb node --import tsx outputs/approved-scope-drift-2026-09-23/measure-scope.mts
 *  只读源码与语料，不写任何文件。 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveProgressBoundaries } from "../../src/agent/economics";
import type { AgentEvent } from "../../src/events";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readAbs = (abs: string): string => (existsSync(abs) ? readFileSync(abs, "utf8") : "");

// ---------------- ① 真语料的越界面 ----------------
const dirs = ["fixtures/no-progress", "fixtures/agents", "fixtures/mock",
  "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2", "outputs/ga-strategy-2026-09-20-rep3",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "tmp/ga-smoke"];
const files: string[] = [];
for (const d of dirs) {
  let ns: string[] = [];
  try { ns = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const n of ns) if (n.endsWith(".jsonl")) files.push(join(ROOT, d, n));
}
let withPlan = 0, outScoped = 0, outPaths = 0, writesAfterApproval = 0;
const examples: string[] = [];
for (const f of files) {
  const body = readAbs(f);
  if (body === "") continue;
  const evs: Record<string, unknown>[] = [];
  for (const l of body.split("\n").filter(Boolean)) {
    try { evs.push(JSON.parse(l) as Record<string, unknown>); } catch { /* 逐行容错 */ }
  }
  const proposals = new Map<string, string[]>();
  const approved = new Set<string>();
  let approvedPaths = new Set<string>();
  let seenApproval = false;
  const wrote = new Set<string>();
  for (const e of evs) {
    if (e.type === "plan_proposed") {
      const plan = (e.plan ?? {}) as { files?: Array<{ path?: string }> };
      proposals.set(String(e.callId ?? ""), (plan.files ?? []).map((x) => String(x.path ?? "")).filter((s) => s !== ""));
    } else if (e.type === "plan_approved" && e.approved === true) {
      const paths = proposals.get(String(e.callId ?? ""));
      if (paths !== undefined) { approvedPaths = new Set(paths); seenApproval = true; }
      approved.add(String(e.callId ?? ""));
    } else if (e.type === "tool_call" && seenApproval &&
      (e.name === "write_file" || e.name === "edit_file")) {
      const args = (e.args ?? {}) as Record<string, unknown>;
      const p = String(args.path ?? "");
      if (p !== "") { writesAfterApproval++; wrote.add(p); }
    }
  }
  if (!seenApproval) continue;
  withPlan++;
  const over = [...wrote].filter((p) => !approvedPaths.has(p));
  if (over.length > 0) {
    outScoped++; outPaths += over.length;
    if (examples.length < 4) examples.push(`${f.slice(ROOT.length + 1)}：批准 ${approvedPaths.size} 个，越界 ${over.length} 个（${over.slice(0, 3).join(", ")}）`);
  }
}
console.log("## ① 真语料的批准面 vs 执行面");
console.log(`   语料 ${files.length} 个文件；有「方案被批准」的会话 ${withPlan} 个；批准后发生的写侧调用 ${writesAfterApproval} 次`);
console.log(`   其中**写过批准面外路径**的会话：${outScoped} 个 / 越界路径合计 ${outPaths} 个`);
for (const x of examples) console.log("      " + x);
if (outScoped === 0) console.log("      ⇒ 这批 fixture 短跑里没有越界样本（不等于不会发生，见 ② 的机器判读）");

// ---------------- ② 真经济面对越界的反应 ----------------
type Ev = Record<string, unknown>;
function run(writes: string[]): { verified: number; user: number; n: number } {
  const evs: Ev[] = [
    { type: "user_message", content: "修 total 的 bug" },
    { type: "tool_call", id: "p1", name: "propose_plan", args: { approach: "改一行", goal: "修 total", files: [{ action: "edit", path: "src/a.ts", summary: "改计数" }] } },
    { type: "plan_proposed", callId: "p1", plan: { goal: "修 total", approach: "改一行", files: [{ action: "edit", path: "src/a.ts", summary: "改计数" }] } },
    { type: "plan_approved", callId: "p1", approved: true },
    // 真实流程里 propose_plan 自己也要有一条 tool_result（「方案已批准，写工具解锁」）。
    // 缺了它，`pending` 永不清空、机器一条 verified 边界都不出——本探针第一版就栽在这儿，
    // 把「1 条 user 边界」读成了「1 条前进边界」。
    { type: "tool_result", callId: "p1", ok: true, output: "方案已批准，写工具解锁" },
  ];
  writes.forEach((p, i) => {
    evs.push({ type: "tool_call", id: `w${i}`, name: "write_file", args: { path: p, content: "x" } });
    evs.push({ type: "tool_result", callId: `w${i}`, ok: true, output: "已写入" });
  });
  evs.push({ type: "tool_call", id: "v1", name: "verify", args: {} });
  evs.push({ type: "tool_result", callId: "v1", ok: true, output: "全部通过" });
  evs.push({ type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [{ command: "node --test", ok: true, output: "pass" }] });
  const b = deriveProgressBoundaries(evs as unknown as AgentEvent[]);
  return {
    verified: b.filter((x) => x.kind === "verified").length,
    user: b.filter((x) => x.kind === "user").length,
    n: evs.length,
  };
}
const inScope = run(["src/a.ts"]);
const crossed = run(["src/a.ts", "src/b.ts", "src/c.ts"]);
const onlyOut = run(["src/z.ts"]);
const nothing = run([]);
console.log("\n## ② 真 deriveProgressBoundaries 对越界的反应（只数 verified 边界）");
const line = (tag: string, r: { verified: number; user: number }): string =>
  `   ${tag.padEnd(38)} verified 前进边界 ${r.verified} 条（user 边界 ${r.user} 条，与越界无关）`;
console.log(line("批准 1、只写批准的那 1 个（合规）  ", inScope));
console.log(line("批准 1、实际写 3 个（越界 2）      ", crossed));
console.log(line("批准 1、一个都没按批准做（只写 z） ", onlyOut));
console.log(line("批准 1、什么都没写（对照）        ", nothing));
console.log("   ⇒ 精确结论（比「越界零代价」更窄也更值得修）：机器**只抓得住「批准的那项完全没做」**，");
console.log("     而**合规 + 顺手多改 2 个文件**与纯合规给出的边界读数**一模一样**（都是 1 条 verified）。");
console.log("     根因就是 `planCovered` 那个单向式子：`批准集 ⊆ 已做集`——多出来的成员永远不违反它。");
console.log("     ⇒ 越界被计入「前进」的那一半是**真的**（cost-per-progress 的分子收下所有写动作），");
console.log("       而「完全没照批准做」反倒会被拒——**判据的严格方向正好反了**。");

// ---------------- ③ 谁在信这个读数 ----------------
const consumers: string[] = [];
for (const rel of ["src/agent/cost-per-progress.ts", "src/agent/compaction.ts", "src/agent/solpi-runtime.ts", "src/agent/glm-session.ts"]) {
  if (/deriveProgressBoundaries|deriveBoundaries|replayEconomicState|economicGate|snapToProgressBoundary/.test(readAbs(join(ROOT, rel)))) consumers.push(rel);
}
console.log("\n## ③ 经济面的下游消费者（决定这条读数的影响半径）");
for (const c of consumers) console.log("   " + c);
console.log(`   ⇒ ${consumers.length} 处下游：成本÷前进（能力 15）、压缩的经济闸、SoL-Pi 状态回放、GLM 会话读数——`);
console.log("     它们全都建立在同一个 `covered` 上，而这个集合**从不区分「批准的」与「顺手改的」**。");
