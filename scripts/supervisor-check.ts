// M5c 编排自适应验收脚本（pnpm supervisor-check，第 26 道门；仿 agents-check 体例）。
// 段：
//   A 受限 Supervisor 封闭性（步骤 11）：任意输入（含畸形 report）→ 输出必属封闭枚举；非法输入 → escalate
//   B 有界性三重保险（步骤 11）：永远 fail 的环 → 第 6 环后必 abort（事件流有对应记录）/ 同 (role, task-hash) 第 3 次 → escalate
//   C Best-of-N 竞争（步骤 12）：N=3 明卷其中恰一个全绿 → 选中项为全绿者 + 早停触发
//   D 早停省钱（步骤 12）：非选中候选终态 cancelled，且 accountable usage 严格小于跑满（全收敛对照）
// 双轨备案（§5.1）：supervisor 审批契约与 pipeline stages 全表分开（supervise 模式接线留 M6，不动旧门）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import { Orchestrator, scriptedWorkerModel, type WorkerModel } from "../src/agent/orchestrator";
import { decideSupervisor, isSupervisorAction, superviseApprovalDigest, type SupervisorAction, type SupervisorContext } from "../src/agent/supervisor";
import { createEventLog } from "../src/events";

let pass = 0;
let fail = 0;
function check(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
  }
}

const ROOT = process.cwd();
const work = await mkdtemp(join(tmpdir(), "m5c-supervisor-check-"));

// ============================== A 受限 Supervisor 封闭性（步骤 11） ==============================
console.log("[supervisor-check] A 受限 Supervisor 封闭性（任意输入 → 枚举；畸形 → escalate）");

const A_CASES: Array<[SupervisorContext, SupervisorAction["kind"]]> = [
  [{ verdict: "pass", stageCount: 1 }, "accept"],
  [{ verdict: "fail", stageCount: 1, lastAgentId: "w1", lastFailure: "挂" }, "retry"],
  [{ verdict: "fail", stageCount: 1 }, "spawn"],
  [{ verdict: "error", stageCount: 2, lastAgentId: "w1" }, "retry"],
  [{ verdict: null, stageCount: 1 }, "escalate"], // 畸形 report
  [{} as SupervisorContext, "escalate"], // 完全畸形（verdict undefined）
  [{ verdict: "pass", stageCount: 6 }, "abort"], // maxStages 耗尽
  [{ verdict: "pass", stageCount: 1, budgetBlocked: true }, "abort"], // 预算闸
  [{ verdict: "pass", stageCount: 1, repeatCount: 3 }, "escalate"], // 防死循环
  [{ verdict: "fail", stageCount: 1, maxStages: 3 }, "spawn"], // 无 lastAgentId → spawn 下一环
];
for (const [ctx, expected] of A_CASES) {
  const a = decideSupervisor(ctx);
  check(isSupervisorAction(a), "A1 封闭枚举（kind=" + String(a.kind) + "）");
  check(a.kind === expected, "A2 预期动作 " + expected + "（实得 " + String(a.kind) + "）");
}

// A3 双轨备案：supervise 审批契约形态 ≠ pipeline stages 全表（§5.1 双轨，接线留 M6）
{
  const digest = superviseApprovalDigest({ goal: "修复 todo", budget: 1.0, forbidden: ["src/secret.ts"], maxStages: 6 });
  check(digest.includes("maxStages=6") && digest.includes("forbidden=src/secret.ts"), "A3 supervise 审批契约 = {goal,budget,forbidden,maxStages}（与 stages 全表分开）");
}

// ============================== B 有界性三重保险（步骤 11） ==============================
console.log("[supervisor-check] B 有界性（maxStages / 防死循环）");

{
  // B1：永远 fail 的环 → 第 6 环后必 abort（maxStages=6 缺省）
  const seq: SupervisorAction[] = [];
  for (let stage = 1; stage <= 12; stage++) {
    const a = decideSupervisor({ verdict: "fail", stageCount: stage, lastAgentId: "w" + String(stage), lastFailure: "fail" });
    seq.push(a);
    if (a.kind === "abort") break;
  }
  check(seq.length === 6 && seq[seq.length - 1]!.kind === "abort", "B1 永远 fail → 第 6 环后必 abort（有界，不无限爬）");
  check(seq.filter((a) => a.kind === "retry").length === 5 && seq.some((a) => a.kind === "abort"), "B1b 事件流有 retry×5 + abort 决策记录");
}

