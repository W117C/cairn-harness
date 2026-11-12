// 定时任务调度器（§12.2.2/§12.2.3/§12.2.4 实现定稿）：
// - 双轨存储：任务定义 automations.json（原子写 tmp+rename）；调度日志 automations-journal.jsonl（append-only，
//   每行 taskId/occurrenceKey/dueAt/decision triggered|skipped|catchup/reason?/sessionId?/at）；运行结果 = 会话本身
//   （session_meta.origin="scheduled"，标题 = 任务名 · 触发时刻；终态 = 会话内 automation_completed 事件）。
// - 单一 1min tick（不设每任务 timer）+ 启动随机抖动 1-3min 后才补跑判定（可注入 0 供验收）；clock() 可注入。
// - 准入管线顺序短路：①补跑闸（仅启动 tick：回看 7 天，catchUp=latest 取最近一次错过进管线、更旧记
//   skipped(too-old)；skip 档直接对齐）②并发闸（同时运行的定时会话 ≤2 可配；与 worker 并发上限独立计数）
//   ③重叠闸（同任务已有 queued/running → skipped(overlap)）④通过 → journal triggered/catchup + spawn。
// - occurrenceKey = taskId:dueAtISO，spawn 前查 journal 去重（崩溃/重启双触发免疫）。
// - 触发 = 全新会话（runSession 注入 = 真实代码路径 handleAgentRun 系）；unattended fail-closed 由会话侧
//   AskGate 承担；超时双闸 = runTimeoutMs（到点 abort，轮界收束）+ settlesWithin（宿主不响应时的二道退出）。
// - 完成回写：summarizeRun 纯投影摘要（零新 LLM 调用）→ automation_completed 事件（复用 report 卡类型）。
// electron-free；tick/jitter/clock/executor 全部可注入，验收禁止真实 sleep 等触发。
import { mkdir, open, readFile, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic-write";
import { processLiveness } from "../process-liveness";
import type { PermissionMode } from "../permissions/modes";
import { Cron } from "croner";
import type { AgentEvent } from "../events";
import { createEventLog, invalidateEventLogHandle, replay, resolveHandle } from "../events";
import { createSession, isValidSessionName, pathOf } from "./sessions";
import { parseMutationLockPid } from "./session-mutation-lock";
import { createIdleTask, readIdleTasks, saveIdleTasks, type IdleTaskResult, type IdleTaskSnapshot, type StoredIdleTask } from "./idle-tasks";
import {
  normalizeTimeZone,
  systemTimeZone,
  timeZoneOffsetLabel,
  validateAutomation,
  tierToMode,
  type AutomationCatchUp,
  type AutomationDefinition,
  type ValidationResult,
} from "./automations";

/** tick 周期：单一 1 分钟（§12.2.3）。 */
export const TICK_MS = 60_000;
/** 补跑回看窗口：7 天（§12.2.3 补跑闸）。 */
export const CATCHUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** runTimeoutMs 默认 30min（§12.2.4 超时双闸之一）。 */
export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** settlesWithin 默认 30s：abort 后宿主仍未收束 → 二道退出（不无限等）。 */
export const DEFAULT_SETTLES_WITHIN_MS = 30_000;
/** 并发上限默认 2（§12.2.3；设置页可调）。 */
export const DEFAULT_CONCURRENCY_CAP = 2;
/** 启动抖动缺省：随机 1-3 分钟（§12.2.3；验收注入 0）。 */
export function defaultJitterMs(): number {
  return 60_000 + Math.floor(Math.random() * 120_000);
}
/** 单任务回看窗口内枚举上限（5min interval × 7 天 ≈ 2016，防御性截断）。 */
const MAX_MISSED_ENUM = 500;
/** 运行期补记账的逐条上限（超出折一条聚合账）；与启动侧 catchupGate 的 20 条口径对齐。 */
const RUNTIME_SKIP_DETAIL = 20;
/** P1-9（审查）：completions 内存表容量帽——每个 occurrence 一条、永不删，长运行下无界增长。
 *  超帽淘汰最早插入的一条（照抄 termCache 的「512 + 淘汰首个」写法）。 */
const COMPLETIONS_MAX = 500;

// ---- 双轨存储之一：任务定义（automations.json，原子写）----

interface AutomationsFile {
  version: 1;
  tasks: AutomationDefinition[];
}

/** 加载任务定义（迁移容忍：坏条目跳过 + 警告，不静默丢整个清单）。
 *  **缺文件 ≠ 坏文件**：坏 JSON 单独标 `corrupt`，写路径据此拒绝覆盖（同会话元数据/队列口径）；
 *  把两者混成「空清单」会让下一次 upsert 把用户的任务表整份盖掉（实测路径：桌面加一条任务即可）。 */
export async function loadAutomationsFile(
  file: string,
): Promise<{ tasks: AutomationDefinition[]; warnings: string[]; corrupt: boolean }> {
  const warnings: string[] = [];
  let raw: unknown = null;
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [], warnings: [], corrupt: false };
    const reason = error instanceof Error ? error.message : String(error);
    return {
      tasks: [],
      warnings: [`调度任务文件损坏：${file}（${reason}）——修好或删除该文件后重试，本次不覆盖`],
      corrupt: true,
    };
  }
  const obj = raw as { version?: unknown; tasks?: unknown };
  const list = Array.isArray(obj?.tasks) ? obj.tasks : [];
  const tasks: AutomationDefinition[] = [];
  (list as unknown[]).forEach((t, i) => {
    const v = validateAutomation(t);
    if (v.ok) tasks.push(v.value);
    else warnings.push(`automations.json 第 ${String(i + 1)} 条无效已跳过：${v.errors.join("；")}`);
  });
  return { tasks, warnings, corrupt: false };
}

/** 保存任务定义（原子写：tmp + rename，中断自愈；与 settings/permissions 同款）。 */
export async function saveAutomationsFile(file: string, tasks: AutomationDefinition[]): Promise<void> {
  const payload: AutomationsFile = { version: 1, tasks };
  const text = JSON.stringify(payload, null, 2);
  try {
    await writeFileAtomic(file, text);
  } catch (err) {
    await writeFile(file, text, "utf8").catch(() => {}); // rename 失败退直写（不吞数据）
    throw err;
  }
}

// ---- 双轨存储之二：调度日志（journal.jsonl，append-only）----

export type ScheduleDecision = "triggered" | "skipped" | "catchup";
/** skipped 原因（中文标签唯一实现见 renderer/projections 的 skipReasonLabel：main 只落机器可读 token，
 *  措辞是表现层的事——两份措辞必然漂移，历史上已经漂过一次）。 */
export type SkipReason = "too-old" | "overlap" | "concurrency-cap" | "catch-up-skip" | "buffered";
/** 重复触发（occurrenceKey 已在 journal）= 静默去重，不写新账（崩溃/重启双触发免疫）。 */
export type Decision = ScheduleDecision;

export interface JournalEntry {
  task_id: string;
  occurrence_key: string;
  due_at: string;
  decision: Decision;
  reason?: string;
  session_id?: string;
  at: string;
}

export function occurrenceKeyOf(taskId: string, dueAt: Date): string {
  return taskId + ":" + dueAt.toISOString();
}

/** 审查 S2-10（修复任务书 2.3 / 拍板 E）：journal 的追加与压缩收敛共用同一条按文件键的 Promise 链。
 *  旧实现两者无互斥：compact 先 readFile 快照、再 rename 覆盖，中间落入的 append 会被 rename
 *  直接抹掉——丢的正是「该 occurrence 已决」的唯一凭据，重启后同一 occurrence 会重复补跑或
 *  重复记 skipped 账（判据面 schedule-check B 段只测坏行容忍，测不到这条交错）。
 *  链式串行与 events replay / B8 同一口径；链按文件键，跑完即回收（不单调增长）。 */
const journalChain = new Map<string, Promise<unknown>>();

/** journal 的**跨进程**写锁：append 与 compact 必须共用同一把，否则 compact 的
 *  readFile→rename 会覆盖另一实例在窗口内追加的 triggered 账（重启后同一 occurrence 重复跑）。
 *  与准入锁 `automations.lock` 分开：准入锁内会调用 append，共用一把会自锁。 */
const JOURNAL_FILE_LOCK = "automations-journal.lock";

