// M5c 编排自适应验收脚本（pnpm supervisor-check，第 26 道门；仿 agents-check 体例）。
// 段：
//   A 受限 Supervisor 封闭性（步骤 11）：任意输入（含畸形 report）→ 输出必属封闭枚举；非法输入 → escalate
//   B 有界性三重保险（步骤 11）：永远 fail 的环 → 第 6 环后必 abort（事件流有对应记录）/ 同 (role, task-hash) 第 3 次 → escalate
//   C Best-of-N 竞争（步骤 12）：N=3 明卷其中恰一个全绿 → 选中项为全绿者 + 早停触发
//   D 早停省钱（步骤 12）：非选中候选终态 cancelled，且 accountable usage 严格小于跑满（全收敛对照）
// 双轨备案（§5.1）：supervisor 审批契约与 pipeline stages 全表分开（supervise 模式接线留 M6，不动旧门）。
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import type { GlmMessage } from "../src/providers/glm";
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

// ============================== E supervise 模式运行时接线（M6 双轨 surgery） ==============================
console.log("[supervisor-check] E supervise 模式运行时（审批双轨契约 / 受限循环 / 有界中止 / 接受路径）");

const E_FAIL_SCRIPT: ModelOutput[] = [
  { type: "assistant_message", content: "环 worker 尝试修复。" },
  { type: "assistant_message", content: "verdict: fail" },
];
const E_PASS_SCRIPT: ModelOutput[] = [
  { type: "assistant_message", content: "环 worker 修复完成。" },
  { type: "assistant_message", content: "verdict: pass" },
];

function newOrchSup(logPath: string, script: ModelOutput[]): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: join(ROOT, "fixtures", "todo-app"),
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    modelFor: () => scriptedWorkerModel(script),
  });
  return { orch, events };
}

/** E6/E7 专用：可指定 workspace（一次性临时 git repo——合并场景不污染 fixtures/todo-app 靶子）
 *  与 capture（抓 worker 每轮真实上下文，提示词层断言用）。 */
function newOrchSupWs(
  logPath: string,
  script: ModelOutput[],
  workspace: string,
  capture?: GlmMessage[][],
): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    modelFor: () => scriptedWorkerModel(script, capture),
  });
  return { orch, events };
}

/** 一次性 git repo（seed 一个 README 初始提交）：E6 合并 / E7 禁改面场景的隔离工作区。 */
async function makeTempRepo(parent: string): Promise<string> {
  const ws = join(parent, "repo-" + Math.random().toString(36).slice(2, 8));
  await mkdir(ws, { recursive: true });
  const g = async (...args: string[]): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      execFile("git", args, { cwd: ws }, (err) => (err === null ? resolve() : reject(err)));
    });
  };
  await g("init");
  await g("config", "user.email", "check@local");
  await g("config", "user.name", "supervisor-check");
  await writeFile(join(ws, "README.md"), "seed\n", "utf8");
  await g("add", "-A");
  await g("commit", "-m", "seed");
  return ws;
}

async function waitFor(pred: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return pred();
}

