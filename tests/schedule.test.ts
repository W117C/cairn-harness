// M4a 定时任务单测：任务模型校验矩阵 / 双轨存储 / next-run 计算 / 准入三闸 / catchUp 补跑 /
// occurrenceKey 去重 / unattended 语义前置（tier 映射）/ summarizeRun 投影。
// 时钟/抖动/执行器全部注入，禁真实 sleep 等触发（超时双闸用毫秒级真实定时器测机制本身）。
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import {
  MAX_PROMPT_CHARS,
  makeUlid,
  isValidUlid,
  normalizeTimeZone,
  tierToMode,
  isUnattendedTier,
  validateAutomation,
  systemTimeZone,
  type AutomationDefinition,
} from "../src/main/automations";
import {
  DEFAULT_CONCURRENCY_CAP,
  Scheduler,
  appendJournalEntry,
  compactJournalIfLarge,
  formatLocal,
  loadAutomationsFile,
  nextOccurrence,
  normalizeHistoryFilter,
  occurrenceKeyOf,
  occurrencesBetween,
  readJournalFile,
  saveAutomationsFile,
  summarizeRun,
  type SchedulerDeps,
  type TriggerExecutor,
} from "../src/main/scheduler";
import { MAX_CONCURRENT_WORKERS } from "../src/agent/orchestrator";
import { listSessions } from "../src/main/sessions";
import * as sessionStore from "../src/main/sessions";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4a-schedule-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "每日报表",
  prompt: "汇总今日变更并输出报告",
  schedule: { kind: "daily", time: "09:30" },
  timeZone: "Asia/Shanghai",
  permissionTier: "read-only",
  ...over,
});

describe("M4a 任务模型（automations.ts）", () => {
  it("ulid：格式合法 / 唯一 / 时间有序", () => {
    const a = makeUlid(1_700_000_000_000);
    const b = makeUlid(1_700_000_000_001);
    expect(isValidUlid(a)).toBe(true);
    expect(isValidUlid("olz" + a.slice(3))).toBe(false); // 含 I/L/O 的串不合法
    expect(a).not.toBe(b);
    expect(a < b).toBe(true); // 时间位在前，字典序 = 时间序
    expect(makeUlid(1_700_000_000_000)).not.toBe(makeUlid(1_700_000_000_000)); // 同毫秒随机位不同
  });

  it("ulid 随机位不依赖 Math.random（密码学安全，不可预测）", () => {
    // 回归：曾用 Math.random() 生成 80bit 随机位（扫描器真阳性 danger.weak_random）——
    // ULID 规范要求密码学安全随机。若回退 Math.random，本测试在常量 stub 下必红。
    const orig = Math.random;
    Math.random = () => 0.42;
    try {
      const a = makeUlid(1_700_000_000_000);
      const b = makeUlid(1_700_000_000_000);
      expect(isValidUlid(a)).toBe(true);
      expect(a).not.toBe(b); // 常量 Math.random 下仍须不同 ⇒ 走的是 crypto 路径
    } finally {
      Math.random = orig;
    }
  });


  it("表单四 kind 全过；hourly/monthly/custom 数据模型收、表单面拒", () => {
    expect(validateAutomation(base()).ok).toBe(true);
    expect(validateAutomation(base({ schedule: { kind: "once", at: "2026-09-20T09:30:00+08:00" } }), { form: true }).ok).toBe(true);
    expect(validateAutomation(base({ schedule: { kind: "interval", everyMinutes: 30 } }), { form: true }).ok).toBe(true);
    expect(validateAutomation(base({ schedule: { kind: "weekly", weekdays: [1, 5], time: "08:00" } }), { form: true }).ok).toBe(true);
    // 数据模型七 kind 全收
    expect(validateAutomation(base({ schedule: { kind: "hourly", minute: 45 } })).ok).toBe(true);
    expect(validateAutomation(base({ schedule: { kind: "monthly", monthDay: "last", time: "23:00" } })).ok).toBe(true);
    expect(validateAutomation(base({ schedule: { kind: "custom", everyDays: 14, time: "10:00" } })).ok).toBe(true);
    // 表单面拒绝 hourly
    const r = validateAutomation(base({ schedule: { kind: "hourly", minute: 45 } }), { form: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("表单四 kind");
  });

  it("未知字段拒绝（顶层 + schedule 内）；interval ≥5；prompt 非空 ≤4k", () => {
    const badTop = validateAutomation(base({ sneaky: "inject" }));
    expect(badTop.ok).toBe(false);
    if (!badTop.ok) expect(badTop.errors.join()).toContain("sneaky 是未知字段");
    const badSched = validateAutomation(base({ schedule: { kind: "daily", time: "09:00", cron: "* * * * *" } }));
    expect(badSched.ok).toBe(false);
    if (!badSched.ok) expect(badSched.errors.join()).toContain("cron 是未知字段");
    const small = validateAutomation(base({ schedule: { kind: "interval", everyMinutes: 4 } }));
    expect(small.ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "interval", everyMinutes: 5 } })).ok).toBe(true);
    expect(validateAutomation(base({ prompt: "  " })).ok).toBe(false);
    expect(validateAutomation(base({ prompt: "x".repeat(MAX_PROMPT_CHARS) })).ok).toBe(true);
    const tooLong = validateAutomation(base({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors.join()).toContain("4000");
  });

  it("IANA 时区规范化（非法拒绝）；name 会话名安全；默认值收窄", () => {
    const ok = validateAutomation(base({ timeZone: "Asia/Shanghai" }));
    expect(ok.ok && ok.value.timeZone).toBe("Asia/Shanghai");
    expect(ok.ok && ok.value.permissionTier).toBe("read-only");
    expect(ok.ok && ok.value.catchUp).toBe("latest");
    expect(ok.ok && ok.value.enabled).toBe(true);
    const bad = validateAutomation(base({ timeZone: "Mars/Olympus" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join()).toContain("IANA");
    expect(normalizeTimeZone("UTC")).toBe("UTC");
    expect(systemTimeZone().length).toBeGreaterThan(0);
    const longName = validateAutomation(base({ name: "x".repeat(41) }));
    expect(longName.ok).toBe(false);
    const slash = validateAutomation(base({ name: "a/b" }));
    expect(slash.ok).toBe(false);
    expect(validateAutomation(base({ permissionTier: "sudo" })).ok).toBe(false);
    expect(validateAutomation(base({ catchUp: "always" })).ok).toBe(false);
    expect(validateAutomation(base({ enabled: "yes" })).ok).toBe(false);
  });

  it("weekly/monthly/custom 字段范围与档位映射", () => {
    expect(validateAutomation(base({ schedule: { kind: "weekly", weekdays: [], time: "08:00" } })).ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "weekly", weekdays: [7], time: "08:00" } })).ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "monthly", monthDay: 0, time: "08:00" } })).ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "monthly", monthDay: 32, time: "08:00" } })).ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "custom", everyDays: 0, time: "08:00" } })).ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "custom", everyDays: 366, time: "08:00" } })).ok).toBe(false);
    expect(validateAutomation(base({ schedule: { kind: "once", at: "不是时间" } })).ok).toBe(false);
    expect(tierToMode("read-only")).toBe("read-only");
    expect(tierToMode("workspace-write")).toBe("default");
    expect(tierToMode("danger-full-access")).toBe("auto");
    expect(isUnattendedTier("read-only")).toBe(false);
    expect(isUnattendedTier("workspace-write")).toBe(true);
    expect(isUnattendedTier("danger-full-access")).toBe(true);
  });
});

