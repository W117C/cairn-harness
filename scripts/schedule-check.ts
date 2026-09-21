// M4a 明卷验收（第 21 道门）：pnpm schedule-check（仿 sidechat-check 体例）。
// 断言面（任务书 §2.7 全清单）：
//   A 校验矩阵：严格校验（未知字段拒绝 / 四 kind 表单白名单 / interval ≥5 / prompt 非空 ≤4k / IANA 规范化 / 枚举收窄）
//   B 双轨存储：automations.json 原子写（tmp+rename 无残留）+ journal.jsonl append-only + 坏行容忍
//   C occurrenceKey 去重：双触发免疫（重启误判 / run_now 冻结时钟双击）
//   D 三闸逐个：并发闸（cap=2，与 worker 并发 4 独立计数）/ 重叠闸 / 补跑 7 天边界（too-old）
//   E catchUp 两档：latest 取最近一次错过（decision=catchup）/ skip 不补跑（catch-up-skip）
//   F fail-closed 无人值守（真实代码路径 handleScheduleRunNow → handleAgentRun）：
//       只读档任务零审批等待跑完；写请求立即被拒且落流（tool_result 带 fail-closed 原因）；写不落盘
//   G 超时双闸（短阈值）：闸一 abort 收束 / 宿主不响应 → settlesWithin 二道退出 failed(timeout)
//   H agent 工具五件审批卡：红字标注「将无人值守执行」+ prompt 全文展示 + 批准落库 + 拒绝不动库
//       + worker FORBIDDEN 清单补齐 + 4k 注入防线（工具面拒绝超限 prompt）
//   I 六态历史与筛选：HISTORY_STATES 六态 + filterHistory + skipped 原因标签（休眠/重叠/并发满/过期）
//   J 三事件重放无损：automation_triggered/skipped/completed append→replay 逐字一致
//   K 旧日志零破坏：M4a 之前的会话日志重放逐字不变、不产生定时徽标投影
// 时钟/抖动/执行器全部注入；除毫秒级超时闸机制本身外零真实 sleep 等触发。
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { listSessions } from "../src/main/sessions";
// 中文标签唯一实现在渲染层投影（无 node 依赖，check 脚本可直接 import；panels-check 同例）
import { skipReasonLabel } from "../src/renderer/projections";
import {
  MAX_PROMPT_CHARS,
  makeUlid,
  validateAutomation,
  tierToMode,
  isUnattendedTier,
  type AutomationDefinition,
} from "../src/main/automations";
import {
  CATCHUP_WINDOW_MS,
  DEFAULT_CONCURRENCY_CAP,
  HISTORY_STATES,
  Scheduler,
  appendJournalEntry,
  loadAutomationsFile,
  occurrenceKeyOf,
  readJournalFile,
  saveAutomationsFile,
  summarizeRun,
  type SchedulerDeps,
  type TriggerExecutor,
} from "../src/main/scheduler";
import {
  MAX_CONCURRENT_WORKERS,
  WORKER_FORBIDDEN_TOOLS,
  WORKER_TOOL_TABLE,
  WRITE_WORKER_FORBIDDEN_TOOLS,
  WRITE_WORKER_TOOL_TABLE,
} from "../src/agent/orchestrator";
import { AskGate } from "../src/main/ask-gate";
import {
  getScheduler,
  handleScheduleRunNow,
  handleScheduleUpsert,
  initScheduler,
  initSessionsDir,
  initSettingsStore,
  runAgent,
  setSettings,
} from "../src/main/agent-runner";
import { TOOLS } from "../src/tools";

let pass = 0;
let fail = 0;
function ok(name: string): void {
  pass++;
  console.log("  ✅ " + name);
}
function bad(name: string, detail?: string): void {
  fail++;
  console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
}
function assert(cond: boolean, name: string, detail?: string): void {
  if (cond) ok(name);
  else bad(name, detail);
}

const work = await mkdtemp(join(tmpdir(), "m4a-schedule-check-"));

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "每日报表",
  prompt: "汇总今日变更并输出报告",
  schedule: { kind: "daily", time: "09:30" },
  timeZone: "Asia/Shanghai",
  permissionTier: "read-only",
  ...over,
});
const CREATED = "2026-09-11T00:00:00.000Z";

