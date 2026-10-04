// 三门全链验收（M1b）：
//   前置：判卷文件 sha256 与冻结基线一致
//   写禁三断言（任务 2）：①未批准时写工具被拒 ②批准后同一调用放行 ③只读工具任何阶段不拦
//   全链明卷（任务 5）：fixtures/gate/gate-flow.jsonl 冻结剧本驱动
//     「含歧义任务 → clarify → plan → 批准 → 写 → verify 通过」
//     断言事件序列依次含 clarify_requested、plan_proposed、tool_call(write_file)、verify_result(ok)
//   暗卷（任务 6，有 key 才跑）：真实 GLM 跑同一任务，断言模型至少各调一次 clarify 与 propose_plan；
//     无 key → 退出码 0 并打印「暗卷跳过（无 CAIRN_API_KEY）」
// 任一断言失败 → 退出码非 0。
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { vitestSummary } from "./lib/vitest-summary";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../src/agent/loop";
import { ClarifyGate, PlanGate } from "../src/agent/gates";
import { createVerifyHook } from "../src/agent/verify";
import { buildGlmHistory, createGlmSessionProvider, gateToolSpecs } from "../src/agent/glm-session";
import { approvePlan, markPlanProposed, resetPlanState } from "../src/permissions";
import { sha256MatchesFrozen, sha256MatchesDemoFrozen, frozenCoverageDrift } from "../src/frozen";
import { createMockProvider } from "../src/providers/mock";
import { TOOLS } from "../src/tools";
import { createEventLog, replay, type AgentEvent, type ClarifyAnswerMap } from "../src/events";
import type { ModelOutput } from "../src/providers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");
const TARGET = join(APP, "src", "todo.ts");
const GATE_SCRIPT = join(ROOT, "fixtures", "gate", "gate-flow.jsonl");
const GATE_LOG = join(tmpdir(), "m1b-gate-events.jsonl");
const DARK_LOG = join(tmpdir(), "m1b-dark-events.jsonl");

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.error(`  ❌ ${label}`);
  }
}

// 索引式剧本 provider（记录 next() 调用数，「不再调用模型」可断言）
function scriptedProvider(script: ModelOutput[]): { provider: { next(): Promise<ModelOutput | null> }; calls: () => number } {
  let i = 0;
  let calls = 0;
  return {
    provider: {
      async next() {
        calls++;
        const v = script[i];
        i++;
        return v ?? null;
      },
    },
    calls: () => calls,
  };
}

async function runMini(script: ModelOutput[], ws: string, hooks: { clarify?: ClarifyGate; plan?: PlanGate; verify?: Parameters<typeof runLoop>[0]["verify"] } = {}): Promise<AgentEvent[]> {
  const logPath = join(ws, `mini-${String(Date.now())}-${String(Math.random()).slice(2, 6)}.jsonl`);
  const { provider } = scriptedProvider(script);
  await runLoop({ provider, events: createEventLog(logPath), workspace: ws, mode: "auto", ...hooks });
  return await replay(logPath);
}