async function schedulerLockOwner(path: string): Promise<ReturnType<typeof processLiveness>> {
  try {
    return processLiveness(parseMutationLockPid(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unknown";
    throw error;
  }
}

async function releaseSchedulerLock(path: string, handle: FileHandle): Promise<void> {
  try {
    const owned = await handle.stat();
    const current = await stat(path);
    if (current.dev === owned.dev && current.ino === owned.ino) {
      await rm(path, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[scheduler] 无法释放调度锁 ${path}:`, error);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function acquireSchedulerLock(path: string): Promise<FileHandle | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  try {
    await handle.writeFile(String(process.pid));
    return handle;
  } catch (error) {
    await releaseSchedulerLock(path, handle);
    throw error;
  }
}

async function recoverSchedulerLock(path: string): Promise<boolean> {
  const recoveryPath = path + ".recovery";
  const recovery = await acquireSchedulerLock(recoveryPath);
  if (recovery === null) return false;
  try {
    // 首次读到的陈旧锁可能已经换代。串行化回收后重查，只删确认已退出的持有者。
    if (await schedulerLockOwner(path) !== "dead") return false;
    await rm(path, { force: true });
    return true;
  } finally {
    await releaseSchedulerLock(recoveryPath, recovery);
  }
}

async function withJournalFileLock<T>(file: string, job: () => Promise<T>): Promise<T> {
  const lockPath = join(dirname(file), JOURNAL_FILE_LOCK);
  const deadline = Date.now() + 5_000;
  await mkdir(dirname(file), { recursive: true });
  for (;;) {
    const handle = await acquireSchedulerLock(lockPath);
    if (handle !== null) {
      try {
        return await job();
      } finally {
        await releaseSchedulerLock(lockPath, handle);
      }
    }
    if (await schedulerLockOwner(lockPath) === "dead" && await recoverSchedulerLock(lockPath)) continue;
    if (Date.now() >= deadline) {
      throw new Error(`调度日志锁无法取得，请检查锁及其回收标记是否为崩溃残留：${lockPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function onJournalPath<T>(file: string, job: () => Promise<T>): Promise<T> {
  const prev = journalChain.get(file);
  const next = (prev === undefined ? Promise.resolve() : prev.catch(() => undefined)).then(job);
  journalChain.set(file, next);
  void next.then(
    () => {
      if (journalChain.get(file) === next) journalChain.delete(file);
    },
    () => {},
  );
  return next;
}

export async function appendJournalEntry(file: string, entry: JournalEntry): Promise<void> {
  await onJournalPath(file, () => withJournalFileLock(file, async () => {
    const fh = await resolveHandle(file, isJournalEntry);
    await fh.write(JSON.stringify(entry) + "\n");
  }));
}

// ---- D7（审查 P2）：journal 保留上限——append-only 无界增长使 journalKeys/journalByTask/
// completions 内存单调增长、snapshot 对全部历史逐条投影。超帽收敛到最新 KEEP 条（原子替换）。 ----
const JOURNAL_MAX_ENTRIES = 10_000;
const JOURNAL_KEEP_ENTRIES = 4_000;

export async function compactJournalIfLarge(
  file: string,
  onCompacted?: (kept: JournalEntry[]) => void,
): Promise<number> {
  return await onJournalPath(file, () => withJournalFileLock(file, async () => {
    // 读必须在锁内：锁外读到的快照会漏掉另一实例在窗口内追加的账，rename 覆盖后那条账就没了。
    const { entries } = await readJournalFile(file);
    if (entries.length <= JOURNAL_MAX_ENTRIES) return entries.length;
    // 只保留「最近 KEEP 条」会挤掉稀疏任务唯一的已决账：一个每天跑一次的任务，其最后一条
    // triggered 可能早于其他任务制造的一万条噪音 ⇒ 重启后 lastDecidedAt 退回 createdAt，
    // 同一个 occurrence 被重新补跑。因此再并上**每个任务最后一条**（按原顺序去重）。
    const keepIdx = new Set<number>();
    for (let i = Math.max(0, entries.length - JOURNAL_KEEP_ENTRIES); i < entries.length; i++) keepIdx.add(i);
    const latestByTask = new Map<string, number>();
    entries.forEach((entry, index) => { latestByTask.set(entry.task_id, index); });
    for (const index of latestByTask.values()) keepIdx.add(index);
    const keep = entries.filter((_, index) => keepIdx.has(index));
    await writeFileAtomic(file, keep.map((e) => JSON.stringify(e) + "\n").join(""));
    // X2（关键）：覆盖写完成后**同链内**显式失效该 path 的常驻句柄——rename 之后缓存句柄仍指向
    // 已被覆盖掉的旧 inode，不失效则后续 appendJournalEntry 复用旧句柄，journal 写入静默丢失。
    // 与 A1 的 inode 校验同一类失效，但这里必须**显式**做（inode 校验只在 spawn 侧自然捕获）。
    await invalidateEventLogHandle(file);
    // P1-9（审查）：磁盘收敛后同步重建内存表——回调在**同链**内执行（不与并发追加交错），由
    // Scheduler 用保留条目回灌 journalKeys/journalByTask/sessionIdByKey（旧实现只截磁盘文件，
    // 内存三表对已截断历史仍单调增长）。
    onCompacted?.(keep);
    return keep.length;
  }));
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (value === null || typeof value !== "object") return false;
  const row = value as Partial<JournalEntry>;
  return typeof row.task_id === "string" && typeof row.occurrence_key === "string" && typeof row.decision === "string";
}

/** 读调度日志（append-only；坏行跳过 + 警告，不断链）。 */
export async function readJournalFile(file: string): Promise<{ entries: JournalEntry[]; warnings: string[] }> {
  const warnings: string[] = [];
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { entries: [], warnings };
  }
  const entries: JournalEntry[] = [];
  raw.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t === "") return;
    try {
      const e: unknown = JSON.parse(t);
      if (isJournalEntry(e)) {
        entries.push(e);
      } else {
        warnings.push(`journal 第 ${String(i + 1)} 行缺关键字段，已跳过`);
      }
    } catch {
      warnings.push(`journal 第 ${String(i + 1)} 行不是合法 JSON，已跳过`);
    }
  });
  return { entries, warnings };
}

// ---- next-run 计算（croner：hourly/daily/weekly/monthly 走 cron 表达式 + 时区；once/interval/custom 锚点步进）----

/** 时区墙钟 → UTC instant（two-pass 偏移校正；DST 不存在的时刻取近似合法时刻）。 */
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const get = (t: string): number => Number(dtf.formatToParts(at).find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUTC - at.getTime();
}

function zonedDate(tz: string, y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0);
  const off1 = tzOffsetMs(tz, new Date(guess));
  const off2 = tzOffsetMs(tz, new Date(guess - off1));
  return new Date(guess - off2);
}

function parseHHmm(time: string): { h: number; m: number } {
  const [h, m] = time.split(":").map((x) => Number(x));
  return { h: h ?? 0, m: m ?? 0 };
}

/** 月末短月跳过：cron 语义（croner dom=L / dom=31 在短月自动顺延到下一个合法日期）。 */
export function cronPatternFor(def: AutomationDefinition): string {
  const s = def.schedule;
  switch (s.kind) {
    case "hourly":
      return `${String(s.minute)} * * * *`;
    case "daily":
      return `${parseHHmm(s.time).m} ${parseHHmm(s.time).h} * * *`;
    case "weekly":
      return `${parseHHmm(s.time).m} ${parseHHmm(s.time).h} * * ${s.weekdays.join(",")}`;
    case "monthly":
      return `${parseHHmm(s.time).m} ${parseHHmm(s.time).h} ${s.monthDay === "last" ? "L" : String(s.monthDay)} * *`;
    default:
      return "";
  }
}

/** 下一次触发时刻（strictly after `after`；无下一次 = null，如 once 已过）。 */
export function nextOccurrence(def: AutomationDefinition, after: Date): Date | null {
  const s = def.schedule;
  const created = new Date(def.createdAt);
  if (s.kind === "once") {
    const at = new Date(s.at);
    return Number.isNaN(at.getTime()) || at.getTime() <= after.getTime() ? null : at;
  }
  if (s.kind === "interval") {
    // interval 保持创建锚点对齐（DSH every 语义）：createdAt + k·everyMinutes
    const stepMs = s.everyMinutes * 60_000;
    const k = Math.max(1, Math.ceil((after.getTime() + 1 - created.getTime()) / stepMs));
    return new Date(created.getTime() + k * stepMs);
  }
  if (s.kind === "custom") {
    // custom：锚点 = 创建日在**任务时区**的墙钟日（旧实现取主机本地 getFullYear/getMonth/getDate，
    // 任务时区与主机不同且 everyDays>1 时会把整条相位平移一天）。
    const { h, m } = parseHHmm(s.time);
    const wall = new Intl.DateTimeFormat("en-CA", {
      timeZone: def.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(created);
    const part = (type: string): number => Number(wall.find((p) => p.type === type)?.value ?? "0");
    // 锚点用**墙钟纪元**（Date.UTC）而不是 UTC instant：zonedDate 已经把墙钟换算成 instant，
    // 再减一次 tzOffsetMs 会把相位平移一个时区偏移（悉尼/东京 everyDays>1 落到前一天）。
    // 步进也走墙钟日序，DST 由 zonedDate 每次重新解析。
    const anchorWall = Date.UTC(part("year"), part("month") - 1, part("day"), h, m);
    // 以 24h 步进近似找首个 > after 的天序，再按 tz 墙钟重建（跨月由 Date.UTC 归一化）
    const dayMs = s.everyDays * 24 * 60 * 60 * 1000;
    const k = Math.max(0, Math.ceil((after.getTime() + 1 - anchorWall) / dayMs));
    for (let i = Math.max(0, k - 1); i < k + 2; i++) {
      const base = new Date(anchorWall + i * dayMs);
      const y = base.getUTCFullYear();
      const mo = base.getUTCMonth();
      const d = base.getUTCDate();
      const cand = zonedDate(def.timeZone, y, mo, d, h, m);
      if (cand.getTime() > after.getTime()) return cand;
    }
    return null;
  }
  const pattern = cronPatternFor(def);
  if (pattern === "") return null;
  const cron = new Cron(pattern, { timezone: def.timeZone });
  return cron.nextRun(after) ?? null;
}

/** 回看窗口内枚举错过触发（strictly after startExclusive，≤ endInclusive）。
 *  超过 MAX_MISSED_ENUM 时保留**最近**的 500 条（旧实现保留最早 500 条 ⇒ 启动 tick 只处理到
 *  第 500 条，下一分钟常规 tick 把剩余里最近的一条当 triggered 真跑：skip 档仍会跑、latest 档跑两次）。
 *  `stats` 回填被舍弃的前缀条数与其后第一条 due（用于折一条聚合账，审计仍可查）。 */
export function occurrencesBetween(
  def: AutomationDefinition,
  startExclusive: Date,
  endInclusive: Date,
  stats?: { dropped: number; droppedBefore: Date | null; truncated: boolean },
): Date[] {
  const out: Date[] = [];
  let cur = startExclusive;
  let seen = 0;
  let dropped = 0;
  let droppedBefore: Date | null = null;
  for (;;) {
    const next = nextOccurrence(def, cur);
    if (!next || next.getTime() > endInclusive.getTime()) break;
    if (next.getTime() <= cur.getTime()) break; // 防御：不前进即断（避免死循环）
    seen += 1;
    if (out.length >= MAX_MISSED_ENUM) {
      dropped += 1;
      if (droppedBefore === null) droppedBefore = out[0] ?? next;
      out.push(next);
      // 摊销裁剪：只保留最近 500 条，避免长停机时数组无限增长。
      if (out.length >= MAX_MISSED_ENUM * 2) out.splice(0, out.length - MAX_MISSED_ENUM);
    } else {
      out.push(next);
    }
    cur = next;
  }
  if (stats) {
    stats.dropped = dropped;
    stats.droppedBefore = droppedBefore;
    stats.truncated = dropped > 0;
  }
  return dropped > 0 ? out.slice(-MAX_MISSED_ENUM) : out;
}

/** 会话标题时刻（任务时区墙钟 "YYYY-MM-DD HH:mm"）。 */
export function formatLocal(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return parts;
}

// ---- 运行摘要（summarizeRun：纯投影，零新 LLM 调用，§12.2.4）----

export interface RunSummary {
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
  toolStats: Record<string, number>;
}

/** 从会话事件流提取投影摘要：最后 assistant_message（截断 280）+ tool_stats + usage。 */
export function summarizeRun(events: AgentEvent[]): RunSummary {
  let lastText = "（无文本输出）";
  const toolStats: Record<string, number> = {};
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (const e of events) {
    if (e.type === "assistant_message") lastText = e.content;
    else if (e.type === "tool_call") toolStats[e.name] = (toolStats[e.name] ?? 0) + 1;
    else if (e.type === "usage") {
      usage.inputTokens += e.inputTokens;
      usage.outputTokens += e.outputTokens;
    }
  }
  const summary = lastText.length > 280 ? lastText.slice(0, 280) + "…" : lastText;
  return { summary, usage, toolStats };
}

/** 完成回写的**文字**不在 main 侧拼：产品卡片一律出自渲染层事件投影（见 renderer/app.js 的 eventLabel，
 *  与 #48 对 securityReportCardPayload 的裁决同口径）。此处曾有一份 automationCompletedCardPayload，
 *  全仓零调用者——留着就是「能力已发货、产品路径绕过它」的下一颗雷，故删。 */

// ---- 触发执行（触发 = 全新会话；executor 注入 = 真实代码路径 handleAgentRun 系）----

/** 档位别名从唯一事实源来（此处曾是一份手抄字面 union：加一档时没人被编译器叫住）。 */
export type TriggerMode = PermissionMode;
export interface TriggerExecutorArgs {
  sessionId: string;
  message: string;
  mode: TriggerMode;
  signal: AbortSignal;
  workspace?: string;
  logPath?: string;
}
export type TriggerExecutor = (args: TriggerExecutorArgs) => Promise<{ ok: boolean; error?: string }>;

export interface SchedulerDeps {
  /** app 数据目录（automations.json + automations-journal.jsonl）。 */
  dataDir: string;
  sessionsDir: string;
  workspace: string;
  /** 假时钟注入（验收禁真实 sleep）；缺省 Date.now。 */
  clock?: () => number;
  /** 并发上限（settings.scheduleConcurrencyCap）；缺省 2。 */
  getCap?: () => number;
  /** 仅桌面宿主启用本地闲时队列；每次启动任务前检查真实 Agent 活动。 */
  isAgentBusy?: () => boolean;
  isIdleWorkspaceAvailable?: (workspace: string) => boolean;
  runTimeoutMs?: number;
  settlesWithinMs?: number;
  /** 启动抖动（缺省随机 1-3min；验收注入 () => 0）。 */
  jitterMs?: () => number;
  /** 触发抖动的随机源（缺省 Math.random；验收注入固定值得确定性延迟）。 */
  jitterRand?: () => number;
  /** 主时间线落流出口（当前会话 append + UI 推送；缺省 = 只进 journal）。 */
  emitTimeline?: (e: AgentEvent) => Promise<void>;
  /** 触发执行器（真实代码路径注入）；缺省 fail-closed 拒绝触发。 */
  runSession?: TriggerExecutor;
  onWarn?: (msg: string) => void;
}

export type RunState = "queued" | "running";
export type HistoryState = RunState | "succeeded" | "failed" | "skipped" | "cancelled";
/** 运行历史六态（§12.1 运行历史；cancelled 为保留态：V1 无取消入口）。 */
export const HISTORY_STATES: readonly HistoryState[] = ["queued", "running", "succeeded", "failed", "skipped", "cancelled"];
/** 面板筛选值 = 六态 + 「全部」这一伪态（渲染层那份同名清单由 tests 逐字对表锁住）。 */
export const HISTORY_FILTERS = ["all", ...HISTORY_STATES] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

/** 跨进程输入的筛选值归一（IPC 传什么是外部面）：认不出的值一律按「全部」，
 *  绝不拿它去筛——未知值当某个具体状态用 = 给用户一片假空记录，假空比填空更坏。 */
export function normalizeHistoryFilter(raw: unknown): HistoryFilter {
  return typeof raw === "string" && (HISTORY_FILTERS as readonly string[]).includes(raw)
    ? (raw as HistoryFilter)
    : "all";
}

export interface HistoryEntry {
  task_id: string;
  task_name: string;
  occurrence_key: string;
  due_at: string;
  decision: Decision;
  reason?: string;
  session_id?: string;
  state: HistoryState;
  at: string;
}

export interface ScheduleSnapshot {
  tasks: AutomationDefinition[];
  history: HistoryEntry[];
  running: number;
  queued: number;
  cap: number;
  /** 启动补跑判定是否已执行（抖动期内 false）。 */
  startupDone: boolean;
  /** task_id → 时区注记：只有该任务的时区与本机不同（或声明值非法）时才有键。
   *  单独一张表而不是塞进 task：定义对象要能原样回传给严格校验（未知字段会被整条拒）。 */
  tzNotes: Record<string, string>;
  /** 装载期警告（automations.json 损坏 / 坏条目被跳过 / journal 坏行）。
   *  桌面端没有控制台可看：装载失败若只 `console.warn`，用户只会看到「还没有定时任务」。 */
  warnings: string[];
  /** 任务定义文件损坏（读不了）：写路径会拒绝覆盖。与「坏条目被跳过」不同，后者仍可写。 */
  definitionsCorrupt: boolean;
}

/** 时区注记（纯函数，唯一实现；措辞与偏移都取自 automations 的那份 helper，不另写一遍）。 */
export function scheduleTimeZoneNotes(
  tasks: readonly { id: string; timeZone?: string }[],
  sysTz: string,
  now: Date,
): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const t of tasks) {
    const tz = typeof t.timeZone === "string" ? t.timeZone.trim() : "";
    if (tz === "") continue;
    let norm = "";
    try { norm = normalizeTimeZone(tz); } catch { norm = ""; }
    if (norm === "") {
      notes[t.id] = "声明的时区「" + tz + "」本机不认，按 " + sysTz + " 计时";
    } else if (norm !== sysTz) {
      notes[t.id] = "规则按 " + tz + "（" + timeZoneOffsetLabel(tz, now) + "）计时，本机 " + sysTz;
    }
  }
  return notes;
}

interface Inflight {
  taskId: string;
  taskName: string;
  sessionId: string;
  state: RunState;
  dueAt: Date;
}

export interface TickReport {
  at: string;
  startup: boolean;
  considered: number;
  triggered: number;
  catchup: number;
  skipped: Record<string, number>;
  duplicates: number;
  decisions: { task_id: string; occurrence_key: string; decision: Decision; reason?: string }[];
}

/** skipped 原因的中文标签不在这里：见 renderer/projections.skipReasonLabel（唯一实现）。 */

/** 调度器：shell 生命周期 = app 生命周期（关闭 app 即停，§12.3.1）。 */
export class Scheduler {
  private tasks: AutomationDefinition[] = [];
  private journalKeys = new Set<string>();
  /** D7（审查 P2）：运行期 journal 追加计数——每 1000 条触发一次保留上限检查。 */
  private journalAppendsSinceCompact = 0;
  private journalByTask = new Map<string, JournalEntry[]>();
  /** P2-6（审查）：occurrence_key → session_id 反查表（snapshot 逐条查会话 id 由 O(n²) 降 O(1)）。 */
  private sessionIdByKey = new Map<string, string>();
  private inflight = new Map<string, Inflight>();
  private completions = new Map<string, { status: "succeeded" | "failed"; reason?: string }>();
  // H3-P2（审查 D-4）：会话终态缓存（(size:mtime) 签名失效；有界 512 条，LRU 简化为淘汰首个）
  private termCache = new Map<string, { sig: string; state: HistoryState; reason?: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private jitterTimer: ReturnType<typeof setTimeout> | null = null;
  private firstTickDone = false;
  private started = false;
  /** 装载期的坏档 / 坏行（快照上屏；桌面控制台无人可见）。 */
  private definitionsWarnings: string[] = [];
  private definitionsCorrupt = false;
  private journalWarnings: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private tickMutex: Promise<void> = Promise.resolve();
  // tick 与 run_now 共用准入锁；覆盖检查到 queued 入表，不能跨 IO 留空位。
  private admissionMutex: Promise<void> = Promise.resolve();
  private readonly clock: () => number;
  private readonly runTimeoutMs: number;
  private readonly settlesWithinMs: number;
  private readonly jitterMs: () => number;
  private readonly jitterRand: () => number;
  /** 抖动等待中的 occurrence 键（防同一拍被后续 tick 双进管线；补发路径不受它管）。 */
  private jitterPending = new Set<string>();
  /** BufferOne 缓存（任务 id → 最新一拍）：帽满时记账 skipped(buffered)，本任务收束后补发。
   *  内存态——重启丢缓存（拍已被 skip 账推进水位，重启后不会双跑，与 skip 同价）。 */
  private buffered = new Map<string, { key: string; dueAt: Date; kind: "triggered" | "catchup" }>();
  readonly definitionsPath: string;
  readonly journalPath: string;
  private readonly idleTasksPath: string;
  private idleRun: { id: string; controller: AbortController | null } | null = null;
  /** occurrence_key → session_id 的旁路索引：journal 条目在 spawn **前**写（崩溃窗口不双跑），
   *  此时 session 还不存在 ⇒ 条目天然没有 session_id。旧实现只把 session_id 写进内存表，
   *  重启后所有成功触发都被投影成 failed/interrupted。 */
  readonly sessionIndexPath: string;
  private sessionIndexChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SchedulerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.settlesWithinMs = deps.settlesWithinMs ?? DEFAULT_SETTLES_WITHIN_MS;
    this.jitterMs = deps.jitterMs ?? defaultJitterMs;
    this.jitterRand = deps.jitterRand ?? Math.random;
    this.definitionsPath = join(deps.dataDir, "automations.json");
    this.journalPath = join(deps.dataDir, "automations-journal.jsonl");
    this.idleTasksPath = join(deps.dataDir, "idle-tasks.json");
    this.sessionIndexPath = join(deps.dataDir, "automation-sessions.json");
  }

  private warn(msg: string): void {
    this.deps.onWarn?.(msg);
  }

  private get cap(): number {
    const c = this.deps.getCap?.() ?? DEFAULT_CONCURRENCY_CAP;
    return Number.isInteger(c) && c >= 1 && c <= 8 ? c : DEFAULT_CONCURRENCY_CAP;
  }

  /** 启动：装载双轨 → 启动抖动后首个 tick（startup 补跑判定）→ 1min tick 常驻。 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // stop→start 同进程重启必须重新走启动判定语义：firstTickDone 残留会让抖动期内的
    // interval/手动 tick 以常规路真跑错过的 occurrence——catchUp=skip 的任务被违背
    // 「对齐不补跑」的属主意图（start 前半段全是 await，复位必须在本行、装载之前）。
    this.firstTickDone = false;
    const loaded = await loadAutomationsFile(this.definitionsPath);
    this.tasks = loaded.tasks;
    this.definitionsWarnings = loaded.warnings;
    this.definitionsCorrupt = loaded.corrupt;
    for (const w of loaded.warnings) this.warn("[scheduler] " + w);
    const j = await readJournalFile(this.journalPath);
    this.ingestJournal(j.entries);
    await this.loadSessionIndex();
    this.journalWarnings = j.warnings;
    for (const w of j.warnings) this.warn("[scheduler] " + w);
    // D7（审查 P2）：启动时对 journal 做保留上限收敛（超帽截到 KEEP 条，原子替换）。
    const kept = await compactJournalIfLarge(this.journalPath, (keep) => this.rebuildJournalMemory(keep)).catch(() => -1);
    if (kept >= 0) this.warn("[scheduler] journal 保留收敛完成（当前 " + String(kept) + " 条）");
    this.journalAppendsSinceCompact = 0;
    const jitter = this.jitterMs();
    this.jitterTimer = setTimeout(() => {
      this.tickGuarded({ startup: true });
    }, jitter);
    this.timer = setInterval(() => {
      this.tickGuarded();
    }, TICK_MS);
  }

  /** P1（审查）：常驻路径的 tick 拒绝必须就地捕获——journal/会话落盘 IO 失败（磁盘满/数据目录
   *  被清/唤醒后路径异常）原样上抛会成为 unhandled rejection，Node≥15 默认 throw 模式下崩掉主进程。
   *  手动 tick（验收/单测 await）仍保留原拒绝语义，不受本护栏影响。 */
  private tickGuarded(opts: { startup?: boolean } = {}): void {
    this.tick(opts).catch((err: unknown) =>
      this.warn("[scheduler] tick 异常（已捕获，不影响下一 tick）：" + (err instanceof Error ? err.message : String(err))),
    );
  }

  /** 停止（app 关闭即停；不中断已 inflight 的执行——进程随之退出）。 */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.jitterTimer) clearTimeout(this.jitterTimer);
    this.timer = null;
    this.jitterTimer = null;
    this.started = false;
  }

  /** 只读运行态（M4 路线图）：serve 接线的判卷用「start 后 true、stop 后 false」钉住启停。 */
  get running(): boolean {
    return this.started;
  }

  private ingestJournal(entries: JournalEntry[]): void {
    for (const e of entries) this.addJournalEntry(e);
  }

  /** 读旁路索引（坏文件 = 空表 + 警告；历史仍可按 journal 的 session_id 读）。 */
  private async loadSessionIndex(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.sessionIndexPath, "utf8")) as unknown;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
      for (const [key, sid] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof sid === "string" && sid !== "") this.sessionIdByKey.set(key, sid);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.warn("[scheduler] 会话索引读取失败（按空表继续）：" + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  /** 建会话后立刻落索引（串行链 + 原子写；失败只警告，不把已触发的 run 反签成失败）。
   *  写前重读磁盘并合并：同根多实例各自持有旧表，整表回写会抹掉对方刚记的 occurrence。 */
  private rememberSessionId(key: string, sessionId: string): Promise<void> {
    this.sessionIdByKey.set(key, sessionId);
    const run = async (): Promise<void> => {
      let disk: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(await readFile(this.sessionIndexPath, "utf8")) as unknown;
        if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) disk = raw as Record<string, unknown>;
      } catch { /* 不存在/坏了：按空表起步，下面写完整快照 */ }
      const merged = { ...disk, ...Object.fromEntries(this.sessionIdByKey) };
      await writeFileAtomic(this.sessionIndexPath, JSON.stringify(merged, null, 0));
    };
    const write = this.sessionIndexChain.then(run, run);
    this.sessionIndexChain = write.catch(() => undefined);
    return write.catch((err: unknown) => {
      this.warn("[scheduler] 会话索引写入失败：" + (err instanceof Error ? err.message : String(err)));
    });
  }

  /** 单条入账（内存表 upsert）：journalKeys / journalByTask / sessionIdByKey 三表同步。
   *  P2-6（审查）：sessionIdByKey 同 key 以**最新**一条为准（原 findSessionIdByKey 取 journalByTask
   *  迭代序首个带 session_id 的条目；occurrence_key 全局唯一，二者等价）。 */
  private addJournalEntry(entry: JournalEntry): void {
    this.journalKeys.add(entry.occurrence_key);
    const list = this.journalByTask.get(entry.task_id) ?? [];
    list.push(entry);
    this.journalByTask.set(entry.task_id, list);
    if (entry.session_id !== undefined) this.sessionIdByKey.set(entry.occurrence_key, entry.session_id);
  }

  /** P1-9（审查）：用保留条目回灌内存三表（先 clear 再填）——与磁盘收敛同链执行。 */
  private rebuildJournalMemory(entries: JournalEntry[]): void {
    // 旁路索引不随 journal 收敛丢失：journal 没有 session_id（spawn 前写账），索引才有。
    const sidecar = new Map(this.sessionIdByKey);
    this.journalKeys.clear();
    this.journalByTask.clear();
    this.sessionIdByKey.clear();
    for (const e of entries) this.addJournalEntry(e);
    for (const [key, sid] of sidecar) {
      if (this.journalKeys.has(key) || this.inflight.has(key)) this.sessionIdByKey.set(key, sid);
    }
  }

  /** 手动 tick（验收注入；生产由 interval 驱动）。startup=true = 启动 tick（补跑闸生效）。 */
  async tick(opts: { startup?: boolean; now?: number } = {}): Promise<TickReport> {
    const run = async (): Promise<TickReport> => {
      const nowMs = opts.now ?? this.clock();
      const now = new Date(nowMs);
      const startup = opts.startup === true;
      const report: TickReport = {
        at: now.toISOString(), startup, considered: 0, triggered: 0, catchup: 0,
        skipped: {}, duplicates: 0, decisions: [],
      };
      if (!this.firstTickDone && !startup) {
        // 抖动期内 interval tick 先到：跳过（首个判定必须走启动补跑语义）
        return report;
      }
      this.firstTickDone = true;
      // 每拍先对齐磁盘 journal：同根多实例（桌面 app + cairn --serve）各自的内存表会滞后。
      await this.refreshJournalFromDisk();
      for (const def of this.tasks) {
        if (!def.enabled) continue;
        report.considered++;
        if (startup) {
          await this.catchupGate(def, now, report);
        } else {
          const lastDecided = this.lastDecidedAt(def);
          const dueStats = { dropped: 0, droppedBefore: null as Date | null, truncated: false };
          const dueList = occurrencesBetween(def, lastDecided, now, dueStats);
          if (dueStats.dropped > 0 && dueStats.droppedBefore !== null) {
            await this.decideSkip(def, dueStats.droppedBefore, "too-old", report, "+fold" + String(dueStats.dropped));
          }
          // D6（审查 P2）：运行期错过的多个 occurrence 全部补记账（旧实现只取最后一个进管线，
          // 中间错过的既不漏账可查）。审查 S2-11（任务 2.4）补上限：枚举帽是 500，笔记本合盖
          // 数周后醒来的第一个 tick 会逐条写 500 行 skipped 账 + 500 次投影通知（启动路径有
          // catchupGate 的 20 条上限，这条运行期路径没有）。口径与启动侧对齐：最近 20 条逐条，
          // 其余折成**一条**聚合账（key 带 +foldN 后缀，不与真实 occurrence 撞键，去重语义不变，
          // due_at 取被折叠区间最早一条 = 时间范围仍可查）。启动补跑语义不动。
          const head = dueList.slice(0, -1);
          const detail = head.slice(-RUNTIME_SKIP_DETAIL);
          const folded = head.length - detail.length;
          if (folded > 0) {
            await this.decideSkip(def, head[0], "too-old", report, "+fold" + String(folded));
          }
          for (const occ of detail) {
            await this.decideSkip(def, occ, "too-old", report);
          }
          const due = dueList[dueList.length - 1];
          if (due) await this.pipeline(def, due, "triggered", report, { jitter: true });
        }
      }
      await this.dispatchIdleTask().catch((err: unknown) => this.warn("[scheduler] " + String(err)));
      return report;
    };
    const next = this.tickMutex.then(run, run);
    this.tickMutex = next.then(() => undefined, () => undefined);
    return next;
  }

  /** 最近一次已决 occurrence（任何 decision 都推进水位，跳过不重试）；无账 = 创建时刻。 */
  private lastDecidedAt(def: AutomationDefinition): Date {
    const list = this.journalByTask.get(def.id) ?? [];
    let maxMs = new Date(def.createdAt).getTime();
    for (const e of list) {
      const t = Date.parse(e.due_at);
      if (!Number.isNaN(t) && t > maxMs) maxMs = t;
    }
    return new Date(maxMs);
  }

  /** 补跑闸（仅启动 tick）：回看 7 天——latest 取最近一次错过进管线、更旧记 skipped(too-old)；skip 档直接对齐。 */
  private async catchupGate(def: AutomationDefinition, now: Date, report: TickReport): Promise<void> {
    const lastDecided = this.lastDecidedAt(def);
    const windowStart = new Date(now.getTime() - CATCHUP_WINDOW_MS);
    const from = lastDecided.getTime() > windowStart.getTime() ? lastDecided : windowStart;
    const missedStats = { dropped: 0, droppedBefore: null as Date | null, truncated: false };
    const missed = occurrencesBetween(def, from, now, missedStats);
    if (missed.length === 0) return;
    // 被枚举帽舍弃的最旧前缀折一条聚合账（审计可查；键带 +foldN 不与真实 occurrence 撞）。
    if (missedStats.dropped > 0 && missedStats.droppedBefore !== null) {
      await this.decideSkip(def, missedStats.droppedBefore, "too-old", report, "+fold" + String(missedStats.dropped));
    }
    const latest = missed[missed.length - 1]!;
    const older = missed.slice(0, -1);
    for (const occ of older) {
      await this.decideSkip(def, occ, "too-old", report);
    }
    if (def.catchUp === "latest") {
      await this.pipeline(def, latest, "catchup", report);
    } else {
      await this.decideSkip(def, latest, "catch-up-skip", report); // skip 档：对齐 nextRunAt（不补跑）
    }
  }

  /** 准入管线（顺序短路；dedup → 并发闸 → 重叠闸 → journal + spawn）。
   *  opts.jitter：调度触发路径传 true——任务声明了 jitterSec 时，拍在 dueAt 后随机延迟
   *  0..jitter 再进准入（防整点共振）；run_now 手动触发不传 = 永不抖（用户点了就该跑）。 */
  private async pipeline(
    def: AutomationDefinition,
    dueAt: Date,
    kind: "triggered" | "catchup",
    report: TickReport,
    opts: { jitter?: boolean } = {},
  ): Promise<void> {
    if (opts.jitter === true) {
      const jitterMs = (def.jitterSec ?? 0) * 1000;
      if (jitterMs > 0) {
        const key = occurrenceKeyOf(def.id, dueAt);
        if (this.jitterPending.has(key)) return; // 抖动等待中：后续 tick 不再重复排队
        this.jitterPending.add(key);
        const delay = Math.floor(this.jitterRand() * jitterMs);
        const timer = setTimeout(() => {
          this.jitterPending.delete(key);
          void this.admitAfterJitter(def, dueAt, kind).catch((err: unknown) =>
            this.warn("[scheduler] 抖动后补准失败: " + (err instanceof Error ? err.message : String(err))));
        }, delay);
        (timer as { unref?: () => void }).unref?.();
        return;
      }
    }
    // 刷新不足以关掉两个进程同时决定同一拍的窗口，准入共用同一个磁盘锁。
    const locked = await this.withAdmission(() => this.admitOccurrence(def, dueAt, kind, report));
    if (locked === false) report.duplicates += 1;
  }

  /** 抖动到点后的补准入：抖动期已过 tick 的报告窗口，判定只走持久面（journal + 时间线）。 */
  private async admitAfterJitter(def: AutomationDefinition, dueAt: Date, kind: "triggered" | "catchup"): Promise<void> {
    const report: TickReport = { at: "", startup: false, considered: 0, triggered: 0, catchup: 0, skipped: {}, duplicates: 0, decisions: [] };
    const locked = await this.withAdmission(() => this.admitOccurrence(def, dueAt, kind, report));
    if (locked === false) this.warn(`[scheduler] 抖动后准入口发现重复拍（已被别处触发）: ${def.name}`);
  }

  private withAdmission<T>(fn: () => Promise<T>): Promise<T | false> {
    const run = () => this.withCrossProcessLock(fn);
    const next = this.admissionMutex.then(run, run);
    this.admissionMutex = next.then(() => undefined, () => undefined);
    return next;
  }

  /** 跨进程准入锁。活着或无法确认的持有者都让路。 */
  private async withCrossProcessLock<T>(fn: () => Promise<T>): Promise<T | false> {
    const lockPath = join(this.deps.dataDir, "automations.lock");
    await mkdir(this.deps.dataDir, { recursive: true });
    let handle = await acquireSchedulerLock(lockPath);
    if (handle === null && await schedulerLockOwner(lockPath) === "dead" && await recoverSchedulerLock(lockPath)) {
      handle = await acquireSchedulerLock(lockPath);
    }
    if (handle === null) return false;
    try {
      return await fn();
    } finally {
      await releaseSchedulerLock(lockPath, handle);
    }
  }

  /** 把磁盘上（别的进程刚写的）新 journal 条目并入内存去重表。 */
  private async refreshJournalFromDisk(): Promise<void> {
    const j = await readJournalFile(this.journalPath).catch(() => null);
    if (j === null) return;
    for (const e of j.entries) {
      if (!this.journalKeys.has(e.occurrence_key)) this.addJournalEntry(e);
    }
  }

  /** 仅在准入锁内调用；执行队列不持锁，queued + running 仍共同占用 cap。
   *  keyOverride：BufferOne 补发路径用（原键已被 skipped(buffered) 账占用，去重表里有它——
   *  补发换新键 `<原键>#b`，既过得了去重，又能在历史里看出它是哪一拍的补发）。 */
  private async admitOccurrence(
    def: AutomationDefinition,
    dueAt: Date,
    kind: "triggered" | "catchup",
    report: TickReport,
    keyOverride?: string,
  ): Promise<void> {
    // 跨进程去重：内存 journalKeys 只含本实例启动时装载的条目；桌面 app 与 `cairn --serve`
    // 同根时，对方刚写的 occurrence 本实例看不见 ⇒ 同一 occurrence 双触发。
    await this.refreshJournalFromDisk();
    const key = keyOverride ?? occurrenceKeyOf(def.id, dueAt);
    if (this.journalKeys.has(key)) {
      report.duplicates++;
      return;
    }
    // ②并发闸：同时运行的定时会话 ≤ cap（可配；与 worker 并发上限独立计数）
    if (this.inflight.size >= this.cap) {
      await this.decideSkip(def, dueAt, "concurrency-cap", report);
      return;
    }
    // ③重叠/并发闸（per-automation 帽，2026-11-10）：同任务在飞数 < maxConcurrent（缺省 1
    // = 旧重叠闸逐字同形）。帽满按 overlap 策略：skip 丢拍（现状）；bufferOne 缓存最新一拍，
    // 本任务收束后补发（补发键 <key>#b，不与原键的去重账相撞）。
    {
      const perTaskCap = Math.max(1, Math.floor(def.maxConcurrent ?? 1));
      let perTask = 0;
      for (const f of this.inflight.values()) if (f.taskId === def.id) perTask++;
      if (perTask >= perTaskCap) {
        if (def.overlap === "bufferOne") {
          this.buffered.set(def.id, { key, dueAt, kind });
          await this.decideSkip(def, dueAt, "buffered", report);
        } else {
          await this.decideSkip(def, dueAt, "overlap", report);
        }
        return;
      }
    }
    // ④通过 → journal 落账（spawn 前写账 = 崩溃窗口不双跑）→ 建会话 → 入执行队列
    const decision: Decision = kind === "catchup" ? "catchup" : "triggered";
    const entry: JournalEntry = {
      task_id: def.id,
      occurrence_key: key,
      due_at: dueAt.toISOString(),
      decision,
      at: new Date(this.clock()).toISOString(),
    };
    this.journalKeys.add(key);
    this.pushJournalEntry(entry);
    await appendJournalEntry(this.journalPath, entry);
    if (kind === "catchup") report.catchup++;
    else report.triggered++;
    report.decisions.push({ task_id: def.id, occurrence_key: key, decision });
    const sessionId = await this.createOccurrenceSession(def, dueAt);
    await this.rememberSessionId(key, sessionId);
    await this.writeOccurrenceMeta(def, sessionId);
    this.inflight.set(key, { taskId: def.id, taskName: def.name, sessionId, state: "queued", dueAt });
    await this.emitTimelineSafe({
      type: "automation_triggered",
      automation_id: def.id,
      task_name: def.name,
      occurrence_key: key,
      due_at: dueAt.toISOString(),
      session_id: sessionId,
      ...(kind === "catchup" ? { catchup: true } : {}),
      ts: this.clock(),
    } as AgentEvent);
    this.enqueue(def, key, dueAt, sessionId);
  }

  private createOccurrenceSession(
    def: Pick<AutomationDefinition, "name" | "timeZone">, dueAt: Date, sessionsDir = this.deps.sessionsDir,
  ): Promise<string> {
    const title = def.name + " · " + formatLocal(dueAt, def.timeZone);
    return createSession(sessionsDir, isValidSessionName(title) ? title : def.name);
  }

  private async writeOccurrenceMeta(def: Pick<AutomationDefinition, "id" | "name">, sessionId: string, sessionsDir = this.deps.sessionsDir): Promise<void> {
    await createEventLog(pathOf(sessionsDir, sessionId)).append({
      type: "session_meta",
      origin: "scheduled",
      automation_id: def.id,
      automation_name: def.name,
    });
  }

  private isIdleWorkspaceAvailable(workspace: string): boolean {
    return this.deps.isIdleWorkspaceAvailable?.(workspace) ?? workspace === this.deps.workspace;
  }

  private idleWorkspace(task: StoredIdleTask): string {
    return task.workspace ?? this.deps.workspace;
  }

  private idleSessionsDir(workspace: string): string {
    return workspace === this.deps.workspace ? this.deps.sessionsDir : join(workspace, ".agent", "sessions");
  }

  async idleTaskSnapshot(workspace = this.deps.workspace): Promise<IdleTaskSnapshot> {
    if (!this.isIdleWorkspaceAvailable(workspace)) throw new Error("闲时任务工作区不可用");
    const tasks = await this.readIdleTaskState();
    return {
      workspace,
      tasks: tasks.filter((task) => this.idleWorkspace(task) === workspace)
        .map(({ workspace: _workspace, runPid: _runPid, ...task }) => task),
    };
  }

  async enqueueIdleTask(input: unknown, workspace = this.deps.workspace): Promise<IdleTaskResult> {
    if (!this.isIdleWorkspaceAvailable(workspace)) return { ok: false, error: "闲时任务工作区不可用" };
    const result = createIdleTask(input, new Date(this.clock()));
    if ("error" in result) return { ok: false, error: result.error };
    return this.writeIdleChange(async (tasks) => {
      await saveIdleTasks(this.idleTasksPath, [...tasks, { ...result.task, workspace }]);
      return { ok: true };
    });
  }

  async updateIdleTask(id: unknown, action: unknown, workspace = this.deps.workspace): Promise<IdleTaskResult> {
    if (!this.isIdleWorkspaceAvailable(workspace)) return { ok: false, error: "闲时任务工作区不可用" };
    return this.writeIdleChange(async (tasks) => {
      const task = tasks.find((item) => item.id === id && this.idleWorkspace(item) === workspace);
      if (!task) return { ok: false, error: "闲时任务不存在" };
      const live = this.idleRun;
      if (action === "cancel" && task.status === "running" && live !== null && live.id === id && live.controller !== null) {
        live.controller.abort();
        return { ok: true };
      }
      // running 但控制器已收（runOccurrence 终态回写前的窗口）：这一刀取消改变不了结果，
      // 如实说，不谎报 ok、也不给一句与本任务无关的「当前状态不支持此操作」。
      if (action === "cancel" && task.status === "running" && live?.id === id) {
        return { ok: false, error: "任务刚结束，取消未生效（结果按其真实终态回写）" };
      }
      if (action === "pause" && task.status === "queued") task.status = "paused";
      else if (action === "resume" && task.status === "paused") task.status = "queued";
      else if (action === "cancel" && (task.status === "queued" || task.status === "paused")) task.status = "cancelled";
      else return { ok: false, error: "当前状态不支持此操作" };
      task.updatedAt = new Date(this.clock()).toISOString();
      await saveIdleTasks(this.idleTasksPath, tasks);
      return { ok: true };
    });
  }

  private async writeIdleChange(change: (tasks: StoredIdleTask[]) => Promise<IdleTaskResult>): Promise<IdleTaskResult> {
    if (this.deps.isAgentBusy === undefined) return { ok: false, error: "本地闲时队列未启用" };
    try {
      const result = await this.withAdmission(async () => change(await this.readIdleTaskState()));
      return result === false ? { ok: false, error: "调度器正在处理其他任务，请重试" } : result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async readIdleTaskState(): Promise<StoredIdleTask[]> {
    const tasks = await readIdleTasks(this.idleTasksPath);
    return Promise.all(tasks.map(async (task) => {
      if (task.status !== "running" || this.idleRun?.id === task.id) return task;
      const workspace = this.idleWorkspace(task);
      if (!this.isIdleWorkspaceAvailable(workspace)) return task;
      const terminal = task.sessionId === undefined ? null : await this.terminalOf(task.sessionId, this.idleSessionsDir(workspace));
      if (terminal?.state === "succeeded" || terminal?.state === "failed") {
        const { runPid: _runPid, ...stored } = task;
        return {
          ...stored,
          status: terminal.reason === "cancelled" ? "cancelled" : terminal.state,
          ...(terminal.reason !== undefined && terminal.reason !== "cancelled" ? { error: terminal.reason } : {}),
        };
      }
      if (task.runPid !== undefined && task.runPid !== process.pid && processLiveness(task.runPid) !== "dead") return task;
      const { runPid: _runPid, ...stored } = task;
      return { ...stored, status: "failed", error: "interrupted" };
    }));
  }

  private async dispatchIdleTask(): Promise<void> {
    const isAvailable = () => this.started && this.deps.isAgentBusy?.() === false && this.inflight.size === 0;
    if (this.idleRun !== null || !isAvailable()) return;
    await this.withAdmission(async () => {
      const tasks = await this.readIdleTaskState();
      const task = tasks.find((item) => item.status === "queued" && this.isIdleWorkspaceAvailable(this.idleWorkspace(item)));
      if (task === undefined || this.idleRun !== null || !isAvailable()
        || tasks.some((item) => item.status === "running" && this.isIdleWorkspaceAvailable(this.idleWorkspace(item)))) return;
      const workspace = this.idleWorkspace(task);
      const sessionsDir = this.idleSessionsDir(workspace);
      const now = new Date(this.clock());
      const sessionId = task.sessionId ?? await this.createOccurrenceSession(task, now, sessionsDir);
      if (task.sessionId === undefined) await this.writeOccurrenceMeta(task, sessionId, sessionsDir);
      task.sessionId = sessionId;
      task.status = "running";
      task.runPid = process.pid;
      task.updatedAt = now.toISOString();
      const controller = new AbortController();
      this.idleRun = { id: task.id, controller };
      try {
        await saveIdleTasks(this.idleTasksPath, tasks);
        // 前台可能在磁盘 I/O 期间开始工作。最后一次检查与执行器调用之间没有 await。
        if (!isAvailable() || !this.isIdleWorkspaceAvailable(workspace)) {
          task.status = "queued";
          delete task.runPid;
          await saveIdleTasks(this.idleTasksPath, tasks);
          this.idleRun = null;
          return;
        }
      } catch (err) {
        this.idleRun = null;
        throw err;
      }
      this.chain = this.runOccurrence(task, occurrenceKeyOf(task.id, now), now, sessionId, { controller, workspace })
        .then(async (terminal) => {
          const result = await this.writeIdleChange(async (current) => {
            const row = current.find((item) => item.id === task.id);
            if (row === undefined) return { ok: false, error: "闲时任务不存在" };
            row.status = terminal.reason === "cancelled" ? "cancelled" : terminal.status;
            if (terminal.reason !== undefined && terminal.reason !== "cancelled") row.error = terminal.reason;
            row.updatedAt = new Date(this.clock()).toISOString();
            delete row.runPid;
            await saveIdleTasks(this.idleTasksPath, current);
            return { ok: true };
          });
          if (!result.ok) this.warn("[scheduler] 闲时任务终态仍可从会话恢复：" + (result.error ?? ""));
        })
        .catch((err: unknown) => this.warn("[scheduler] 闲时任务收束失败：" + String(err)))
        .finally(() => { this.idleRun = null; });
    });
  }

  private async decideSkip(def: AutomationDefinition, dueAt: Date, reason: SkipReason, report: TickReport, keySuffix = ""): Promise<void> {
    const key = occurrenceKeyOf(def.id, dueAt) + keySuffix;
    if (this.journalKeys.has(key)) {
      report.duplicates++;
      return;
    }
    const entry: JournalEntry = {
      task_id: def.id,
      occurrence_key: key,
      due_at: dueAt.toISOString(),
      decision: "skipped",
      reason,
      at: new Date(this.clock()).toISOString(),
    };
    this.journalKeys.add(key);
    this.pushJournalEntry(entry);
    await appendJournalEntry(this.journalPath, entry);
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
    report.decisions.push({ task_id: def.id, occurrence_key: key, decision: "skipped", reason });
    await this.emitTimelineSafe({
      type: "automation_skipped",
      automation_id: def.id,
      task_name: def.name,
      occurrence_key: key,
      due_at: dueAt.toISOString(),
      reason,
      ts: this.clock(),
    } as AgentEvent);
  }

  private pushJournalEntry(entry: JournalEntry): void {
    this.addJournalEntry(entry);
    // D7（审查 P2）：运行期增量收敛——每 1000 条触发一次保留上限检查（防 append-only 无界增长）。
    this.journalAppendsSinceCompact++;
    if (this.journalAppendsSinceCompact >= 1_000) {
      this.journalAppendsSinceCompact = 0;
      // P1-9（审查）：收敛后同链重建内存表。**延到微任务**：让本条的 appendJournalEntry 先入
      // journalChain，保证重建读到的磁盘态已含本条（否则内存会丢这一条，journalKeys 去重漏判）。
      queueMicrotask(() => {
        void compactJournalIfLarge(this.journalPath, (kept) => this.rebuildJournalMemory(kept)).catch(() => -1);
      });
    }
  }

  private async emitTimelineSafe(e: AgentEvent): Promise<void> {
    if (!this.deps.emitTimeline) return;
    try {
      await this.deps.emitTimeline(e);
    } catch (err) {
      this.warn("[scheduler] 时间线落流失败（journal 已留账）: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** 执行队列（串行穿过 runSession——主进程 agent 会话态为单例；并发闸按 queued+running 计数）。 */
  private enqueue(def: AutomationDefinition, key: string, dueAt: Date, sessionId: string): void {
    this.chain = this.chain.then(
      async () => { await this.runOccurrence(def, key, dueAt, sessionId); },
      async () => { await this.runOccurrence(def, key, dueAt, sessionId); },
    );
  }

  /** 触发执行（§12.2.4）：全新会话 + unattended fail-closed（会话侧 AskGate）+ 超时双闸 + 完成回写。 */
  private async runOccurrence(
    def: Pick<AutomationDefinition, "id" | "name" | "prompt" | "timeZone" | "permissionTier">,
    key: string, dueAt: Date, sessionId: string, idle?: { controller: AbortController; workspace: string },
  ): Promise<{ status: "succeeded" | "failed"; reason?: string }> {
    const f = this.inflight.get(key);
    if (f) f.state = "running";
    const workspace = idle?.workspace ?? this.deps.workspace;
    const logPath = pathOf(idle === undefined ? this.deps.sessionsDir : this.idleSessionsDir(workspace), sessionId);
    const message =
      def.prompt +
      `\n\n—— 本会话由${idle === undefined ? "定时任务" : "闲时任务"}「${def.name}」在 ${dueAt.toISOString()}（${def.timeZone}）无人值守触发；` +
      `工作区：${workspace}。无人值守下一切审批请求会被自动拒绝（fail-closed），` +
      `写向操作需任务档位允许的自主路径才可执行。`;
    const controller = idle?.controller ?? new AbortController();
    let aborted = false;
    const abortTimer = setTimeout(() => {
      aborted = true;
      controller.abort(); // 闸一：到 runTimeoutMs 先礼送（loop 轮界收束）
    }, this.runTimeoutMs);
    let hardResolve: ((k: "hard") => void) | null = null;
    const hardTimer = setTimeout(() => hardResolve?.("hard"), this.runTimeoutMs + this.settlesWithinMs); // 闸二：二道退出
    let outcome: { ok: boolean; error?: string } | null = null;
    try {
      if (!this.deps.runSession) {
        outcome = { ok: false, error: "调度器未接线执行器（fail-closed）" };
      } else {
        const hard = new Promise<"hard">((resolve) => {
          hardResolve = resolve;
        });
        const exec = this.deps.runSession({
          sessionId, message, mode: tierToMode(def.permissionTier), signal: controller.signal,
          ...(idle === undefined ? {} : { workspace, logPath }),
        });
        const raced = await Promise.race([
          exec.then(
            (v) => ({ kind: "exec" as const, v }),
            (err: unknown) => ({ kind: "exec" as const, v: { ok: false, error: err instanceof Error ? err.message : String(err) } }),
          ),
          hard.then((k) => ({ kind: k, v: null })),
        ]);
        outcome = raced.kind === "exec" ? raced.v : null; // hard = 宿主不响应 abort，二道退出
      }
    } finally {
      clearTimeout(abortTimer);
      clearTimeout(hardTimer);
    }
    const timedOut = aborted || outcome === null;
    if (idle !== undefined && this.idleRun?.controller === idle.controller) {
      this.idleRun.controller = null;
    }
    // 完成回写：从会话事件投影摘要（零新 LLM 调用）；终态事件落会话日志 + 主时间线（完成卡复用 report）
    const cancelled = idle?.controller.signal.aborted === true && !timedOut;
    const status = !timedOut && !cancelled && outcome?.ok === true ? "succeeded" : "failed";
    const reason = timedOut ? "timeout" : cancelled ? "cancelled" : outcome && !outcome.ok ? outcome.error ?? "run_failed" : undefined;
    let events: AgentEvent[] = [];
    try {
      events = await replay(logPath);
    } catch {
      events = [];
    }
    const sum = summarizeRun(events);
    const completed: Extract<AgentEvent, { type: "automation_completed" }> = {
      type: "automation_completed",
      automation_id: def.id,
      task_name: def.name,
      occurrence_key: key,
      session_id: sessionId,
      status,
      ...(reason !== undefined ? { reason } : {}),
      summary: status === "succeeded" ? sum.summary : "[" + (reason ?? "failed") + "] " + sum.summary,
      usage: sum.usage,
      tool_stats: sum.toolStats,
      ts: this.clock(),
    } as Extract<AgentEvent, { type: "automation_completed" }>;
    try {
      await createEventLog(logPath).append(completed);
    } catch (err) {
      this.warn("[scheduler] 终态事件落会话失败: " + (err instanceof Error ? err.message : String(err)));
    }
    if (idle === undefined) await this.emitTimelineSafe(completed);
    // P1-9（审查）：completions 加容量帽（每个 occurrence 一条、永不删 → 无界增长）；淘汰最早插入。
    if (this.completions.size >= COMPLETIONS_MAX) {
      const oldest = this.completions.keys().next().value;
      if (oldest !== undefined) this.completions.delete(oldest);
    }
    this.completions.set(key, { status, ...(reason !== undefined ? { reason } : {}) });
    // P1 空窗竞态修复（2026-11-11 复核判定书）：inflight.delete 原在准入互斥外——并发的
    // runNow/tick 准入在 admitOccurrence 的 await refreshJournalFromDisk 窗口里看到空 inflight，
    // 绕过 per-task 帽被准入（同任务双在飞破 maxConcurrent=1），补发也被再缓存。delete+补发
    // 并入同一互斥段后，外部准入要么看到删除前（正常被闸）、要么看到补发后（正常被闸），
    // 不存在可滑入的空窗。锁未获取（fn 未执行）时删除在锁外补做，不丢。
    const pendingBuffered = this.buffered.get(def.id);
    if (pendingBuffered !== undefined) this.buffered.delete(def.id);
    const fullDef = pendingBuffered !== undefined ? this.tasks.find((t) => t.id === def.id) : undefined;
    const retryKey = pendingBuffered !== undefined ? pendingBuffered.key + "#b" : "";
    const locked = await this.withAdmission(async () => {
      this.inflight.delete(key);
      if (fullDef === undefined || pendingBuffered === undefined) return;
      const retryReport: TickReport = { at: "", startup: false, considered: 0, triggered: 0, catchup: 0, skipped: {}, duplicates: 0, decisions: [] };
      await this.admitOccurrence(fullDef, pendingBuffered.dueAt, pendingBuffered.kind, retryReport, retryKey);
    });
    if (locked === false) {
      this.inflight.delete(key); // 互斥未获取（跨进程锁在别处手中，fn 未执行）：删除不丢
      if (pendingBuffered !== undefined) this.warn(`[scheduler] BufferOne 补发被跨进程去重拦下（别处已触发同一补发键）: ${retryKey}`);
    }
    if (timedOut) {
      this.warn(`[scheduler] 运行超时（runTimeoutMs=${String(this.runTimeoutMs)}ms${aborted ? "，已 abort" : "，settlesWithin 二道退出"}）: ${def.name} ${sessionId}`);
    }
    return { status, ...(reason !== undefined ? { reason } : {}) };
  }

  // ---- 任务定义 CRUD（设置页 / agent 工具共用；name 唯一）----

  list(): AutomationDefinition[] {
    return [...this.tasks];
  }

  /** 创建或更新（按 id）；name 唯一（除自身）。返回校验后的完整定义。 */
  async upsert(raw: unknown, opts: { form?: boolean } = {}): Promise<ValidationResult & { duplicate?: boolean }> {
    const v = validateAutomation(raw, { form: opts.form === true });
    if (!v.ok) return v;
    // 写前重读磁盘任务表：两个实例（桌面 app + `cairn --serve`）各持启动时的旧表，
    // 直接整表回写会静默抹掉对方刚建/改的任务。
    const disk = await loadAutomationsFile(this.definitionsPath).catch(() => null);
    if (disk !== null) {
      this.definitionsWarnings = disk.warnings;
      this.definitionsCorrupt = disk.corrupt;
    }
    if (disk?.corrupt === true) return { ok: false, errors: disk.warnings.length > 0 ? disk.warnings : ["调度任务文件损坏，已拒绝覆盖"] };
    if (disk !== null) this.tasks = disk.tasks;
    const dup = this.tasks.find((t) => t.name === v.value.name && t.id !== v.value.id);
    if (dup) return { ok: false, errors: [`任务名已存在: ${v.value.name}（name 唯一）`] };
    const nowIso = new Date(this.clock()).toISOString();
    const existing = this.tasks.find((t) => t.id === v.value.id);
    const value: AutomationDefinition = existing
      ? { ...v.value, createdAt: existing.createdAt, updatedAt: nowIso }
      : { ...v.value, createdAt: v.value.createdAt || nowIso, updatedAt: nowIso };
    const nextRun = nextOccurrence(value, new Date(this.clock()));
    value.nextRunAt = nextRun ? nextRun.toISOString() : undefined;
    this.tasks = existing ? this.tasks.map((t) => (t.id === value.id ? value : t)) : [...this.tasks, value];
    // 策略翻回 skip / 任务停用 ⇒ 缓存的待补发拍作废（策略不再承诺补发，留着就是幽灵补跑）
    const updatedDef = this.tasks.find((t) => t.id === value.id);
    if (updatedDef !== undefined && (updatedDef.enabled !== true || updatedDef.overlap !== "bufferOne")) {
      this.buffered.delete(value.id);
    }
    await saveAutomationsFile(this.definitionsPath, this.tasks);
    // 写成功 = 盘上已是一份完整合法的任务表；装载期的坏档 / 坏条目警告随之失效。
    this.definitionsWarnings = [];
    this.definitionsCorrupt = false;
    return { ok: true, value };
  }

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    // 同 upsert：先与磁盘合并，别用旧表整表回写抹掉对方的改动。
    const disk = await loadAutomationsFile(this.definitionsPath).catch(() => null);
    if (disk !== null) {
      this.definitionsWarnings = disk.warnings;
      this.definitionsCorrupt = disk.corrupt;
    }
    if (disk?.corrupt === true) return { ok: false, error: disk.warnings[0] ?? "调度任务文件损坏，已拒绝覆盖" };
    if (disk !== null) this.tasks = disk.tasks;
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length === before) return { ok: false, error: "任务不存在: " + id };
    this.buffered.delete(id); // 任务删了，缓存的待补发拍随之作废（没有定义就没有补发的执行体）
    await saveAutomationsFile(this.definitionsPath, this.tasks);
    this.definitionsWarnings = [];
    this.definitionsCorrupt = false;
    return { ok: true };
  }

  /** 手动立即触发（run_now）：走同一准入管线（去重/并发/重叠生效），decision=triggered。 */
  async runNow(id: string): Promise<{ ok: boolean; error?: string }> {
    const def = this.tasks.find((t) => t.id === id);
    if (!def) return { ok: false, error: "任务不存在: " + id };
    const report: TickReport = { at: "", startup: false, considered: 1, triggered: 0, catchup: 0, skipped: {}, duplicates: 0, decisions: [] };
    await this.pipeline(def, new Date(this.clock()), "triggered", report);
    const d = report.decisions[0];
    if (!d) return { ok: false, error: "触发被去重（该 occurrence 已在 journal）" };
    if (d.decision === "triggered") return { ok: true };
    return { ok: false, error: "触发被闸拒绝: " + (d.reason ?? "unknown") };
  }

  /** 面板/状态快照（异步：历史终态跨重启时需读会话文件）。 */
  async snapshot(historyFilter: HistoryFilter = "all"): Promise<ScheduleSnapshot> {
    const now = new Date(this.clock());
    const tasks = this.tasks.map((t) => {
      const next = nextOccurrence(t, now);
      return next ? { ...t, nextRunAt: next.toISOString() } : { ...t, nextRunAt: undefined };
    });
    const history: HistoryEntry[] = [];
    for (const [taskId, entries] of this.journalByTask) {
      const name = this.tasks.find((t) => t.id === taskId)?.name ?? taskId;
      for (const e of entries) {
        if (e.decision === "skipped") {
          history.push({ task_id: taskId, task_name: name, occurrence_key: e.occurrence_key, due_at: e.due_at, decision: e.decision, reason: e.reason, state: "skipped", at: e.at });
          continue;
        }
        const live = this.inflight.get(e.occurrence_key);
        if (live) {
          history.push({ task_id: taskId, task_name: name, occurrence_key: e.occurrence_key, due_at: e.due_at, decision: e.decision, session_id: e.session_id ?? live.sessionId, state: live.state, at: e.at });
          continue;
        }
        const mem = this.completions.get(e.occurrence_key);
        if (mem) {
          const sid = e.session_id ?? this.findSessionIdByKey(e.occurrence_key);
          history.push({ task_id: taskId, task_name: name, occurrence_key: e.occurrence_key, due_at: e.due_at, decision: e.decision, ...(sid ? { session_id: sid } : {}), state: mem.status, ...(mem.reason !== undefined ? { reason: mem.reason } : {}), at: e.at });
          continue;
        }
        // 跨重启：读会话终态（automation_completed）；无终态记录 = interrupted（V1 不自动重试，§12.3.4）
        // H3-P2（审查 D-4）：终态按 (size+mtime) 签名缓存——旧实现每次 getState 都对每条历史全量
        // replay 会话 JSONL，面板轮询下是反复全量读盘；会话文件 append-only，签名不变即终态不变。
        const sid = e.session_id ?? this.findSessionIdByKey(e.occurrence_key);
        let state: HistoryState = "failed";
        let reason: string | undefined = "interrupted（重启后无终态记录；V1 不自动重试，可 run_now 兜底）";
        if (sid) {
          const term = await this.terminalOf(sid);
          if (term) {
            state = term.state;
            reason = term.reason;
          }
        }
        history.push({ task_id: taskId, task_name: name, occurrence_key: e.occurrence_key, due_at: e.due_at, decision: e.decision, ...(sid ? { session_id: sid } : {}), state, ...(reason !== undefined ? { reason } : {}), at: e.at });
      }
    }
    history.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    let running = 0;
    let queued = 0;
    for (const f of this.inflight.values()) {
      if (f.state === "running") running++;
      else queued++;
    }
    return {
      tasks,
      // 排完再筛、且不在这里截条数：渲染层只画前 12 条，若先截 12 再筛，某个状态会整段落在窗口外，
      // 用户读到的是「没有记录」而其实是「没翻到」
      history: Scheduler.filterHistory(history, historyFilter),
      running,
      queued,
      cap: this.cap,
      startupDone: this.firstTickDone,
      tzNotes: scheduleTimeZoneNotes(tasks, systemTimeZone(), now),
      warnings: [...this.definitionsWarnings, ...this.journalWarnings],
      definitionsCorrupt: this.definitionsCorrupt,
    };
  }

  private findSessionIdByKey(key: string): string | undefined {
    // P2-6（审查）：O(1) 反查（旧实现遍历全部任务的全部条目 = snapshot 的 O(n²) 根因）。
    return this.sessionIdByKey.get(key);
  }

  /** H3-P2：会话终态（automation_completed）按文件签名缓存读取。签名 = size:mtimeMs——
   *  会话 JSONL 是 append-only，签名不变则终态不可能变化，免全量 replay。 */
  private async terminalOf(sid: string, sessionsDir = this.deps.sessionsDir): Promise<{ state: HistoryState; reason?: string } | null> {
    const p = pathOf(sessionsDir, sid);
    const st = await stat(p).catch(() => null);
    if (!st) {
      this.termCache.delete(p);
      return null;
    }
    const sig = String(st.size) + ":" + String(st.mtimeMs);
    const hit = this.termCache.get(p);
    if (hit && hit.sig === sig) return { state: hit.state, reason: hit.reason };
    try {
      const events = await replay(p);
      const term = [...events].reverse().find((x): x is Extract<AgentEvent, { type: "automation_completed" }> => x.type === "automation_completed");
      if (!term) {
        this.termCache.delete(p);
        return null;
      }
      const out: { state: HistoryState; reason?: string } = { state: term.status, ...(term.reason !== undefined ? { reason: term.reason } : {}) };
      if (this.termCache.size >= 512) {
        const first = this.termCache.keys().next().value;
        if (first !== undefined) this.termCache.delete(first);
      }
      this.termCache.set(p, { sig, ...out });
      return out;
    } catch {
      return null; /* 会话文件缺失/坏行：保持 failed/interrupted */
    }
  }

  /** 运行历史六态过滤（纯函数面，UI 与验收共用）。 */
  static filterHistory(history: HistoryEntry[], state: HistoryState | "all"): HistoryEntry[] {
    return state === "all" ? history : history.filter((h) => h.state === state);
  }

  /** 运行中/排队任务数（并发闸独立计数的断言面）。 */
  get inflightCount(): number {
    return this.inflight.size;
  }

  /** 执行队列排空（验收等待点：所有已准入 occurrence 的执行收束）。 */
  get whenIdle(): Promise<void> {
    return this.chain;
  }
}

/** catchUp 档位类型再导出（UI 表单用）。 */
export type { AutomationCatchUp };