{
  // E1/E2/E3：审批双轨契约 + 永远 fail → maxStages 有界中止（事件流有 [supervisor] 记录）
  const p = join(work, "e1.jsonl");
  const { orch, events } = newOrchSup(p, E_FAIL_SCRIPT);
  const spawnP = orch.spawn(
    { mode: "supervise", task: "修复 todo 的 completedCount", supervise: { maxStages: 3, forbidden: ["tests"] } },
    { callId: "sup-e1" },
  );
  check(await waitFor(() => events.some((e) => e.type === "approval_requested")), "E1a supervise 审批落流");
  const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }> | undefined;
  check(
    (apr?.args_digest ?? "").includes("supervise 授权") && (apr?.args_digest ?? "").includes("maxStages=3") && (apr?.args_digest ?? "").includes("forbidden=tests"),
    "E1 审批卡批准 {goal,budget,forbidden,maxStages}（双轨契约，非 stages 全表）",
  );
  check(
    (apr?.risk_reasons ?? []).some((r) => r.includes("非 stages 全表") && r.includes("受限循环授权")),
    "E1b 双轨标注：与 pipeline stages 全表审批分开",
  );
  check(apr !== undefined && orch.decideWorkerApproval(apr.id, true, "once").ok, "E1c 决议受理");
  const r1 = await spawnP;
  await orch.waitAll(15_000);
  check(!r1.ok && r1.output.includes("maxStages 耗尽"), "E3 永远 fail → maxStages=3 有界中止（" + r1.output.slice(0, 60) + "）");
  const spawnedSup = events.filter((e) => e.type === "agent_spawned");
  check(spawnedSup.length === 3, "E3b 恰好 3 环（≤ maxStages，不无限爬）");
  check(
    events.some((e) => e.type === "agent_message" && e.kind === "progress" && (e as { text: string }).text.includes("[supervisor]") && (e as { text: string }).text.includes("abort")),
    "E3c 事件流有 [supervisor] abort 决策记录",
  );
  check(events.some((e) => e.type === "approval_resolved" && e.decision === "approved"), "E3d approval_resolved(approved) 落流");
}

{
  // E4：拒绝 → fail-closed（受限循环不启动，零环 worker）
  const p = join(work, "e4.jsonl");
  const { orch, events } = newOrchSup(p, E_FAIL_SCRIPT);
  const spawnP = orch.spawn({ mode: "supervise", task: "修复 todo", supervise: { maxStages: 3 } }, { callId: "sup-e4" });
  check(await waitFor(() => events.some((e) => e.type === "approval_requested")), "E4a 审批落流");
  const apr4 = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }> | undefined;
  check(apr4 !== undefined && orch.decideWorkerApproval(apr4.id, false, "once").ok, "E4b 拒绝决议受理");
  const r4 = await spawnP;
  await orch.waitAll(10_000);
  check(!r4.ok && r4.output.includes("未获批准"), "E4c 拒绝 → fail-closed 不启动循环");
  check(events.filter((e) => e.type === "agent_spawned").length === 0, "E4d 拒绝后零环 worker");
}

{
  // E5：pass → 单环接受（gate loopback 闭合：实现→判据→接受）
  const p = join(work, "e5.jsonl");
  const { orch, events } = newOrchSup(p, E_PASS_SCRIPT);
  const spawnP = orch.spawn({ mode: "supervise", task: "修复 todo", supervise: { maxStages: 6 } }, { callId: "sup-e5" });
  check(await waitFor(() => events.some((e) => e.type === "approval_requested")), "E5a 审批落流");
  const apr5 = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }> | undefined;
  check(apr5 !== undefined && orch.decideWorkerApproval(apr5.id, true, "once").ok, "E5b 决议受理");
  const r5 = await spawnP;
  await orch.waitAll(10_000);
  check(r5.ok && (r5.output ?? "").includes('"status":"accepted"'), "E5c 单环 verdict:pass → 接受（gate loopback 闭合）");
  check(events.filter((e) => e.type === "agent_spawned").length === 1, "E5d 恰好 1 环");
}