/** 可注入调度器工厂（毫秒级短阈值供超时闸测机制本身）。 */
function makeScheduler(over: Partial<SchedulerDeps> & { now?: number | (() => number) } = {}): { s: Scheduler; sessionsDir: string } {
  const nowVal = over.now;
  const clock: () => number =
    typeof nowVal === "function" ? nowVal : () => (typeof nowVal === "number" ? nowVal : 1_789_000_000_000);
  const deps: SchedulerDeps = {
    dataDir: join(work, "data-" + Math.random().toString(36).slice(2, 8)),
    sessionsDir: join(work, "sessions-" + Math.random().toString(36).slice(2, 8)),
    workspace: work,
    clock,
    jitterMs: () => 0,
    runTimeoutMs: 600,
    settlesWithinMs: 600,
    ...over,
  };
  delete (deps as { now?: unknown }).now;
  return { s: new Scheduler(deps), sessionsDir: deps.sessionsDir };
}
/** 闸测试执行器：挂起但 abort 即收束（真实取消语义）。 */
const hangOnSignal: TriggerExecutor = ({ signal }) =>
  new Promise<{ ok: boolean }>((resolve) => {
    if (signal.aborted) {
      resolve({ ok: true });
      return;
    }
    signal.addEventListener("abort", () => resolve({ ok: true }));
  });
const okExecutor: TriggerExecutor = async () => ({ ok: true });