function toolResultFor(log: AgentEvent[], name: string): { ok: boolean; output: string } | null {
  const call = log.find((e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call" && e.name === name);
  if (!call) return null;
  const r = log.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === call.id);
  return r ? { ok: r.ok, output: r.output } : null;
}

async function targetTests(): Promise<{ failed: number; passed: number; ok: boolean; output: string }> {
  const res = await TOOLS.run_shell.run({ command: "pnpm test" }, { workspace: APP });
  // 摘要读不到时返回 -1/-1（e2e 同口径）：旧写法把它折成 0/0，于是「测试根本没跑」
  // 被读成「零个失败」——调用者 TERM 带 ANSI 时就是这样假绿/假红切换的。
  const sum = vitestSummary(res.output);
  return { failed: sum.failed, passed: sum.passed, ok: res.ok, output: res.output };
}

async function resetTarget(): Promise<void> {
  await cp(BUG, TARGET);
}

const CLARIFY_ANSWERS: ClarifyAnswerMap = {
  "开关加在哪里？": "addTodo 增加默认完成参数",
  "开关的默认行为？": "默认未完成（done=false）",
};

/** 事件驱动器：clarify_requested → 提交表单；plan_proposed → 批准并落 plan_approved（等价 UI 卡片动作）。 */
function makeDriver(base: ReturnType<typeof createEventLog>, clarifyGate: ClarifyGate, planGate: PlanGate) {
  return {
    append: async (e: AgentEvent) => {
      await base.append(e);
      if (e.type === "clarify_requested") {
        queueMicrotask(() => {
          clarifyGate.submit(e.callId, CLARIFY_ANSWERS);
        });
      }
      if (e.type === "plan_proposed") {
        queueMicrotask(() => {
          planGate.approve(e.callId);
          void base.append({ type: "plan_approved", callId: e.callId, approved: true });
        });
      }
    },
  };
}

// ---- 前置：判卷文件冻结 ----
console.log("[gate-check] 前置校验：判卷文件 sha256 与冻结基线一致");
const frozenPre = await sha256MatchesFrozen(ROOT);
assert(frozenPre.ok, `判卷文件 sha256 = 冻结基线${frozenPre.broken ? `（被改动: ${frozenPre.broken}）` : ""}`);
// 演示区（fixtures/demo/**，独立冻结表）并入同一条前置：m2-acceptance 那条「演示区校验 ok」
// 此前唯一的实现者是一个零调用者的函数——账面写了、没人跑，等于把一个判卷区放在无人看的地方。
const demoPre = await sha256MatchesDemoFrozen(ROOT);
assert(demoPre.ok, `演示区剧本 sha256 = 冻结基线${demoPre.broken ? `（被改动: ${demoPre.broken}）` : ""}`);
if (!frozenPre.ok || !demoPre.ok) {
  // 判卷文件被动过 ⇒ 后面每一条绿与红都只量出"改动本身"，不量产品（在改过的考卷上打分没有意义）。
  // 更要紧的是**别让它跛着走下去**：原先继续跑会在下游取到 undefined 而抛裸 TypeError，
  // 汇总行与未证记账一起被吞（与 panels-check 那条信息黑洞同族）。
  console.error("[gate-check] 前置未过 ⇒ 后续判据一律不跑（判卷文件与冻结基线不一致：" + (frozenPre.broken ?? demoPre.broken ?? "?") + "）");
  process.exit(1);
}

// ---- 任务 2：写禁三断言（临时工作区，不碰靶子）----
console.log("[gate-check] 任务 2 写禁三断言（临时工作区）");
{
  const ws = await mkdtemp(join(tmpdir(), "m1b-gate-"));
  const WRITE: ModelOutput = { type: "tool_call", id: "w1", name: "write_file", args: { path: "g.txt", content: "hello" } };

  // ① 未批准时写工具返回拒绝
  resetPlanState();
  markPlanProposed();
  const denyLog = await runMini([WRITE], ws);
  const denied = toolResultFor(denyLog, "write_file");
  assert(denied !== null && !denied.ok && denied.output.includes("[permission denied]"), "①未批准时 write_file 返回拒绝（权限层）");
  assert(denied !== null && denied.output.includes("方案门"), "①拒绝原因指明方案门（存在未批准 plan）");
  const written1 = await readFile(join(ws, "g.txt"), "utf8").catch(() => null);
  assert(written1 === null, "①未批准时文件确实没有写入");

  // ② 批准后同一调用放行
  approvePlan();
  const allowLog = await runMini([WRITE], ws);
  const allowed = toolResultFor(allowLog, "write_file");
  assert(allowed !== null && allowed.ok, "②批准后同一 write_file 调用放行");
  const written2 = await readFile(join(ws, "g.txt"), "utf8").catch(() => null);
  assert(written2 === "hello", "②批准后文件真实写入");
  await rm(join(ws, "g.txt"), { force: true });

  // ③ 只读工具在任何阶段都不被拦
  resetPlanState();
  markPlanProposed();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(ws, "note.txt"), "只读", "utf8");
  const readLog = await runMini([{ type: "tool_call", id: "r1", name: "read_file", args: { path: "note.txt" } }], ws);
  const read = toolResultFor(readLog, "read_file");
  assert(read !== null && read.ok, "③只读工具（read_file）在未批准阶段照常执行");
  approvePlan();
  const readLog2 = await runMini([{ type: "tool_call", id: "r2", name: "read_file", args: { path: "note.txt" } }], ws);
  const read2 = toolResultFor(readLog2, "read_file");
  assert(read2 !== null && read2.ok, "③只读工具在批准后照常执行");
  await rm(ws, { recursive: true, force: true });
}