{
  // E6（P1 回归）：写面改动全部来自 shell_rw（toolStats.write_file/edit_file 恒 0）→ accept 后必须
  // 走合并落盘。旧实现按 write_file/edit_file 的工具调用计数判「有真实写改动」：shell_rw 改的文件
  // 计数为 0 → 已 accept 的成果被 cleanupWrite("rejected") 静默删光（功能成功 + 数据丢失）。
  // 改后以 finishInner 的 worktreeDiff files_changed 为准。工作区 = 一次性临时 repo（不污染靶子）。
  const repoE6 = await makeTempRepo(work);
  const p6 = join(work, "e6.jsonl");
  const { orch, events } = newOrchSupWs(p6, [
    { type: "tool_call", id: "c1", name: "shell_rw", args: { command: "printf 'x' >> note.txt" } },
    { type: "assistant_message", content: "已通过 shell_rw 完成修改。" },
    { type: "assistant_message", content: "verdict: pass" },
  ], repoE6);
  const spawnP = orch.spawn({ mode: "supervise", task: "在 note.txt 追加一行", supervise: { maxStages: 3 } }, { callId: "sup-e6" });
  check(await waitFor(() => events.some((e) => e.type === "approval_requested")), "E6a 审批落流");
  const apr6 = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }> | undefined;
  check(apr6 !== undefined && orch.decideWorkerApproval(apr6.id, true, "once").ok, "E6b 决议受理");
  const r6 = await spawnP;
  await orch.waitAll(15_000);
  check(r6.ok && (r6.output ?? "").includes('"merged":true'), "E6 shell_rw-only 改动 → accept 合并落盘（不再静默清理）", (r6.output ?? "").slice(0, 90));
  check(events.some((e) => e.type === "tool_result" && e.ok === true && typeof e.output === "string" && e.output.startsWith("[merged]")), "E6b [merged] 审计事件落流");
  const { readFile: readFileE6 } = await import("node:fs/promises");
  const landed = await readFileE6(join(repoE6, "note.txt"), "utf8").then(() => true).catch(() => false);
  check(landed, "E6c 成果真实落盘（主 checkout 出现 note.txt）");
}

{
  // E7（P1 回归）：forbidden 契约强制层——worker 触碰禁改面（tests）→ 报告 verdict 不采信，注入
  // fail 走既有有界决策机 → maxStages 耗尽 abort（不 accept、不合并、主 checkout 零污染）；
  // 提示词层 constraints 同步可见（旧实现 forbidden 塞字符串被 parseWorkerContext 丢弃，零落地）。
  const repoE7 = await makeTempRepo(work);
  const p7 = join(work, "e7.jsonl");
  const captured: GlmMessage[][] = [];
  const { orch, events } = newOrchSupWs(p7, [
    { type: "tool_call", id: "c1", name: "shell_rw", args: { command: "mkdir -p tests && printf 'v' >> tests/violated.txt" } },
    { type: "assistant_message", content: "改完了。" },
    { type: "assistant_message", content: "verdict: pass" },
  ], repoE7, captured);
  const spawnP = orch.spawn(
    { mode: "supervise", task: "修改 completedCount", supervise: { maxStages: 3, forbidden: ["tests"] } },
    { callId: "sup-e7" },
  );
  check(await waitFor(() => events.some((e) => e.type === "approval_requested")), "E7a 审批落流");
  const apr7 = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }> | undefined;
  check(apr7 !== undefined && orch.decideWorkerApproval(apr7.id, true, "once").ok, "E7b 决议受理");
  const r7 = await spawnP;
  await orch.waitAll(15_000);
  check(!r7.ok && (r7.output ?? "").includes("maxStages 耗尽"), "E7 forbidden 触碰 → verdict 不采信 → 有界中止（不 accept）", (r7.output ?? "").slice(0, 90));
  check(events.filter((e) => e.type === "agent_spawned").length === 3, "E7b 恰好 3 环（每环触碰禁改面 → 全部按 fail 处理，防死循环兜底不变）");
  check(!events.some((e) => e.type === "tool_result" && typeof e.output === "string" && e.output.startsWith("[merged]")), "E7c 零合并（禁改面改动不落盘）");
  check(events.some((e) => e.type === "agent_message" && e.kind === "progress" && (e as { text: string }).text.includes("forbidden 违反")), "E7d [supervisor] 违反决策落流");
  check(captured.some((msgs) => msgs.some((m) => typeof m.content === "string" && m.content.includes("supervise-forbidden"))), "E7e 提示词层：constraints 含 supervise-forbidden（禁改面）");
}

await rm(work, { recursive: true, force: true }).catch(() => {});

console.log("[supervisor-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）");
process.exit(fail === 0 ? 0 : 1);