{
  // B2：同 (role, task-hash) 第三次出现 → 强制 escalate（防死循环）
  const first = decideSupervisor({ verdict: "fail", stageCount: 1, lastAgentId: "w1", repeatCount: 1 });
  const second = decideSupervisor({ verdict: "fail", stageCount: 2, lastAgentId: "w1", repeatCount: 2 });
  const third = decideSupervisor({ verdict: "fail", stageCount: 3, lastAgentId: "w1", repeatCount: 3 });
  check(first.kind === "retry" && second.kind === "retry", "B2a 前两次允许 retry");
  check(third.kind === "escalate", "B2b 第三次出现 → 强制 escalate（防死循环）");
}

// ============================== C/D Best-of-N 竞争编排（步骤 12） ==============================
console.log("[supervisor-check] C/D Best-of-N（N=3 选中全绿 / 早停省钱）");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 慢剧本：每轮 sleep，给早停留出确定性窗口（取消发生在 loser 收敛之前）。 */
function slowScripted(script: ModelOutput[], paceMs: number): WorkerModel {
  return async function* () {
    for (const e of script) {
      yield e;
      if (paceMs > 0) await sleep(paceMs);
    }
  };
}

const PASS_SCRIPT: ModelOutput[] = [
  { type: "assistant_message", content: "候选方案：修复。" },
  { type: "assistant_message", content: "verify: pass" },
  { type: "usage", inputTokens: 60, outputTokens: 20 },
];
const FAIL_SCRIPT: ModelOutput[] = [
  ...Array.from({ length: 300 }, (_, i) => ({ type: "assistant_message" as const, content: "候选分析 " + String(i) })),
  { type: "assistant_message", content: "verify: fail" },
  { type: "usage", inputTokens: 400, outputTokens: 100 },
];

/** 候选剧本路由：candidate-1 = 快而全绿；其余 = 慢而必挂。 */
function raceModelFor(args: { context?: unknown }): WorkerModel {
  const ctx = String(args.context ?? "");
  return ctx === "race-candidate-1" ? scriptedWorkerModel(PASS_SCRIPT) : slowScripted(FAIL_SCRIPT, 10);
}

const raceJudge = (r: Extract<AgentEvent, { type: "agent_result" }>): boolean => r.summary.includes("verify: pass");

function newOrch(logPath: string): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: join(ROOT, "fixtures", "todo-app"),
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    modelFor: raceModelFor,
  });
  return { orch, events };
}

function accountableUsage(events: AgentEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type === "agent_result") n += e.usage.inputTokens + e.usage.outputTokens;
  }
  return n;
}

{
  // C：N=3 明卷，恰一个全绿 → 选中项为全绿者 + 早停触发
  const p = join(work, "c.jsonl");
  const { orch, events } = newOrch(p);
  const r = await orch.spawnRace("修复 todo 的 completedCount", 3, raceJudge, { callId: "race-c" });
  check(r.ok, "C1 race 受理");
  const out = JSON.parse(r.output) as { picked: string; candidates: string[]; early_stop: boolean };
  await orch.waitAll(15_000);
  const results = events.filter((e): e is Extract<AgentEvent, { type: "agent_result" }> => e.type === "agent_result");
  const picked = results.find((e) => e.agent_id === out.picked);
  check(picked !== undefined && picked.summary.includes("verify: pass"), "C 选中项为全绿者（candidate-1）");
  check(out.early_stop === true && out.candidates.length === 3, "Cb 早停触发（3 候选）");
}

{
  // D：早停后其余终态 cancelled，且 accountable usage 严格小于跑满（全收敛对照）
  const pEarly = join(work, "d-early.jsonl");
  const { orch: orchE, events: eventsE } = newOrch(pEarly);
  const rE = await orchE.spawnRace("修复 todo", 3, raceJudge, { callId: "race-d" });
  check(rE.ok, "D1 race 早停受理");
  await orchE.waitAll(15_000);
  const cancelledE = eventsE.filter((e) => e.type === "agent_status" && e.status === "cancelled").length;
  check(cancelledE >= 2, "D2 早停后其余 worker 终态 cancelled（≥2）", "cancelled=" + String(cancelledE));
  const usageEarly = accountableUsage(eventsE);

  const pFull = join(work, "d-full.jsonl");
  const { orch: orchF, events: eventsF } = newOrch(pFull);
  const rF = await orchF.spawnRace("修复 todo", 3, () => false, { callId: "race-full" }); // never-pass：全部跑满
  check(!rF.ok, "D3 对照：never-pass judge → 全收敛无胜者");
  await orchF.waitAll(15_000);
  const usageFull = accountableUsage(eventsF);
  check(usageEarly < usageFull, "D4 早停 accountable usage 严格小于跑满（" + String(usageEarly) + " < " + String(usageFull) + "）");
}

await rm(work, { recursive: true, force: true }).catch(() => {});

console.log("[supervisor-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）");
process.exit(fail === 0 ? 0 : 1);