// ---- 任务 5：全链明卷（冻结剧本 + 三门 + verify 通过）----
console.log("[gate-check] 任务 5 全链明卷（fixtures/gate/gate-flow.jsonl）");
resetPlanState();
await resetTarget();
const baseline = await targetTests();
console.log(`[gate-check] 靶子开工基线: ${String(baseline.failed)} failed | ${String(baseline.passed)} passed`);
assert(baseline.failed === 1 && !baseline.ok, "靶子开工状态 = 1 failed（含歧义任务的真实改进空间）");

{
  const clarifyGate = new ClarifyGate();
  const planGate = new PlanGate();
  await rm(GATE_LOG, { force: true });
  const events = makeDriver(createEventLog(GATE_LOG), clarifyGate, planGate);
  await runLoop({
    provider: createMockProvider(GATE_SCRIPT),
    events,
    workspace: APP,
    mode: "auto",
    clarify: clarifyGate,
    plan: planGate,
    verify: createVerifyHook(APP, { trustedRepo: true }),
    userMessage: "给待办应用加个开关",
  });

  const log = await replay(GATE_LOG);
  const idx = (pred: (e: AgentEvent) => boolean): number => log.findIndex(pred);
  const iClarify = idx((e) => e.type === "clarify_requested");
  const iPlan = idx((e) => e.type === "plan_proposed");
  const iApproved = idx((e) => e.type === "plan_approved" && e.approved);
  const iWrite = idx((e) => e.type === "tool_call" && e.name === "write_file");
  const iVerifyOk = idx((e) => e.type === "verify_result" && e.ok);
  assert(
    iClarify >= 0 && iPlan > iClarify && iWrite > iPlan && iVerifyOk > iWrite,
    "事件序列依次含 clarify_requested → plan_proposed → tool_call(write_file) → verify_result(ok)",
  );
  assert(iApproved > iPlan && iApproved < iWrite, "写发生在方案批准之后（先批后写）");
  const write = toolResultFor(log, "write_file");
  assert(write !== null && write.ok, "批准后 write_file 真实执行（写禁解锁）");
  const verifyOk = iVerifyOk >= 0 ? log[iVerifyOk] : undefined;
  assert(verifyOk !== undefined && verifyOk.type === "verify_result" && verifyOk.attempt === 1, "verify 第 1 次即通过");
  const clarified = log.find((e): e is Extract<AgentEvent, { type: "clarify_requested" }> => e.type === "clarify_requested");
  assert(clarified !== undefined && clarified.questions.length >= 1, "clarify_requested 携带问题清单");
  const answerResult = log.find(
    (e): e is Extract<AgentEvent, { type: "tool_result" }> =>
      e.type === "tool_result" && clarified !== undefined && e.callId === clarified.callId && log.some((c) => c.type === "tool_call" && c.id === e.callId && c.name === "clarify"),
  );
  assert(
    answerResult !== undefined && answerResult.output === JSON.stringify(CLARIFY_ANSWERS),
    "clarify 表单提交值逐字挂回原 tool_use id",
  );
  const after = await targetTests();
  console.log(`[gate-check] 靶子修复后: ${String(after.failed)} failed | ${String(after.passed)} passed`);
  assert(after.failed === 0 && after.passed >= 3 && after.ok, "靶子 1 失败 → 0 失败（verify 真实跑通测试）");
}