/** mock 主剧本（M3A_MAIN_SCRIPT 通道）：JSONL of assistant_message/tool_call。 */
async function writeScript(name: string, entries: object[]): Promise<string> {
  const p = join(work, name);
  await writeFile(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return p;
}

/** 审批门测试替身：notify 内即时 decide（无等待、无悬空 timer），捕获请求供断言。 */
function scriptedGate(approve: boolean): { gate: AskGate; asks: { askId: string; tool: string; args: Record<string, unknown>; reason?: string }[] } {
  const asks: { askId: string; tool: string; args: Record<string, unknown>; reason?: string }[] = [];
  const gate = new AskGate({
    notify: (req) => {
      asks.push({ askId: req.askId, tool: req.tool as string, args: req.args, reason: req.reason });
      gate.decide(req.askId, approve, "user", "once");
    },
  });
  return { gate, asks };
}

try {
  // ---- A 校验矩阵 ----
  console.log("[schedule-check] A 校验矩阵（严格校验）");
  {
    const v = validateAutomation(base());
    assert(v.ok, "A1 合法定义通过（daily + 缺省档位/时区收窄）");
    assert(v.ok && v.value.permissionTier === "read-only" && v.value.catchUp === "latest" && v.value.enabled === true, "A2 缺省值收窄（read-only / latest / enabled）");
    assert(v.ok && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(v.value.id), "A3 id = ulid（26 位 Crockford）");
    const sneaky = validateAutomation(base({ sneaky: "inject" }));
    assert(!sneaky.ok && sneaky.errors.join().includes("sneaky 是未知字段"), "A4 顶层未知字段拒绝（注入面）");
    const cronSneak = validateAutomation(base({ schedule: { kind: "daily", time: "09:00", cron: "* * * * *" } }));
    assert(!cronSneak.ok && cronSneak.errors.join().includes("cron 是未知字段"), "A5 schedule 内未知字段拒绝");
    const formHo = validateAutomation(base({ schedule: { kind: "hourly", minute: 45 } }), { form: true });
    const dataHo = validateAutomation(base({ schedule: { kind: "hourly", minute: 45 } }));
    assert(!formHo.ok && dataHo.ok, "A6 hourly 数据模型收、表单面拒（V1 四 kind 白名单）");
    const small = validateAutomation(base({ schedule: { kind: "interval", everyMinutes: 4 } }));
    assert(!small.ok, "A7 interval < 5min 拒绝");
    const blank = validateAutomation(base({ prompt: "  " }));
    const over4k = validateAutomation(base({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }));
    assert(!blank.ok && !over4k.ok, "A8 prompt 非空且 ≤4k（持久化攻击面上限）");
    const badTz = validateAutomation(base({ timeZone: "Mars/Olympus" }));
    assert(!badTz.ok && badTz.errors.join().includes("IANA"), "A9 非法 IANA 时区拒绝");
    assert(tierToMode("read-only") === "read-only" && tierToMode("workspace-write") === "default" && tierToMode("danger-full-access") === "auto", "A10 档位 → 审批档映射（§11.7.2 对表）");
    assert(isUnattendedTier("read-only") === false && isUnattendedTier("workspace-write") === true, "A11 红字标注判定：workspace-write 及以上 = 无人值守档");
    const slash = validateAutomation(base({ name: "a/b" }));
    assert(!slash.ok, "A12 name 会话名安全约束（路径分隔符拒绝）");
  }

  // ---- B 双轨存储 ----
  console.log("[schedule-check] B 双轨存储（原子写 + append-only）");
  {
    const file = join(work, "automations.json");
    const v = validateAutomation(base({ id: makeUlid() }));
    if (!v.ok) throw new Error("fixture invalid");
    await saveAutomationsFile(file, [v.value]);
    const back = await loadAutomationsFile(file);
    assert(back.tasks.length === 1 && back.tasks[0]!.name === "每日报表", "B1 automations.json 原子写往返一致");
    assert(!(await readdir(work)).some((f) => f.endsWith(".tmp")), "B2 原子写无 .tmp 残留（tmp+rename）");
    const partial = join(work, "partial.json");
    await writeFile(partial, JSON.stringify({ version: 1, tasks: [v.value, { name: "坏条目" }] }), "utf8");
    const r2 = await loadAutomationsFile(partial);
    assert(r2.tasks.length === 1 && r2.warnings.join().includes("无效已跳过"), "B3 迁移容忍：坏条目跳过 + 警告（不静默丢清单）");
    const jfile = join(work, "automations-journal.jsonl");
    const t0 = new Date("2026-09-12T01:00:00.000Z");
    await appendJournalEntry(jfile, { task_id: "t1", occurrence_key: occurrenceKeyOf("t1", t0), due_at: t0.toISOString(), decision: "triggered", at: t0.toISOString() });
    const before = await readFile(jfile, "utf8");
    await appendJournalEntry(jfile, { task_id: "t1", occurrence_key: "k2", due_at: t0.toISOString(), decision: "skipped", reason: "overlap", at: t0.toISOString() });
    assert((await readFile(jfile, "utf8")).startsWith(before) && before.endsWith("\n"), "B4 journal append-only（旧字节逐字保留）");
    await writeFile(jfile, (await readFile(jfile, "utf8")) + "这不是JSON\n", "utf8");
    const j = await readJournalFile(jfile);
    assert(j.entries.length === 2 && j.warnings.join().includes("不是合法 JSON"), "B5 journal 坏行跳过 + 警告（不断链）");
  }

  // ---- C occurrenceKey 去重（双触发免疫）----
  console.log("[schedule-check] C occurrenceKey 去重（崩溃/重启双触发免疫）");
  {
    const { s, sessionsDir } = makeScheduler({ runSession: okExecutor, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    const up = await s.upsert(base({ name: "去重靶", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    if (!up.ok) throw new Error("upsert fail");
    const r1 = await s.tick({ startup: true });
    await s.whenIdle;
    assert(r1.catchup === 1, "C1 首次启动 tick：错过 occurrence 进管线（catchup=1）");
    const j1 = (await readJournalFile(s.journalPath)).entries.length;
    const r2 = await s.tick({ startup: true });
    assert(r2.duplicates === 0 && r2.catchup === 0 && (await readJournalFile(s.journalPath)).entries.length === j1, "C2 同状态重启重判：journal 零增长（水位推进不重试）");
    const id = s.list().find((t) => t.name === "去重靶")!.id;
    const rn1 = await s.runNow(id);
    assert(rn1.ok, "C3 run_now 首次触发成功（decision=triggered）");
    await s.whenIdle; // rn1 先收束（inflight 清空），排除重叠闸干扰，直击去重语义
    const jAfter = (await readJournalFile(s.journalPath)).entries.length;
    const sessBefore = (await listSessions(sessionsDir)).filter((x) => x.id.startsWith("去重靶")).length;
    const rn2 = await s.runNow(id);
    const sessAfter = (await listSessions(sessionsDir)).filter((x) => x.id.startsWith("去重靶")).length;
    assert(!rn2.ok && (rn2.error ?? "").includes("去重") && (await readJournalFile(s.journalPath)).entries.length === jAfter && sessAfter === sessBefore, "C4 冻结时钟 run_now 双击：同 occurrenceKey 第二次被去重拒绝、零新账、不重复建会话（双触发免疫）");
    await s.whenIdle;
    assert(s.inflightCount === 0, "C5 执行收束后 inflight 清零");
  }

  // ---- D 三闸逐个 ----
  console.log("[schedule-check] D 准入三闸（顺序短路）");
  {
    // D1 并发闸
    const { s } = makeScheduler({ runSession: hangOnSignal, getCap: () => 2, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    for (const n of ["甲", "乙", "丙"]) {
      const r = await s.upsert(base({ name: n, schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
      if (!r.ok) throw new Error("upsert fail");
    }
    const rep = await s.tick({ startup: true });
    assert(rep.catchup === 2 && rep.skipped["concurrency-cap"] === 1, "D1 并发闸：cap=2 三任务同到期 → 第三个 skipped(concurrency-cap)");
    assert(s.inflightCount === 2 && MAX_CONCURRENT_WORKERS === 4 && DEFAULT_CONCURRENCY_CAP === 2, "D1b 定时会话计数与 worker 并发上限 4 独立（两套额度互不共享）");
    // D2 重叠闸
    const { s: s2 } = makeScheduler({ runSession: hangOnSignal, getCap: () => 4, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s2.start();
    s2.stop();
    const up = await s2.upsert(base({ name: "跑得慢", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    if (!up.ok) throw new Error("upsert fail");
    await s2.tick({ startup: true });
    const rn = await s2.runNow(up.value.id);
    const j = await readJournalFile(s2.journalPath);
    assert(!rn.ok && (rn.error ?? "").includes("overlap") && j.entries.filter((e) => e.decision === "skipped" && e.reason === "overlap").length === 1, "D2 重叠闸：同任务运行中再触发 → skipped(overlap) 落账");
    // D3 补跑 7 天边界
    const { s: s3 } = makeScheduler({ runSession: hangOnSignal, now: new Date("2026-09-12T14:30:00Z").getTime() });
    await s3.start();
    s3.stop();
    await s3.upsert(base({ name: "补跑靶", schedule: { kind: "interval", everyMinutes: 60 }, createdAt: "2026-09-12T08:00:00.000Z" }));
    const rep3 = await s3.tick({ startup: true });
    const j3 = await readJournalFile(s3.journalPath);
    const cu = j3.entries.find((e) => e.decision === "catchup");
    assert(rep3.catchup === 1 && rep3.skipped["too-old"] === 5 && cu?.due_at === "2026-09-12T14:00:00.000Z", "D3 补跑闸：catchUp=latest 只取最近一次错过，更旧 5 次 skipped(too-old)");
    assert(CATCHUP_WINDOW_MS === 7 * 24 * 60 * 60 * 1000, "D3b 回看窗口 = 7 天（常量口径）");
  }

  // ---- E catchUp 两档 ----
  console.log("[schedule-check] E catchUp latest vs skip");
  {
    const { s } = makeScheduler({ runSession: okExecutor, now: new Date("2026-09-12T14:30:00Z").getTime() });
    await s.start();
    s.stop();
    await s.upsert(base({ name: "latest 档", schedule: { kind: "interval", everyMinutes: 60 }, createdAt: "2026-09-12T08:00:00.000Z" }));
    const rep = await s.tick({ startup: true });
    await s.whenIdle;
    const j = await readJournalFile(s.journalPath);
    assert(rep.catchup === 1 && j.entries.some((e) => e.decision === "catchup" && e.due_at === "2026-09-12T14:00:00.000Z"), "E1 latest 档：最近一次错过 decision=catchup 进管线");
    const { s: s2 } = makeScheduler({ runSession: okExecutor, now: new Date("2026-09-12T14:30:00Z").getTime() });
    await s2.start();
    s2.stop();
    await s2.upsert(base({ name: "skip 档", schedule: { kind: "interval", everyMinutes: 60 }, catchUp: "skip", createdAt: "2026-09-12T08:00:00.000Z" }));
    const rep2 = await s2.tick({ startup: true });
    const j2 = await readJournalFile(s2.journalPath);
    assert(rep2.catchup === 0 && rep2.triggered === 0 && rep2.skipped["catch-up-skip"] === 1 && j2.entries.every((e) => e.decision === "skipped"), "E2 skip 档：不补跑，直接对齐下次触发（catch-up-skip）");
    const { s: s3 } = makeScheduler({ runSession: hangOnSignal, now: new Date("2026-09-20T09:00:00Z").getTime() });
    await s3.start();
    s3.stop();
    await s3.upsert(base({ name: "八天前", schedule: { kind: "daily", time: "09:00" }, timeZone: "UTC", createdAt: "2026-09-04T09:00:00.000Z" }));
    const rep3 = await s3.tick({ startup: true });
    const j3 = await readJournalFile(s3.journalPath);
    const dues = j3.entries.map((e) => e.due_at).sort();
    assert(rep3.catchup === 1 && rep3.skipped["too-old"] === 6 && dues[0] === "2026-09-14T09:00:00.000Z", "E3 7 天窗外更早错过不枚举不落账（边界=窗口起点严格之后）");
  }

  // ---- F fail-closed 无人值守（真实代码路径）----
  console.log("[schedule-check] F fail-closed 无人值守（handleScheduleRunNow → handleAgentRun 真实路径）");
  const sessionsDir = join(work, "sessions-real");
  const settingsPath = join(work, "settings.json");
  const dataDir = join(work, "data-real");
  initSettingsStore(settingsPath);
  initSessionsDir(sessionsDir);
  await setSettings({ autoMemory: false }); // 坑五十二：关会话尾沉淀，判据不被 distill 拍污染
  initScheduler({ dataDir, sessionsDir, workspace: work, jitterMs: () => 0 });
  {
    // F1 只读档任务：零审批等待跑完
    const scriptA = await writeScript("script-a.jsonl", [
      { type: "tool_call", id: "r1", name: "read_file", args: { path: "note.txt" } },
      { type: "assistant_message", content: "只读巡检完成：note.txt 内容正常，无异常。" },
    ]);
    process.env.M3A_MAIN_SCRIPT = scriptA;
    await writeFile(join(work, "note.txt"), "hello m4a", "utf8");
    const upA = await handleScheduleUpsert(base({ name: "只读巡检", permissionTier: "read-only" }), true);
    assert(upA.ok, "F0 只读任务创建成功（表单面 upsert）");
    const idA = getScheduler()!.list().find((t) => t.name === "只读巡检")!.id;
    const rnA = await handleScheduleRunNow(idA);
    assert(rnA.ok, "F1 run_now 准入通过");
    await getScheduler()!.whenIdle;
    const infosA = await listSessions(sessionsDir);
    const schedA = infosA.find((x) => x.origin === "scheduled" && x.automationName === "只读巡检");
    assert(schedA !== undefined && schedA.id.startsWith("只读巡检 · "), "F1b 定时会话落盘：origin=scheduled + 标题=任务名 · 触发时刻");
    const evA = await replay(join(sessionsDir, schedA!.id + ".jsonl"));
    const metaA = evA[0];
    assert(metaA?.type === "session_meta" && metaA.origin === "scheduled" && metaA.automation_id === idA, "F1c 首行 session_meta.origin=scheduled + automation_id（§12.2.2）");
    const userA = evA.find((e): e is Extract<AgentEvent, { type: "user_message" }> => e.type === "user_message");
    assert(userA !== undefined && userA.content.includes("汇总今日变更并输出报告") && userA.content.includes(work) && userA.content.includes("无人值守"), "F1d 首条消息 = prompt + 工作区路径 + 无人值守声明（自包含，不继承对话）");
    const completedA = evA.find((e): e is Extract<AgentEvent, { type: "automation_completed" }> => e.type === "automation_completed");
    assert(completedA?.status === "succeeded" && completedA.summary.includes("只读巡检完成"), "F1e 只读任务跑完：automation_completed=succeeded + summarizeRun 摘要取最后 assistant");
    assert(evA.some((e) => e.type === "tool_result" && e.ok === true), "F1f 读工具真实执行（tool_result ok）");

    // F2 写档位任务：写请求立即被拒且落流，写不落盘
    const scriptB = await writeScript("script-b.jsonl", [
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "out.txt", content: "should not exist" } },
      { type: "assistant_message", content: "写请求被拒，任务收束。" },
    ]);
    process.env.M3A_MAIN_SCRIPT = scriptB;
    const upB = await handleScheduleUpsert(base({ name: "越权写入", permissionTier: "workspace-write" }), true);
    assert(upB.ok, "F2 写档位任务创建成功（表单面允许创建，触发时 fail-closed）");
    const idB = getScheduler()!.list().find((t) => t.name === "越权写入")!.id;
    const t0 = Date.now();
    const rnB = await handleScheduleRunNow(idB);
    await getScheduler()!.whenIdle;
    const elapsedB = Date.now() - t0;
    assert(rnB.ok, "F2b run_now 准入通过");
    const infosB = (await listSessions(sessionsDir)).filter((x) => x.automationName === "越权写入");
    const evB = await replay(join(sessionsDir, infosB[0]!.id + ".jsonl"));
    const denied = evB.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === "w1");
    assert(denied !== undefined && !denied.ok && denied.output.includes("无人值守 fail-closed：审批请求自动拒绝"), "F2c 写请求被立即拒且落流（tool_result 带 fail-closed 原因）");
    assert(elapsedB < 5_000, "F2d 零审批等待（立即拒绝，不进 60s 超时；耗时 " + String(elapsedB) + "ms）");
    let writeLanded = false;
    try {
      await stat(join(work, "out.txt"));
      writeLanded = true;
    } catch {
      writeLanded = false;
    }
    assert(!writeLanded, "F2e 被拒写请求未落盘（fail-closed 不产生副作用）");
    const completedB = evB.find((e): e is Extract<AgentEvent, { type: "automation_completed" }> => e.type === "automation_completed");
    assert(completedB !== undefined && completedB.tool_stats["write_file"] === 1, "F2f 终态回写带 tool_stats（§12.2.4 summarizeRun 投影）");
  }

  // ---- G 超时双闸（短阈值）----
  console.log("[schedule-check] G 超时双闸（runTimeoutMs + settlesWithin）");
  {
    const hangForever: TriggerExecutor = async () => new Promise<{ ok: boolean }>(() => {});
    const { s } = makeScheduler({ runSession: hangForever, runTimeoutMs: 50, settlesWithinMs: 60, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    const up = await s.upsert(base({ name: "卡死靶", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    if (!up.ok) throw new Error("upsert fail");
    await s.tick({ startup: true });
    const t0 = Date.now();
    await s.whenIdle;
    const elapsed = Date.now() - t0;
    const snap = await s.snapshot();
    const failed = snap.history.find((h) => h.state === "failed");
    assert(elapsed < 2_000, "G1 宿主不响应 abort → settlesWithin 二道退出（" + String(elapsed) + "ms，不等 30min）");
    assert(failed?.reason === "timeout" && s.inflightCount === 0, "G2 二道退出终态 failed(timeout)，inflight 清零不悬挂");
    let abortObserved = false;
    const abortAware: TriggerExecutor = ({ signal }) =>
      new Promise<{ ok: boolean }>((resolve) => {
        signal.addEventListener("abort", () => {
          abortObserved = true;
          resolve({ ok: true });
        });
      });
    const { s: s2 } = makeScheduler({ runSession: abortAware, runTimeoutMs: 40, settlesWithinMs: 5_000, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s2.start();
    s2.stop();
    await s2.upsert(base({ name: "abort 靶", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    await s2.tick({ startup: true });
    await s2.whenIdle;
    assert(abortObserved, "G3 闸一真实路径：runTimeoutMs 到点 abort 信号送达执行器");
    const snap2 = await s2.snapshot();
    assert(snap2.history.find((h) => h.state === "failed")?.reason === "timeout", "G4 abort 收束路径终态亦为 failed(timeout)（timedOut 以 abort 标记）");
  }

  // ---- H agent 工具五件审批卡 ----
  console.log("[schedule-check] H agent 工具五件（审批卡 + 红字 + FORBIDDEN + 4k 防线）");
  {
    // H1 创建走审批卡 + 红字标注 + prompt 全文展示
    const fullPrompt = "自动备份工作区变更并生成变更清单（审批卡全文展示用全文）";
    const scriptC = await writeScript("script-c.jsonl", [
      {
        type: "tool_call", id: "c1", name: "automation_create",
        args: { name: "自动备份", prompt: fullPrompt, schedule: { kind: "weekly", weekdays: [1, 3, 5], time: "08:00" }, timeZone: "Asia/Shanghai", permissionTier: "workspace-write" },
      },
      { type: "tool_call", id: "c2", name: "automation_list", args: {} },
      { type: "assistant_message", content: "已创建自动备份任务。" },
    ]);
    process.env.M3A_MAIN_SCRIPT = scriptC;
    const approveGate = scriptedGate(true);
    const logC = join(work, "h-run.jsonl");
    await runAgent({ workspace: work, message: "帮我建一个自动备份定时任务", mode: "default", logPath: logC, askGate: approveGate.gate });
    const evC = await replay(logC);
    assert(approveGate.asks.length >= 1 && approveGate.asks[0]!.tool === "automation_create", "H1 automation_create 走审批卡（AskGate notify 在场）");
    assert(approveGate.asks[0]!.reason !== undefined && approveGate.asks[0]!.reason!.includes("将无人值守执行"), "H2 workspace-write 档位审批卡红字标注「将无人值守执行」");
    assert(approveGate.asks[0]!.args.prompt === fullPrompt, "H3 审批卡全文展示：prompt 原文进审批卡（不截断）");
    const created = evC.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === "c1");
    assert(created !== undefined && created.ok && created.output.includes("自动备份"), "H4 批准后落库（tool_result ok + 返回任务名）");
    const saved = getScheduler()!.list().find((t) => t.name === "自动备份");
    assert(saved !== undefined && saved.permissionTier === "workspace-write" && saved.schedule.kind === "weekly", "H5 任务定义真实入库（tier/weekly 保持）");
    const listed = evC.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === "c2");
    assert(listed !== undefined && listed.ok && listed.output.includes("自动备份"), "H6 automation_list 返回任务清单");
    // H7 拒绝路径：automation_delete 被拒 → 任务仍在
    const scriptD = await writeScript("script-d.jsonl", [
      { type: "tool_call", id: "d1", name: "automation_delete", args: { id: saved!.id } },
      { type: "assistant_message", content: "删除被用户拒绝。" },
    ]);
    process.env.M3A_MAIN_SCRIPT = scriptD;
    const rejectGate = scriptedGate(false);
    const logD = join(work, "h-run2.jsonl");
    await runAgent({ workspace: work, message: "删掉那个任务", mode: "default", logPath: logD, askGate: rejectGate.gate });
    const evD = await replay(logD);
    const delDenied = evD.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === "d1");
    assert(delDenied !== undefined && !delDenied.ok && delDenied.output.includes("[permission denied] automation_delete"), "H7 审批卡拒绝 → automation_delete 不执行");
    assert(getScheduler()!.list().some((t) => t.id === saved!.id), "H8 拒绝后任务仍在（拒绝不动库）");
    // H9 FORBIDDEN 清单补齐（worker 工具面不可达）
    const forbiddenRead = ["automation_create", "automation_update", "automation_delete", "automation_run_now", "automation_list"].every((t) => WORKER_FORBIDDEN_TOOLS.includes(t));
    const forbiddenWrite = ["automation_create", "automation_update", "automation_delete", "automation_run_now", "automation_list"].every((t) => WRITE_WORKER_FORBIDDEN_TOOLS.includes(t));
    assert(forbiddenRead && forbiddenWrite, "H9 worker 两张 FORBIDDEN 清单补齐 automation_*（定时任务里不再嵌套定时）");
    assert(!WORKER_TOOL_TABLE.includes("automation_list" as never) && !WRITE_WORKER_TOOL_TABLE.includes("automation_run_now" as never), "H9b worker 工具表本体不含 automation_*");
    // H10 4k 注入防线（工具面拒绝超限 prompt）
    const toolTable = TOOLS as unknown as Record<string, import("../src/tools/base").Tool>;
    const tooBig = await toolTable.automation_create!.run({ name: "超大", prompt: "x".repeat(MAX_PROMPT_CHARS + 1), schedule: { kind: "daily", time: "09:00" } }, { workspace: work, callId: "h10" });
    assert(!tooBig.ok && tooBig.output.includes("4000"), "H10 automation_create 工具面拒绝 >4k prompt（注入防线）");
  }

  // ---- I 六态历史与筛选 ----
  console.log("[schedule-check] I 六态历史（筛选 + skipped 原因标签）");
  {
    assert(HISTORY_STATES.length === 6 && HISTORY_STATES.join(",") === "queued,running,succeeded,failed,skipped,cancelled", "I1 运行历史六态（queued/running/succeeded/failed/skipped/cancelled）");
    const h = [
      { task_id: "t", task_name: "n", occurrence_key: "k1", due_at: "", decision: "triggered", state: "succeeded", at: "2026-09-12T00:00:00Z" },
      { task_id: "t", task_name: "n", occurrence_key: "k2", due_at: "", decision: "skipped", reason: "overlap", state: "skipped", at: "2026-09-12T00:01:00Z" },
      { task_id: "t", task_name: "n", occurrence_key: "k3", due_at: "", decision: "triggered", state: "failed", at: "2026-09-12T00:02:00Z" },
    ] as Parameters<typeof Scheduler.filterHistory>[0];
    assert(Scheduler.filterHistory(h, "all").length === 3 && Scheduler.filterHistory(h, "skipped").length === 1 && Scheduler.filterHistory(h, "succeeded")[0]!.occurrence_key === "k1", "I2 filterHistory 六态筛选（all/单态）");
    // 中文标签的唯一实现现在在渲染层（main 只落 token，措辞属表现层）；
    // 断言强度不变：四个原因各出一条标签、各自含那个词，且未知原因原样透出（不静默变空串）。
    assert(skipReasonLabel("too-old").includes("过期") && skipReasonLabel("catch-up-skip").includes("休眠")
      && skipReasonLabel("overlap").includes("重叠") && skipReasonLabel("concurrency-cap").includes("并发满")
      && skipReasonLabel("interrupted（重启后无终态记录）").includes("中断") && skipReasonLabel("whatever") === "whatever",
      "I3 skipped 四原因中文标签（过期/休眠/重叠/并发满，唯一实现在渲染层投影）");
    const sum = summarizeRun([
      { type: "usage", inputTokens: 3, outputTokens: 4 },
      { type: "assistant_message", content: "最终报告" },
    ] as AgentEvent[]);
    assert(sum.summary === "最终报告" && sum.usage.inputTokens === 3, "I4 summarizeRun 纯投影（最后 assistant + usage，零新 LLM 调用）");
  }

  // ---- J 三事件重放无损 ----
  console.log("[schedule-check] J 三事件重放无损");
  {
    const p = join(work, "ev.jsonl");
    const l = createEventLog(p);
    const evs: AgentEvent[] = [
      { type: "session_meta", origin: "scheduled", automation_id: "a1", automation_name: "任务甲" },
      { type: "automation_triggered", automation_id: "a1", task_name: "任务甲", occurrence_key: "a1:2026-09-12T01:00:00.000Z", due_at: "2026-09-12T01:00:00.000Z", session_id: "s1", catchup: true },
      { type: "automation_skipped", automation_id: "a1", task_name: "任务甲", occurrence_key: "a1:2026-09-12T02:00:00.000Z", due_at: "2026-09-12T02:00:00.000Z", reason: "overlap" },
      { type: "automation_completed", automation_id: "a1", task_name: "任务甲", occurrence_key: "a1:2026-09-12T01:00:00.000Z", session_id: "s1", status: "succeeded", summary: "完成", usage: { inputTokens: 1, outputTokens: 2 }, tool_stats: { read_file: 1 } },
    ];
    for (const e of evs) await l.append(e);
    const raw = await readFile(p, "utf8");
    const back = await replay(p);
    assert(JSON.stringify(back) === JSON.stringify(evs), "J1 三事件 append→replay 逐字无损（结构全字段保真）");
    assert(raw.trimEnd().endsWith(JSON.stringify(evs[3])), "J2 JSONL 行字节 = 事件原样序列化");
  }

  // ---- K 旧日志零破坏 ----
  console.log("[schedule-check] K 旧日志零破坏（M4a 之前日志重放逐字不变）");
  {
    const p = join(work, "old.jsonl");
    const l = createEventLog(p);
    await l.append({ type: "session_meta" });
    await l.append({ type: "user_message", content: "旧会话消息" });
    await l.append({ type: "assistant_message", content: "旧回答" });
    await l.append({ type: "usage", inputTokens: 5, outputTokens: 6 });
    const raw1 = await readFile(p, "utf8");
    const r1 = await replay(p);
    const r2 = await replay(p);
    assert(JSON.stringify(r1) === JSON.stringify(r2), "K1 旧日志重放幂等（两次重放逐字一致）");
    assert(!raw1.includes("automation_"), "K2 旧日志不含 automation_* 事件（新类型零写入）");
    // 旧会话文件直接落会话目录 → 会话列表不产生定时徽标投影（origin/automation* 缺省）
    const badgeProbe = join(work, "sessions-badge-probe");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(badgeProbe, { recursive: true });
    await createEventLog(join(badgeProbe, "旧会话.jsonl")).append({ type: "user_message", content: "旧会话" });
    const infos = await listSessions(badgeProbe);
    assert(infos.length === 1 && infos[0]!.origin === undefined && infos[0]!.automationId === undefined, "K3 旧会话不产生定时徽标投影（origin/automationId 缺省）");
  }
} finally {
  delete process.env.M3A_MAIN_SCRIPT;
  try {
    const s = getScheduler();
    if (s) s.stop();
  } catch {
    /* 未初始化 */
  }
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

console.log("[schedule-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）");
process.exit(fail === 0 ? 0 : 1);