describe("M4a 双轨存储", () => {
  it("automations.json 原子写往返 + 无 .tmp 残留", async () => {
    const file = join(dir, "automations.json");
    const v = validateAutomation(base({ id: makeUlid() }));
    if (!v.ok) throw new Error("fixture invalid");
    await saveAutomationsFile(file, [v.value]);
    const back = await loadAutomationsFile(file);
    expect(back.tasks).toHaveLength(1);
    expect(back.tasks[0]!.name).toBe("每日报表");
    const files = await readdir(dir);
    // 判「任何形态的临时文件残留」而不是只判旧命名（endsWith(".tmp")）：临时名一旦换形状，
    // 旧判据会静默变成恒真——原子写的失败分支正是靠「别把 tmp 留在盘上」露馅的。
    expect(files.filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("加载迁移容忍：坏 JSON / 坏条目跳过 + 警告", async () => {
    const bad = join(dir, "bad.json");
    await writeFile(bad, "{ 不是 JSON", "utf8");
    const r1 = await loadAutomationsFile(bad);
    expect(r1.tasks).toHaveLength(0);
    const partial = join(dir, "partial.json");
    const good = validateAutomation(base({ id: makeUlid() }));
    if (!good.ok) throw new Error("fixture invalid");
    await writeFile(partial, JSON.stringify({ version: 1, tasks: [good.value, { name: "坏条目" }] }), "utf8");
    const r2 = await loadAutomationsFile(partial);
    expect(r2.tasks).toHaveLength(1);
    expect(r2.warnings.join()).toContain("无效已跳过");
  });

  it("journal append-only + 坏行跳过 + occurrenceKey 去重查询", async () => {
    const file = join(dir, "automations-journal.jsonl");
    const t0 = new Date("2026-09-12T01:00:00.000Z");
    const key = occurrenceKeyOf("task-1", t0);
    expect(key).toBe("task-1:2026-09-12T01:00:00.000Z");
    await appendJournalEntry(file, { task_id: "task-1", occurrence_key: key, due_at: t0.toISOString(), decision: "triggered", at: t0.toISOString() });
    await appendJournalEntry(file, { task_id: "task-1", occurrence_key: key + "#2", due_at: t0.toISOString(), decision: "skipped", reason: "overlap", at: t0.toISOString() });
    await appendJournalEntry(file, { task_id: "task-1", occurrence_key: key + "#3", due_at: t0.toISOString(), decision: "catchup", session_id: "会话 x · 2026-09-12 09:00", at: t0.toISOString() });
    const before = await readFile(file, "utf8");
    const r = await readJournalFile(file);
    expect(r.entries).toHaveLength(3);
    expect(r.warnings).toHaveLength(0);
    expect(r.entries.filter((e) => e.occurrence_key === key)).toHaveLength(1);
    // 坏行容忍
    await appendJournalEntry(file, { task_id: "x", occurrence_key: "k", due_at: t0.toISOString(), decision: "triggered", at: t0.toISOString() });
    await writeFile(file, before + "这不是 JSON\n", "utf8");
    const r2 = await readJournalFile(file);
    expect(r2.entries).toHaveLength(3);
    expect(r2.warnings.join()).toContain("不是合法 JSON");
  });

  // 审查 S2-10（修复任务书 2.3 / 拍板 E）：压缩（read 快照 → rename 覆盖）必须与追加同链。
  // 不互斥时，落在 read→rename 窗口里的追加会被 rename 整批抹掉——丢的是「该 occurrence
  // 已决」的唯一凭据，重启即重复补跑 / 重复记 skipped 账。这里把 20 条追加与一次压缩同时
  // 发起，断言全部存活（旧实现下 post-* 成片消失）。
  it("journal 压缩与并发追加同链：追加条目不被 rename 抹掉", async () => {
    const file = join(dir, "journal-compact.jsonl");
    const at = new Date("2026-09-12T02:00:00.000Z").toISOString();
    const pre: Promise<void>[] = [];
    for (let i = 0; i < 10_005; i++) {
      pre.push(appendJournalEntry(file, { task_id: "t", occurrence_key: "pre-" + String(i), due_at: at, decision: "skipped", reason: "too-old", at }));
    }
    await Promise.all(pre);
    const tail: string[] = [];
    const jobs: Promise<unknown>[] = [compactJournalIfLarge(file)];
    for (let i = 0; i < 20; i++) {
      const k = "post-" + String(i);
      tail.push(k);
      jobs.push(appendJournalEntry(file, { task_id: "t", occurrence_key: k, due_at: at, decision: "triggered", at }));
    }
    await Promise.all(jobs);
    const { entries, warnings } = await readJournalFile(file);
    expect(warnings).toHaveLength(0);
    const keys = new Set(entries.map((e) => e.occurrence_key));
    expect(tail.filter((k) => !keys.has(k))).toEqual([]);
  });

  // X2（P0-A 同族）：journal 改常驻句柄后，收敛（read 快照 → rename 覆盖写）必须让旧句柄失效
  // ——rename 之后旧句柄指向已被覆盖的旧 inode，后续写入会静默丢失（丢的正是"该 occurrence
  // 已决"的唯一凭据，重启后重复补跑）。当前实现里 resolveHandle 的 inode 校验已能捕获该覆盖，
  // 本用例是**回归锁**：将来若给 journal 写路径加 X1 式记忆化快路径而漏掉显式失效，这里必红。
  it("journal 收敛后旧句柄失效：后写的条目一条不丢（X2 回归）", async () => {
    const file = join(dir, "journal-invalidate.jsonl");
    const at = new Date("2026-09-12T02:00:00.000Z").toISOString();
    for (let i = 0; i < 10_005; i++) {
      await appendJournalEntry(file, { task_id: "t", occurrence_key: "pre-" + String(i), due_at: at, decision: "triggered", at });
    }
    const kept = await compactJournalIfLarge(file);
    expect(kept).toBe(4_000); // 收敛到 JOURNAL_KEEP_ENTRIES
    const post = Array.from({ length: 5 }, (_, i) => "post-" + String(i));
    for (const k of post) {
      await appendJournalEntry(file, { task_id: "t", occurrence_key: k, due_at: at, decision: "triggered", at });
    }
    const { entries } = await readJournalFile(file);
    expect(entries).toHaveLength(4_005);
    const keys = new Set(entries.map((e) => e.occurrence_key));
    expect(post.filter((k) => !keys.has(k))).toEqual([]); // 后写的 5 条一条不丢
  });
});

describe("M4a next-run 计算（croner + 锚点步进）", () => {
  const def = (over: Record<string, unknown>): AutomationDefinition => {
    const r = validateAutomation(base(over));
    if (!r.ok) throw new Error(r.errors.join());
    return r.value;
  };

  it("once：未来即该时刻，过去为 null", () => {
    const d = def({ schedule: { kind: "once", at: "2026-09-20T09:30:00+08:00" } });
    expect(nextOccurrence(d, new Date("2026-09-11T00:00:00Z"))?.toISOString()).toBe("2026-09-20T01:30:00.000Z");
    expect(nextOccurrence(d, new Date("2026-09-21T00:00:00Z"))).toBeNull();
  });

  it("interval 保持创建锚点对齐（everyMinutes=60）", () => {
    const d = def({ schedule: { kind: "interval", everyMinutes: 60 }, createdAt: "2026-09-12T00:00:00.000Z" });
    expect(nextOccurrence(d, new Date("2026-09-12T00:00:01Z"))?.toISOString()).toBe("2026-09-12T01:00:00.000Z");
    expect(nextOccurrence(d, new Date("2026-09-12T01:00:01Z"))?.toISOString()).toBe("2026-09-12T02:00:00.000Z");
  });

  it("daily/weekly/hourly 按 timeZone 墙钟（croner）", () => {
    const d = def({ schedule: { kind: "daily", time: "09:30" }, timeZone: "Asia/Shanghai" });
    expect(nextOccurrence(d, new Date("2026-09-11T00:00:00Z"))?.toISOString()).toBe("2026-09-11T01:30:00.000Z");
    const w = def({ schedule: { kind: "weekly", weekdays: [1, 3], time: "09:30" }, timeZone: "Asia/Shanghai" });
    // 2026-09-11 是周五 → 下一个周一 2026-09-14
    expect(nextOccurrence(w, new Date("2026-09-11T02:00:00Z"))?.toISOString()).toBe("2026-09-14T01:30:00.000Z");
    const h = def({ schedule: { kind: "hourly", minute: 45 }, timeZone: "UTC" });
    expect(nextOccurrence(h, new Date("2026-09-11T10:00:00Z"))?.toISOString()).toBe("2026-09-11T10:45:00.000Z");
  });

  it("monthly 短月跳过（cron 语义）与 last", () => {
    const m31 = def({ schedule: { kind: "monthly", monthDay: 31, time: "09:00" }, timeZone: "UTC" });
    // 1月30日的下一天就是1月31日（合法时刻优先）→ 短月跳过要从2月起问：2月无31 → 3月31
    expect(nextOccurrence(m31, new Date("2026-01-30T00:00:00Z"))?.getUTCMonth()).toBe(0); // 1月31日
    expect(nextOccurrence(m31, new Date("2026-02-01T00:00:00Z"))?.getUTCMonth()).toBe(2); // 2月1日后 → 3月31（2月无31）
    const last = def({ schedule: { kind: "monthly", monthDay: "last", time: "09:00" }, timeZone: "UTC" });
    expect(nextOccurrence(last, new Date("2026-01-05T00:00:00Z"))?.toISOString()).toBe("2026-01-31T09:00:00.000Z");
  });

  it("custom 锚点 = 创建日；occurrencesBetween 有界枚举", () => {
    const c = def({ schedule: { kind: "custom", everyDays: 14, time: "10:00" }, timeZone: "UTC", createdAt: "2026-09-01T00:00:00.000Z" });
    expect(nextOccurrence(c, new Date("2026-09-02T00:00:00Z"))?.toISOString()).toBe("2026-09-15T10:00:00.000Z");
    const iv = def({ schedule: { kind: "interval", everyMinutes: 5 }, createdAt: "2026-09-12T00:00:00.000Z" });
    const occ = occurrencesBetween(iv, new Date("2026-09-12T00:00:00Z"), new Date("2026-09-12T01:00:00Z"));
    expect(occ).toHaveLength(12); // +5min … +60min
    expect(occ[0]!.toISOString()).toBe("2026-09-12T00:05:00.000Z");
    expect(occurrencesBetween(iv, new Date("2026-09-12T00:00:00Z"), new Date("2026-09-12T00:03:00Z"))).toHaveLength(0);
  });

  it("formatLocal 输出任务时区墙钟", () => {
    expect(formatLocal(new Date("2026-09-12T01:30:00Z"), "Asia/Shanghai")).toBe("2026-09-12 09:30");
  });
});

/** 可注入的调度器工厂：now 可传数值或可变 getter；executor 缺省 hang-on-abort（供闸测试，毫秒超时可收束）。 */
function makeScheduler(over: Partial<SchedulerDeps> & { now?: number | (() => number) } = {}): { s: Scheduler; sessions: string; data: string } {
  const sessions = join(dir, "sessions-" + Math.random().toString(36).slice(2, 8));
  const data = join(dir, "data-" + Math.random().toString(36).slice(2, 8));
  const nowVal = over.now;
  const clock: () => number =
    typeof nowVal === "function" ? nowVal : () => (typeof nowVal === "number" ? nowVal : 1_789_000_000_000);
  const deps: SchedulerDeps = {
    dataDir: data,
    sessionsDir: sessions,
    workspace: dir,
    clock,
    jitterMs: () => 0,
    runTimeoutMs: 600, // 闸测试默认短阈值：abort 后 executor 收束，不给 vitest 留长定时器
    settlesWithinMs: 600,
    ...over,
  };
  delete (deps as { now?: unknown }).now;
  return { s: new Scheduler(deps), sessions, data };
}

/** 闸测试执行器：挂起但 abort 即收束（真实取消语义），避免悬空长定时器。 */
const hangOnSignal: TriggerExecutor = ({ signal }) =>
  new Promise<{ ok: boolean }>((resolve) => {
    if (signal.aborted) {
      resolve({ ok: true });
      return;
    }
    signal.addEventListener("abort", () => resolve({ ok: true }));
  });

const CREATED = "2026-09-11T00:00:00.000Z"; // 显式 createdAt（早于所有 fake now 的 dueAt）

describe("M4a 准入管线（三闸顺序短路 + 去重 + 补跑）", () => {
  it.each([
    { source: "manual", sameTask: false, cap: 1, reason: "concurrency-cap" },
    { source: "tick", sameTask: false, cap: 1, reason: "concurrency-cap" },
    { source: "manual", sameTask: true, cap: 4, reason: "overlap" },
    { source: "tick", sameTask: true, cap: 4, reason: "overlap" },
  ])("atomic admission: $source/manual sameTask=$sameTask cap=$cap", async ({ source, sameTask, cap, reason }) => {
    let now = Date.parse("2026-09-12T02:00:00Z");
    let releaseSession!: () => void;
    let sessionEntered!: () => void;
    let finishRun!: (result: { ok: boolean }) => void;
    const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
    const entered = new Promise<void>((resolve) => { sessionEntered = resolve; });
    const execution = new Promise<{ ok: boolean }>((resolve) => { finishRun = resolve; });
    const executor = vi.fn<TriggerExecutor>(() => execution);
    const { s, sessions } = makeScheduler({ now: () => now, getCap: () => cap, runSession: executor, runTimeoutMs: 60_000 });
    const first = await s.upsert(base({ name: "first", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    const second = sameTask ? first : await s.upsert(base({ name: "second", enabled: false, createdAt: CREATED }));
    if (!first.ok || !second.ok) throw new Error("upsert fail");
    // Pause after journal but before inflight.set: force the audited IO window, without sleeps.
    const create = sessionStore.createSession;
    const createSpy = vi.spyOn(sessionStore, "createSession").mockImplementationOnce(async (...args) => {
      sessionEntered();
      await sessionGate;
      return create(...args);
    });
    const firstRequest = source === "tick" ? s.tick({ startup: true }) : s.runNow(first.value.id);
    let secondRequest: ReturnType<Scheduler["runNow"]> | undefined;
    try {
      await entered;
      now += 1; // same-task test must reach overlap, not occurrence-key dedup
      secondRequest = s.runNow(second.value.id);
      releaseSession();
      const [accepted, rejected] = await Promise.all([firstRequest, secondRequest]);
      if ("catchup" in accepted) expect(accepted.catchup).toBe(1);
      else expect(accepted.ok).toBe(true);
      expect(rejected).toEqual({ ok: false, error: "触发被闸拒绝: " + reason });
      expect(s.inflightCount).toBe(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledTimes(1);
      expect(executor.mock.calls[0]![0].mode).toBe("read-only");
      const { entries } = await readJournalFile(s.journalPath);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.decision).toBe(source === "tick" ? "catchup" : "triggered");
      expect(entries[1]).toMatchObject({ task_id: second.value.id, decision: "skipped", reason, due_at: new Date(now).toISOString() });
      expect(await listSessions(sessions)).toHaveLength(1);
      // Rejected occurrence stays decided: no retry/new journal row even after the winner finishes.
      finishRun({ ok: true });
      await s.whenIdle;
      expect(s.inflightCount).toBe(0);
      expect((await s.runNow(second.value.id)).error).toContain("去重");
      expect((await readJournalFile(s.journalPath)).entries).toHaveLength(2);
    } finally {
      releaseSession();
      finishRun({ ok: true });
      await Promise.allSettled([firstRequest, ...(secondRequest ? [secondRequest] : [])]);
      await s.whenIdle;
      createSpy.mockRestore();
      s.stop();
    }
  });

  it("admission IO failure releases the lock without rolling back the decided journal", async () => {
    const { s } = makeScheduler({ getCap: () => 1, runSession: async () => ({ ok: true }) });
    const first = await s.upsert(base({ name: "failed admission" }));
    const second = await s.upsert(base({ name: "next admission" }));
    if (!first.ok || !second.ok) throw new Error("upsert fail");
    const createSpy = vi.spyOn(sessionStore, "createSession").mockRejectedValueOnce(new Error("session IO failed"));
    try {
      const [failed, admitted] = await Promise.allSettled([s.runNow(first.value.id), s.runNow(second.value.id)]);
      expect(failed).toMatchObject({ status: "rejected", reason: { message: "session IO failed" } });
      expect(admitted).toEqual({ status: "fulfilled", value: { ok: true } });
      await s.whenIdle;
      expect(s.inflightCount).toBe(0);
      expect((await s.runNow(first.value.id)).error).toContain("去重");
      const { entries } = await readJournalFile(s.journalPath);
      expect(entries.map((entry) => [entry.task_id, entry.decision])).toEqual([
        [first.value.id, "triggered"], [second.value.id, "triggered"],
      ]);
    } finally {
      await s.whenIdle;
      createSpy.mockRestore();
    }
  });

  it("并发闸：cap=2 三任务同时到期 → 第三 skipped(concurrency-cap)；inflight 独立计数", async () => {
    const { s } = makeScheduler({ runSession: hangOnSignal, getCap: () => 2, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    for (const n of ["甲", "乙", "丙"]) {
      const r = await s.upsert(base({ name: n, schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
      expect(r.ok).toBe(true);
    }
    const report = await s.tick({ startup: true });
    expect(report.catchup).toBe(2);
    expect(report.skipped["concurrency-cap"]).toBe(1);
    expect(s.inflightCount).toBe(2);
    const snap = await s.snapshot();
    expect(snap.cap).toBe(2);
    expect(snap.running + snap.queued).toBe(2);
    // 与 worker 并发独立：调度 cap 与编排上限互不影响（独立计数断言面）
    expect(MAX_CONCURRENT_WORKERS).toBe(4);
    expect(DEFAULT_CONCURRENCY_CAP).toBe(2);
  });

  it("重叠闸：同任务 queued/running 期间再次到期/run_now → skipped(overlap)", async () => {
    const { s } = makeScheduler({ runSession: hangOnSignal, getCap: () => 4, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    const r = await s.upsert(base({ name: "跑得慢", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    if (!r.ok) throw new Error("upsert fail");
    const id = r.value.id;
    await s.tick({ startup: true });
    expect(s.inflightCount).toBe(1);
    const rn = await s.runNow(id);
    expect(rn.ok).toBe(false);
    expect(rn.error).toContain("overlap");
    const j = await readJournalFile(s.journalPath);
    expect(j.entries.filter((e) => e.decision === "skipped" && e.reason === "overlap")).toHaveLength(1);
  });

  it("occurrenceKey 去重：同 dueAt 双触发只建一个会话（崩溃/重启双触发免疫）", async () => {
    // 即完成 executor（非 hang）：hang 会让首个 occurrence 持续 inflight，run_now 会正确撞重叠闸（由重叠闸测试覆盖）
    const okExecutor: TriggerExecutor = async () => ({ ok: true });
    const { s, sessions } = makeScheduler({ runSession: okExecutor, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    await s.upsert(base({ name: "去重靶", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    const r1 = await s.tick({ startup: true });
    expect(r1.catchup).toBe(1);
    await s.whenIdle; // 首个 occurrence 收束（inflight 清空），run_now 不再被重叠闸挡
    const jAfter1 = (await readJournalFile(s.journalPath)).entries.length;
    const sessions1 = (await listSessions(sessions)).filter((x) => x.origin === "scheduled");
    // 同一 occurrence 再次进管线（模拟重启后误判到期）：journal 水位已推进 → 不重复决策不重复建会话
    const r2 = await s.tick({ startup: true });
    expect(r2.duplicates).toBe(0);
    expect(r2.catchup).toBe(0);
    expect((await readJournalFile(s.journalPath)).entries.length).toBe(jAfter1); // journal 零增长
    const sessions2 = (await listSessions(sessions)).filter((x) => x.origin === "scheduled");
    expect(sessions2.length).toBe(sessions1.length); // 不重复建会话
    expect(sessions1.length).toBe(1);
    // 显式去重路径：冻结时钟下 run_now 两次 → 同 occurrenceKey（taskId:nowISO）→ 第二次被去重拒绝
    const id = (await s.list()).find((t) => t.name === "去重靶")!.id;
    const rn1 = await s.runNow(id);
    expect(rn1.ok).toBe(true);
    const jAfterRn = (await readJournalFile(s.journalPath)).entries.length;
    const rn2 = await s.runNow(id);
    expect(rn2.ok).toBe(false);
    expect(rn2.error).toContain("去重");
    expect((await readJournalFile(s.journalPath)).entries.length).toBe(jAfterRn); // 无新账
  });

  it("补跑闸：catchUp=latest 取最近一次错过（decision=catchup），更旧记 too-old", async () => {
    // interval 60min，创建于 08:00Z，now=14:30Z → 错过 09:00..14:00 共 6 次（全在 7 天窗内）
    const { s } = makeScheduler({ runSession: hangOnSignal, now: new Date("2026-09-12T14:30:00Z").getTime() });
    await s.start();
    s.stop();
    await s.upsert(base({ name: "补跑靶", schedule: { kind: "interval", everyMinutes: 60 }, createdAt: "2026-09-12T08:00:00.000Z" }));
    const report = await s.tick({ startup: true });
    expect(report.catchup).toBe(1);
    expect(report.skipped["too-old"]).toBe(5);
    const j = await readJournalFile(s.journalPath);
    const cu = j.entries.find((e) => e.decision === "catchup");
    expect(cu?.due_at).toBe("2026-09-12T14:00:00.000Z"); // 最近一次
    expect(j.entries.filter((e) => e.decision === "skipped" && e.reason === "too-old")).toHaveLength(5);
  });

  it("补跑闸：catchUp=skip 档不补跑（skipped=catch-up-skip），7 天窗外直接丢弃", async () => {
    const { s } = makeScheduler({ runSession: hangOnSignal, now: new Date("2026-09-12T14:30:00Z").getTime() });
    await s.start();
    s.stop();
    await s.upsert(
      base({
        name: "skip 档",
        schedule: { kind: "interval", everyMinutes: 60 },
        catchUp: "skip",
        createdAt: "2026-09-12T08:00:00.000Z",
      }),
    );
    const report = await s.tick({ startup: true });
    expect(report.catchup).toBe(0);
    expect(report.triggered).toBe(0);
    expect(report.skipped["catch-up-skip"]).toBe(1);
    expect(report.skipped["too-old"]).toBe(5);
    // 8 天前创建、daily 任务（显式 UTC，墙钟口径确定）：窗口内只看最近 7 天，更早的错过不枚举不落账
    const s2 = makeScheduler({ runSession: hangOnSignal, now: new Date("2026-09-20T09:00:00Z").getTime() });
    await s2.s.start();
    s2.s.stop();
    await s2.s.upsert(base({ name: "八天前", schedule: { kind: "daily", time: "09:00" }, timeZone: "UTC", createdAt: "2026-09-04T09:00:00.000Z" }));
    const rep2 = await s2.s.tick({ startup: true });
    expect(rep2.catchup).toBe(1);
    expect(rep2.skipped["too-old"]).toBe(6); // 09-13..09-19（09-20 09:00 尚未到点——墙钟同时刻不算错过）
    const j2 = await readJournalFile(s2.s.journalPath);
    const dues = j2.entries.map((e) => e.due_at).sort();
    expect(dues[0]).toBe("2026-09-14T09:00:00.000Z"); // 7 天窗起点（09-13T09:00）严格之后的首个错过
  });
  // 审查 S2-11（任务 2.4）：运行期补记账必须有上限。interval 60min，启动补跑把水位推到
  // 最近一次，再把时钟推到 09-12 08:30（约 187 条错过）：旧实现这一拍逐条写约 187 行
  // skipped 账 + 同等次数的投影通知（启动路径有 catchupGate 的 20 条上限，运行期这条没有）。
  // 修法：最近 RUNTIME_SKIP_DETAIL=20 条逐条，其余折成一条聚合账（occurrence_key 带 +foldN，
  // 不与真实 occurrence 撞键，去重语义不变；due_at = 被折叠区间最早一条，时间范围仍可查）。
  it("运行期补记账有上限：20 条逐条 + 一条聚合账", async () => {
    const { s } = makeScheduler({ runSession: async () => ({ ok: true }), now: new Date("2026-09-05T01:30:00Z").getTime() });
    await s.start();
    s.stop();
    await s.upsert(base({ name: "长睡眠靶", schedule: { kind: "interval", everyMinutes: 60 }, createdAt: "2026-09-05T00:00:00.000Z" }));
    const r1 = await s.tick({ startup: true });
    expect(r1.catchup + r1.triggered).toBe(1); // 启动补跑只跑最近一次（语义不变）
    // X2（appendJournalEntry 改常驻句柄，2.2ms/次 → 23µs/次）后 r1 那一跑不再「天然」收束：
    // 旧实现靠 appendFile 的毫秒级 IO 把这一跑放完，r2 才不会被重叠闸挡。本用例断言的是
    // 「运行期补记账的上限」，不是重叠闸——显式等 r1 收束，消除时序依赖（r1 未收束时 r2 的末条
    // occurrence 会被**正确地**判成 skipped(overlap)，triggered=0，与记账上限无关）。
    await s.whenIdle;
    const r2 = await s.tick({ startup: false, now: Date.parse("2026-09-12T08:30:00Z") });
    expect(r2.triggered).toBe(1);
    const j = await readJournalFile(s.journalPath);
    const foldRe = /\+fold(\d+)$/;
    const skips = j.entries.filter((e) => e.reason === "too-old");
    expect(skips.filter((e) => !foldRe.test(e.occurrence_key)).length).toBeLessThanOrEqual(20);
    const fold = skips.map((e) => foldRe.exec(e.occurrence_key)).find((m) => m !== null);
    expect(fold).toBeTruthy();
    expect(Number(fold?.[1] ?? "0")).toBeGreaterThan(100); // 旧实现：没有聚合行，且逐条约 187 行 => 上面两条同时红
    await s.whenIdle;
  });

  it("常规 tick：now ≥ nextRunAt 即进管线（不依赖 tick 命中）；跳过后水位推进不重试", async () => {
    let now = new Date("2026-09-12T00:02:00Z").getTime();
    const okExecutor: TriggerExecutor = async () => ({ ok: true });
    const { s } = makeScheduler({ runSession: okExecutor, now: () => now });
    await s.start();
    s.stop();
    await s.upsert(base({ name: "常规靶", schedule: { kind: "interval", everyMinutes: 5 }, createdAt: "2026-09-12T00:00:00.000Z" }));
    await s.tick({ startup: true }); // 无错过（创建才 2 分钟）
    expect(s.inflightCount).toBe(0);
    now = new Date("2026-09-12T00:11:00Z").getTime(); // 一次跳到 +11min（错过 +5、+10）
    const report = await s.tick();
    expect(report.triggered).toBe(1); // 只取最近一次，不逐条重放
    const report2 = await s.tick(); // 同一 now 重 tick → 无新决策（水位 = 最近已决）
    expect(report2.triggered).toBe(0);
    await s.whenIdle;
    const snap = await s.snapshot();
    expect(snap.history.filter((h) => h.state === "succeeded")).toHaveLength(1);
  });
});

describe("M4a 触发执行与完成回写", () => {
  it("executor 成功 → 终态 automation_completed 落会话 + snapshot succeeded；会话带 origin/automation_name", async () => {
    const okExecutor: TriggerExecutor = async () => ({ ok: true });
    const { s, sessions } = makeScheduler({ runSession: okExecutor, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    // once 排在冻结时钟之后：启动 tick 无错过（零决策），推钟到 02:30 走常规 tick → decision=triggered
    await s.upsert(base({ name: "只读任务", schedule: { kind: "once", at: "2026-09-12T02:30:00Z" }, createdAt: CREATED }));
    await s.tick({ startup: true });
    const rep = await s.tick({ now: new Date("2026-09-12T02:30:00Z").getTime() });
    expect(rep.triggered).toBe(1);
    await s.whenIdle;
    const infos = await listSessions(sessions);
    const sched = infos.find((x) => x.origin === "scheduled");
    expect(sched).toBeDefined();
    expect(sched!.automationName).toBe("只读任务");
    expect(sched!.id.startsWith("只读任务 · ")).toBe(true); // 标题 = 任务名 · 触发时刻
    const events = await replay(join(sessions, sched!.id + ".jsonl"));
    const completed = events.find((e): e is Extract<AgentEvent, { type: "automation_completed" }> => e.type === "automation_completed");
    expect(completed?.status).toBe("succeeded");
    const snap = await s.snapshot();
    expect(snap.history.filter((h) => h.state === "succeeded")).toHaveLength(1);
    expect(snap.history[0]!.decision).toBe("triggered");
  });

  it("超时双闸（短阈值）：闸一 abort 后 loop 收束；宿主不响应 → settlesWithin 二道退出 failed(timeout)", async () => {
    // 宿主不响应 abort 的 executor：永不 resolve（真悬挂，只靠闸二二道退出）
    const hangForever: TriggerExecutor = async () => new Promise<{ ok: boolean }>(() => {});
    const { s } = makeScheduler({
      runSession: hangForever,
      runTimeoutMs: 50,
      settlesWithinMs: 60,
      now: new Date("2026-09-12T02:00:00Z").getTime(),
    });
    await s.start();
    s.stop();
    await s.upsert(base({ name: "卡死靶", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    await s.tick({ startup: true });
    const t0 = Date.now();
    await s.whenIdle;
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2000); // 不等 30min，二道退出生效
    const snap = await s.snapshot();
    const failed = snap.history.find((h) => h.state === "failed");
    expect(failed?.reason).toBe("timeout");
    expect(s.inflightCount).toBe(0); // 已退出，不悬挂
    // 闸一真实路径：executor 收到 abort 信号即收束 → failed(timeout) 且 abort 真被触发
    let abortObserved = false;
    const abortAware: TriggerExecutor = ({ signal }) =>
      new Promise<{ ok: boolean }>((resolve) => {
        signal.addEventListener("abort", () => {
          abortObserved = true;
          resolve({ ok: true });
        });
      });
    const s2 = makeScheduler({ runSession: abortAware, runTimeoutMs: 40, settlesWithinMs: 5_000, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s2.s.start();
    s2.s.stop();
    await s2.s.upsert(base({ name: "abort 靶", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    await s2.s.tick({ startup: true });
    await s2.s.whenIdle;
    expect(abortObserved).toBe(true);
    const snap2 = await s2.s.snapshot();
    expect(snap2.history.find((h) => h.state === "failed")?.reason).toBe("timeout");
  });

  it("summarizeRun：最后 assistant 截断 + tool_stats + usage；完成卡 payload 复用 report 形状", async () => {
    const log = join(dir, "s.jsonl");
    const l = createEventLog(log);
    await l.append({ type: "user_message", content: "任务" });
    await l.append({ type: "tool_call", id: "t1", name: "read_file", args: {} });
    await l.append({ type: "tool_result", callId: "t1", ok: true, output: "x" });
    await l.append({ type: "usage", inputTokens: 10, outputTokens: 5 });
    await l.append({ type: "assistant_message", content: "y".repeat(300) });
    await l.append({ type: "tool_call", id: "t2", name: "read_file", args: {} });
    await l.append({ type: "tool_result", callId: "t2", ok: true, output: "z" });
    await l.append({ type: "usage", inputTokens: 20, outputTokens: 7 });
    const sum = summarizeRun(await replay(log));
    expect(sum.summary.startsWith("yyy")).toBe(true);
    expect(sum.summary.length).toBeLessThanOrEqual(281);
    expect(sum.summary.endsWith("…")).toBe(true);
    expect(sum.toolStats).toEqual({ read_file: 2 });
    expect(sum.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
  });

  it("upsert：name 唯一拒绝 / 更新保留 createdAt；删除落盘", async () => {
    const { s } = makeScheduler({ runSession: hangOnSignal });
    await s.start();
    s.stop();
    const r1 = await s.upsert(base());
    expect(r1.ok).toBe(true);
    const dup = await s.upsert(base());
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join()).toContain("name 唯一");
    if (!r1.ok) throw new Error("unreachable");
    const r2 = await s.upsert({ ...r1.value, prompt: "改过的 prompt" });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.createdAt).toBe(r1.value.createdAt);
    const del = await s.remove(r1.value.id);
    expect(del.ok).toBe(true);
    expect(s.list()).toHaveLength(0);
    const back = await loadAutomationsFile(s.definitionsPath);
    expect(back.tasks).toHaveLength(0);
  });

  it("run_now 走准入管线（并发闸同样生效）；automation_completed 失败路径带 reason", async () => {
    const failExecutor: TriggerExecutor = async () => ({ ok: false, error: "boom" });
    const { s } = makeScheduler({ runSession: failExecutor, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    const r = await s.upsert(base({ name: "失败靶", schedule: { kind: "interval", everyMinutes: 5 }, createdAt: "2026-09-12T01:00:00.000Z" }));
    if (!r.ok) throw new Error("unreachable");
    const rn = await s.runNow(r.value.id);
    expect(rn.ok).toBe(true);
    await s.whenIdle;
    const snap = await s.snapshot();
    expect(snap.history.find((h) => h.state === "failed")?.reason).toBe("boom");
    // 并发闸对 run_now 生效：cap=1 已有一个 inflight（hang）时 run_now 被拒
    const s2 = makeScheduler({ runSession: hangOnSignal, getCap: () => 1, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s2.s.start();
    s2.s.stop();
    const a = await s2.s.upsert(base({ name: "占位", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    const b = await s2.s.upsert(base({ name: "第二名", schedule: { kind: "once", at: "2026-09-12T01:00:00Z" }, createdAt: CREATED }));
    await s2.s.tick({ startup: true }); // 甲占住唯一额度
    expect(s2.s.inflightCount).toBe(1);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    const rn2 = await s2.s.runNow(b.value.id);
    expect(rn2.ok).toBe(false);
    expect(rn2.error).toContain("concurrency-cap");
  });

  it("snapshot(状态) 真按状态筛：面板的「只看失败」读的是全量里最近的失败，而不是本地 12 条再过滤", async () => {
    const failExecutor: TriggerExecutor = async () => ({ ok: false, error: "boom" });
    const { s } = makeScheduler({ runSession: failExecutor, now: new Date("2026-09-12T02:00:00Z").getTime() });
    await s.start();
    s.stop();
    const r = await s.upsert(base({ name: "筛选靶", schedule: { kind: "interval", everyMinutes: 5 }, createdAt: "2026-09-12T01:00:00.000Z" }));
    if (!r.ok) throw new Error("unreachable");
    await s.runNow(r.value.id);
    await s.whenIdle;
    const all = await s.snapshot();
    const failed = await s.snapshot("failed");
    const cancelled = await s.snapshot("cancelled");
    expect(all.history.length, "靶子该留下一条历史").toBeGreaterThan(0);
    expect(failed.history.length, "筛 failed 不能把那条失败筛掉").toBeGreaterThan(0);
    expect(failed.history.every((h) => h.state === "failed")).toBe(true);
    expect(cancelled.history, "V1 没有取消入口：筛 cancelled 必须是空，而不是回全量").toEqual([]);
    // 筛剩的只动 history：并发/排队计数与任务清单不参与筛选（否则「只看失败」会把在跑的任务藏掉）
    expect(failed.tasks).toEqual(all.tasks);
    expect(failed.running).toBe(all.running);
    // 跨进程输入的归一：认不出的值按「全部」，绝不按某个具体状态筛（假空比填空更坏）
    expect(normalizeHistoryFilter("Mars/NotAState")).toBe("all");
    expect(normalizeHistoryFilter(undefined)).toBe("all");
    expect(normalizeHistoryFilter("skipped")).toBe("skipped");
  });
});

// P1（审查）回归：常驻路径（interval/启动补跑）的 tick 拒绝不逃逸——journal/会话落盘 IO 失败
// 曾以 unhandled rejection 直达主进程崩溃面。手动 tick 的 await 语义不变（照常 reject）。
describe("tick 拒绝护栏（P1 回归）", () => {
  it("tickGuarded 就地捕获 tick 拒绝并走 onWarn（vitest 对 unhandled rejection 直接判红）", async () => {
    const warns: string[] = [];
    const { s } = makeScheduler({ onWarn: (m: string) => warns.push(m) });
    const boom = async (): Promise<never> => {
      throw new Error("boom-io");
    };
    (s as unknown as { tick: () => Promise<never> }).tick = boom; // 模拟落盘 IO 失败
    (s as unknown as { tickGuarded(opts?: { startup?: boolean }): void }).tickGuarded({ startup: true });
    await new Promise((r) => setTimeout(r, 20)); // 给 catch 回调执行机会
    expect(warns.some((m) => m.includes("boom-io"))).toBe(true);
  });

  it("手动 tick 仍保留原拒绝语义（await 方可见错误）", async () => {
    const { s } = makeScheduler();
    (s as unknown as { tick: () => Promise<never> }).tick = async () => {
      throw new Error("boom-manual");
    };
    await expect(s.tick()).rejects.toThrow("boom-manual");
  });
});

// 2026-10-19 独立评审：调度 journal 在 spawn **前**写（崩溃窗口不双跑），因此条目天然没有
// session_id；旧实现只把 session_id 放内存 ⇒ 重启后所有成功触发都投影成 failed/interrupted。
describe("调度会话索引跨重启（journal 无 session_id 的补账）", () => {
  it("建会话后落旁路索引；新实例 snapshot 仍能取到 session_id", async () => {
    const now = Date.parse("2026-09-12T12:00:00Z");
    const data = join(dir, "shared-data");
    const sessions = join(dir, "shared-sessions");
    const common: SchedulerDeps = {
      dataDir: data,
      sessionsDir: sessions,
      workspace: dir,
      clock: () => now,
      jitterMs: () => 0,
      runSession: async () => ({ ok: true }),
      runTimeoutMs: 600,
      settlesWithinMs: 600,
    };
    const s1 = new Scheduler(common);
    await s1.start();
    s1.stop();
    await s1.upsert(base({
      name: "索引靶",
      schedule: { kind: "interval", everyMinutes: 5 },
      createdAt: new Date(now - 10 * 60_000).toISOString(),
    }));
    const rep = await s1.tick({ startup: true });
    expect(rep.catchup + rep.triggered).toBe(1);
    const key = rep.decisions.find((d) => d.decision === "catchup" || d.decision === "triggered")!.occurrence_key;

    const index = JSON.parse(await readFile(join(data, "automation-sessions.json"), "utf8")) as Record<string, string>;
    const sid = index[key];
    expect(sid, "旁路索引里应有 occurrence_key → session_id").toBeTruthy();

    const s2 = new Scheduler(common);
    await s2.start();
    s2.stop();
    const snap = await s2.snapshot();
    const row = snap.history.find((h) => h.occurrence_key === key);
    expect(row?.session_id).toBe(sid);
  });
});

// 2026-10-19 独立评审：枚举帽只留最早 500 条 ⇒ 启动 tick 处理不到最近一次，下一 tick 把剩余
// 最近的一条当 triggered 真跑（skip 档也跑；latest 档跑两次）。
describe("补跑枚举帽按最近 500 条（长停机不越界补跑）", () => {
  const NOW = Date.parse("2026-09-12T12:00:00Z");
  // 50h / 5min = 600 次错过（上限 500）。
  const CREATED_50H = new Date(NOW - 50 * 3_600_000).toISOString();

  it("skip 档：启动 tick 后下一分钟 tick 不得触发（旧行为会跑一条 41h 前的）", async () => {
    const { s } = makeScheduler({ now: NOW, runSession: async () => ({ ok: true }) });
    await s.start();
    s.stop();
    await s.upsert(base({
      name: "长停机 skip",
      schedule: { kind: "interval", everyMinutes: 5 },
      catchUp: "skip",
      createdAt: CREATED_50H,
    }));
    const startup = await s.tick({ startup: true });
    expect(startup.triggered).toBe(0);
    expect(startup.skipped["catch-up-skip"]).toBe(1);
    // 被帽舍弃的前缀要留一条聚合账（审计可查）。
    expect(startup.skipped["too-old"]).toBeGreaterThan(0);
    const next = await s.tick({ now: NOW + 60_000 });
    expect(next.triggered).toBe(0);
    expect(next.catchup).toBe(0);
  });

  it("latest 档：只跑最近一次；下一 tick 不得再跑第二次", async () => {
    const { s } = makeScheduler({ now: NOW, runSession: async () => ({ ok: true }) });
    await s.start();
    s.stop();
    await s.upsert(base({
      name: "长停机 latest",
      schedule: { kind: "interval", everyMinutes: 5 },
      catchUp: "latest",
      createdAt: CREATED_50H,
    }));
    const startup = await s.tick({ startup: true });
    expect(startup.catchup).toBe(1);
    const j = await readJournalFile(s.journalPath);
    const cu = j.entries.filter((e) => e.decision === "catchup");
    expect(cu).toHaveLength(1);
    expect(cu[0]!.due_at).toBe("2026-09-12T12:00:00.000Z"); // 最近一次（NOW 恰为 5min 边界）
    const next = await s.tick({ now: NOW + 60_000 });
    expect(next.triggered).toBe(0);
    expect(next.catchup).toBe(0);
  });
});

// 2026-10-19：同根两个调度实例（桌面 app + `cairn --serve`）内存去重表互不可见 ⇒ 同一
// occurrence 双触发；整表回写还会抹掉对方刚建的任务。
describe("同根多实例：journal 去重与任务表合并", () => {
  it("两个实例对同一 occurrence 只触发一次", async () => {
    const now = Date.parse("2026-09-12T12:00:00Z");
    const data = join(dir, "multi-data");
    const sessions = join(dir, "multi-sessions");
    const common: SchedulerDeps = {
      dataDir: data, sessionsDir: sessions, workspace: dir,
      clock: () => now, jitterMs: () => 0,
      runSession: async () => ({ ok: true }), runTimeoutMs: 600, settlesWithinMs: 600,
    };
    const s1 = new Scheduler(common);
    await s1.start(); s1.stop();
    await s1.upsert(base({
      name: "多实例靶",
      schedule: { kind: "interval", everyMinutes: 5 },
      createdAt: new Date(now - 10 * 60_000).toISOString(),
    }));
    const s2 = new Scheduler(common); // 在 s1 写任务之后装载
    await s2.start(); s2.stop();
    const r1 = await s1.tick({ startup: true });
    const r2 = await s2.tick({ startup: true });
    expect(r1.catchup + r1.triggered).toBe(1);
    expect(r2.catchup + r2.triggered).toBe(0);
    const j = await readJournalFile(join(data, "automations-journal.jsonl"));
    expect(j.entries.filter((e) => e.decision === "triggered" || e.decision === "catchup")).toHaveLength(1);
  });

  it("实例 B 的 upsert 不抹掉实例 A 刚建的任务", async () => {
    const data = join(dir, "multi-tasks");
    const sessions = join(dir, "multi-tasks-sessions");
    const common: SchedulerDeps = {
      dataDir: data, sessionsDir: sessions, workspace: dir, clock: () => Date.now(), jitterMs: () => 0,
    };
    const a = new Scheduler(common);
    const b = new Scheduler(common);
    await a.start(); a.stop(); await b.start(); b.stop();
    const r1 = await a.upsert(base({ name: "任务 A", schedule: { kind: "daily", time: "09:00" } }));
    expect(r1.ok).toBe(true);
    const r2 = await b.upsert(base({ name: "任务 B", schedule: { kind: "daily", time: "10:00" } }));
    expect(r2.ok).toBe(true);
    const disk = await loadAutomationsFile(join(data, "automations.json"));
    expect(disk.tasks.map((t) => t.name).sort()).toEqual(["任务 A", "任务 B"]);
  });
});