// ---- 任务 6：暗卷（有 key 才跑）----
if (!process.env.CAIRN_API_KEY) {
  console.log("[gate-check] 暗卷跳过（无 CAIRN_API_KEY）");
  console.log("UNVERIFIED=1"); // H2（审查 P1-16）：跳过 ≠ 通过，上浮到门禁汇总
} else {
  console.log("[gate-check] 任务 6 暗卷：真实 GLM 跑同一任务");
  resetPlanState();
  await resetTarget();
  await rm(DARK_LOG, { force: true });
  const darkClarity = new ClarifyGate();
  const darkPlan = new PlanGate();
  const darkEvents = makeDriver(createEventLog(DARK_LOG), darkClarity, darkPlan);
  const SYSTEM = [
    "你是桌面编程 agent，workspace 根是 fixtures/todo-app（所有路径相对它）。",
    "纪律：1) 任务描述有歧义时必须先调用 clarify 工具提问（1–4 问）；",
    "2) 写任何文件前必须先调用 propose_plan 提交方案并等待批准（未批准时写操作会被权限层拒绝）；",
    "3) 只允许修改 src/ 下的文件，严禁改 tests/ 目录与任何判卷文件；",
    "4) 修改完成后调用 verify 工具跑测试；verify 通过后用一句话收尾（不再调用工具）。",
  ].join("\n");
  await runLoop({
    provider: createGlmSessionProvider(DARK_LOG, { system: SYSTEM, tools: gateToolSpecs() }),
    events: darkEvents,
    workspace: APP,
    mode: "auto",
    clarify: darkClarity,
    plan: darkPlan,
    verify: createVerifyHook(APP, { trustedRepo: true }),
    maxSteps: 60,
    userMessage: "给待办应用加个开关，并确保测试全绿",
  });
  const darkLog = await replay(DARK_LOG);
  const countCalls = (name: string): number => darkLog.filter((e) => e.type === "tool_call" && e.name === name).length;
  assert(countCalls("clarify") >= 1, `暗卷：真实模型至少调用一次 clarify（实际 ${String(countCalls("clarify"))} 次）`);
  assert(countCalls("propose_plan") >= 1, `暗卷：真实模型至少调用一次 propose_plan（实际 ${String(countCalls("propose_plan"))} 次）`);
  const darkFrozen = await sha256MatchesFrozen(ROOT);
  assert(darkFrozen.ok, "暗卷后判卷文件 sha256 仍与冻结基线一致");
  const darkTests = await targetTests();
  console.log(`[gate-check] 暗卷靶子终态: ${String(darkTests.failed)} failed | ${String(darkTests.passed)} passed`);
  void buildGlmHistory; // 导出面自检（构建期引用）
}

// ---- 收口：判卷文件未被改动 ----
const frozenPost = await sha256MatchesFrozen(ROOT);
assert(frozenPost.ok, "收口时判卷文件 sha256 仍与冻结基线逐字一致");
// H7（审查 P2）：冻结覆盖漂移——判卷区目录枚举与冻结表双向一致（新增判卷文件必须入表）。
// 第三维 = 表里出现、但没登记为判卷区的目录：那一维只查存在性，"新文件没入表"对它不生效 ⇒ 必须显式登记。
const driftH7 = await frozenCoverageDrift(ROOT);
const driftDetailH7 = JSON.stringify(driftH7).slice(0, 300);
assert(
  driftH7.onDiskNotInTable.length === 0 && driftH7.inTableNotOnDisk.length === 0 && driftH7.tableDirsNotSwept.length === 0,
  "H7 冻结表与判卷区目录双向一致（新增判卷文件不许逃出冻结面；新判卷目录须登记进 src/frozen.ts 的 areas）"
    + (driftDetailH7.length > 15 ? "：" + driftDetailH7 : ""),
);

if (failures > 0) {
  console.error(`[gate-check] 失败: ${String(failures)} 项断言未通过`);
  process.exitCode = 1;
} else {
  console.log("[gate-check] 全部断言通过");
}
