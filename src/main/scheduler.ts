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
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Cron } from "croner";
import type { AgentEvent } from "../events";
import { createEventLog, hasEventLogHandle, invalidateEventLogHandle, replay, resolveHandle } from "../events";
import { createSession, isValidSessionName, pathOf } from "./sessions";
import {
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

/** 加载任务定义（迁移容忍：坏文件/坏条目跳过 + 警告，不静默丢整个清单）。 */
export async function loadAutomationsFile(file: string): Promise<{ tasks: AutomationDefinition[]; warnings: string[] }> {
  const warnings: string[] = [];
  let raw: unknown = null;
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return { tasks: [], warnings: warnings.length > 0 ? warnings : ["（无既有文件，按空清单起步）"] };
  }
  const obj = raw as { version?: unknown; tasks?: unknown };
  const list = Array.isArray(obj?.tasks) ? obj.tasks : [];
  const tasks: AutomationDefinition[] = [];
  (list as unknown[]).forEach((t, i) => {
    const v = validateAutomation(t);
    if (v.ok) tasks.push(v.value);
    else warnings.push(`automations.json 第 ${String(i + 1)} 条无效已跳过：${v.errors.join("；")}`);
  });
  return { tasks, warnings };
}

/** 保存任务定义（原子写：tmp + rename，中断自愈；与 settings/permissions 同款）。 */
export async function saveAutomationsFile(file: string, tasks: AutomationDefinition[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const payload: AutomationsFile = { version: 1, tasks };
  const tmp = file + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, file);
  } catch (err) {
    await writeFile(file, JSON.stringify(payload, null, 2), "utf8").catch(() => {}); // rename 失败退直写（不吞数据）
    throw err;
  }
}

// ---- 双轨存储之二：调度日志（journal.jsonl，append-only）----

export type ScheduleDecision = "triggered" | "skipped" | "catchup";
/** skipped 原因（UI hover 映射见 SKIP_REASON_LABELS：too-old=过期 / catch-up-skip=休眠 / overlap=重叠 / concurrency-cap=并发满）。 */
export type SkipReason = "too-old" | "overlap" | "concurrency-cap" | "catch-up-skip";
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
  await onJournalPath(file, async () => {
    // X2：常驻文件句柄直写（与 A1 同族）——裸 appendFile 是 open+write+close 三连（实测 2,220µs/次），
    // journal 是 append-only，复用 events 的 resolveHandle（含 inode 校验 + 有界缓存 + 串行化）。
    // mkdir 只在**首次**（该 path 尚无句柄）时做：本机 mkdir(recursive) 实测 ≈2,126µs/次，是 10k
    // 级 append 的主成本；目录已存在时每次都做会把这条路径钉死在毫秒级。
    if (!hasEventLogHandle(file)) await mkdir(dirname(file), { recursive: true });
    const fh = await resolveHandle(file);
    await fh.write(JSON.stringify(entry) + "\n");
  });
}

// ---- D7（审查 P2）：journal 保留上限——append-only 无界增长使 journalKeys/journalByTask/
// completions 内存单调增长、snapshot 对全部历史逐条投影。超帽收敛到最新 KEEP 条（原子替换）。 ----
const JOURNAL_MAX_ENTRIES = 10_000;
const JOURNAL_KEEP_ENTRIES = 4_000;

export async function compactJournalIfLarge(
  file: string,
  onCompacted?: (kept: JournalEntry[]) => void,
): Promise<number> {
  return await onJournalPath(file, async () => {
    const { entries } = await readJournalFile(file);
    if (entries.length <= JOURNAL_MAX_ENTRIES) return entries.length;
    const keep = entries.slice(-JOURNAL_KEEP_ENTRIES);
    const tmp = file + ".tmp-" + String(process.pid) + "-" + String(Date.now());
    await mkdir(dirname(file), { recursive: true });
    await writeFile(tmp, keep.map((e) => JSON.stringify(e) + "\n").join(""), "utf8");
    await rename(tmp, file);
    // X2（关键）：覆盖写完成后**同链内**显式失效该 path 的常驻句柄——rename 之后缓存句柄仍指向
    // 已被覆盖掉的旧 inode，不失效则后续 appendJournalEntry 复用旧句柄，journal 写入静默丢失。
    // 与 A1 的 inode 校验同一类失效，但这里必须**显式**做（inode 校验只在 spawn 侧自然捕获）。
    await invalidateEventLogHandle(file);
    // P1-9（审查）：磁盘收敛后同步重建内存表——回调在**同链**内执行（不与并发追加交错），由
    // Scheduler 用保留条目回灌 journalKeys/journalByTask/sessionIdByKey（旧实现只截磁盘文件，
    // 内存三表对已截断历史仍单调增长）。
    onCompacted?.(keep);
    return keep.length;
  });
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
      const e = JSON.parse(t) as JournalEntry;
      if (typeof e.task_id === "string" && typeof e.occurrence_key === "string" && typeof e.decision === "string") {
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
    // custom：锚点 = 创建日（tz 墙钟），每 everyDays 一跳
    const { h, m } = parseHHmm(s.time);
    const anchor = zonedDate(def.timeZone, created.getFullYear(), created.getMonth(), created.getDate(), h, m);
    const anchorUtc = anchor.getTime() - tzOffsetMs(def.timeZone, anchor);
    // 以 24h 步进近似找首个 > after 的天序，再按 tz 墙钟重建（跨月由 Date.UTC 归一化）
    const dayMs = s.everyDays * 24 * 60 * 60 * 1000;
    const k = Math.max(0, Math.ceil((after.getTime() + 1 - anchorUtc) / dayMs));
    for (let i = Math.max(0, k - 1); i < k + 2; i++) {
      const base = new Date(anchorUtc + i * dayMs);
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

/** 回看窗口内枚举错过触发（strictly after startExclusive，≤ endInclusive；防御性上限 MAX_MISSED_ENUM）。 */
export function occurrencesBetween(def: AutomationDefinition, startExclusive: Date, endInclusive: Date): Date[] {
  const out: Date[] = [];
  let cur = startExclusive;
  for (let i = 0; i < MAX_MISSED_ENUM; i++) {
    const next = nextOccurrence(def, cur);
    if (!next || next.getTime() > endInclusive.getTime()) break;
    if (next.getTime() <= cur.getTime()) break; // 防御：不前进即断（避免死循环）
    out.push(next);
    cur = next;
  }
  return out;
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

/** 完成卡 payload（复用 report 卡类型，不新增卡片类型，§10.3 纪律）。 */
export function automationCompletedCardPayload(e: Extract<AgentEvent, { type: "automation_completed" }>): Record<string, unknown> {
  const head = e.status === "succeeded" ? "定时任务完成" : "定时任务失败" + (e.reason !== undefined ? "（" + e.reason + "）" : "");
  return {
    type: "report",
    title: head + " · " + e.task_name,
    body: [
      "任务：" + e.task_name + "（" + e.automation_id + "）",
      "触发时刻：" + e.occurrence_key.split(":").slice(1).join(":"),
      "会话：" + e.session_id,
      "usage: " + String(e.usage.inputTokens) + " in / " + String(e.usage.outputTokens) + " out",
      "tool_stats: " + JSON.stringify(e.tool_stats),
      "",
      e.summary,
    ].join("\n"),
  };
}

// ---- 触发执行（触发 = 全新会话；executor 注入 = 真实代码路径 handleAgentRun 系）----

export type TriggerMode = "read-only" | "default" | "auto";
export interface TriggerExecutorArgs {
  sessionId: string;
  message: string;
  mode: TriggerMode;
  signal: AbortSignal;
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
  runTimeoutMs?: number;
  settlesWithinMs?: number;
  /** 启动抖动（缺省随机 1-3min；验收注入 () => 0）。 */
  jitterMs?: () => number;
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

/** skipped 原因 → UI hover 中文标签（休眠/重叠/并发满/过期，Claude Desktop 同款）。 */
export const SKIP_REASON_LABELS: Record<string, string> = {
  "too-old": "过期：错过触发超出 7 天回看窗口，仅补最近一次",
  "catch-up-skip": "休眠错过：catchUp=skip 档不补跑，已对齐下次触发",
  overlap: "重叠：该任务上一次运行仍在进行中",
  "concurrency-cap": "并发满：同时运行的定时会话已达上限",
};

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
  private chain: Promise<void> = Promise.resolve();
  private tickMutex: Promise<void> = Promise.resolve();
  // tick 与 run_now 共用准入锁；覆盖检查到 queued 入表，不能跨 IO 留空位。
  private admissionMutex: Promise<void> = Promise.resolve();
  private readonly clock: () => number;
  private readonly runTimeoutMs: number;
  private readonly settlesWithinMs: number;
  private readonly jitterMs: () => number;
  readonly definitionsPath: string;
  readonly journalPath: string;

  constructor(private readonly deps: SchedulerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.settlesWithinMs = deps.settlesWithinMs ?? DEFAULT_SETTLES_WITHIN_MS;
    this.jitterMs = deps.jitterMs ?? defaultJitterMs;
    this.definitionsPath = join(deps.dataDir, "automations.json");
    this.journalPath = join(deps.dataDir, "automations-journal.jsonl");
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
    const loaded = await loadAutomationsFile(this.definitionsPath);
    this.tasks = loaded.tasks;
    for (const w of loaded.warnings) this.warn("[scheduler] " + w);
    const j = await readJournalFile(this.journalPath);
    this.ingestJournal(j.entries);
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

  private ingestJournal(entries: JournalEntry[]): void {
    for (const e of entries) this.addJournalEntry(e);
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
    this.journalKeys.clear();
    this.journalByTask.clear();
    this.sessionIdByKey.clear();
    for (const e of entries) this.addJournalEntry(e);
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
      for (const def of this.tasks) {
        if (!def.enabled) continue;
        report.considered++;
        if (startup) {
          await this.catchupGate(def, now, report);
        } else {
          const lastDecided = this.lastDecidedAt(def);
          const dueList = occurrencesBetween(def, lastDecided, now);
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
          if (due) await this.pipeline(def, due, "triggered", report);
        }
      }
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
    const missed = occurrencesBetween(def, from, now);
    if (missed.length === 0) return;
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

  /** 准入管线（顺序短路；dedup → 并发闸 → 重叠闸 → journal + spawn）。 */
  private async pipeline(
    def: AutomationDefinition,
    dueAt: Date,
    kind: "triggered" | "catchup",
    report: TickReport,
  ): Promise<void> {
    const run = () => this.admitOccurrence(def, dueAt, kind, report);
    const next = this.admissionMutex.then(run, run);
    // IO 失败仍释放锁；原始拒绝交还调用者，journal 的已决水位不回滚。
    this.admissionMutex = next.then(() => undefined, () => undefined);
    return next;
  }

  /** 仅在准入锁内调用；执行队列不持锁，queued + running 仍共同占用 cap。 */
  private async admitOccurrence(
    def: AutomationDefinition,
    dueAt: Date,
    kind: "triggered" | "catchup",
    report: TickReport,
  ): Promise<void> {
    const key = occurrenceKeyOf(def.id, dueAt);
    // occurrenceKey 去重（崩溃/重启双触发免疫）：已决 → 静默跳过，不写新账
    if (this.journalKeys.has(key)) {
      report.duplicates++;
      return;
    }
    // ②并发闸：同时运行的定时会话 ≤ cap（可配；与 worker 并发上限独立计数）
    if (this.inflight.size >= this.cap) {
      await this.decideSkip(def, dueAt, "concurrency-cap", report);
      return;
    }
    // ③重叠闸：同任务已有 queued/running
    for (const f of this.inflight.values()) {
      if (f.taskId === def.id) {
        await this.decideSkip(def, dueAt, "overlap", report);
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
    // 会话标题 = 任务名 · 触发时刻（任务时区墙钟）
    const title = def.name + " · " + formatLocal(dueAt, def.timeZone);
    const sessionId = await createSession(this.deps.sessionsDir, isValidSessionName(title) ? title : def.name);
    await createEventLog(pathOf(this.deps.sessionsDir, sessionId)).append({
      type: "session_meta",
      origin: "scheduled",
      automation_id: def.id,
      automation_name: def.name,
    } as AgentEvent);
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
      () => this.runOccurrence(def, key, dueAt, sessionId),
      () => this.runOccurrence(def, key, dueAt, sessionId),
    );
  }

  /** 触发执行（§12.2.4）：全新会话 + unattended fail-closed（会话侧 AskGate）+ 超时双闸 + 完成回写。 */
  private async runOccurrence(def: AutomationDefinition, key: string, dueAt: Date, sessionId: string): Promise<void> {
    const f = this.inflight.get(key);
    if (f) f.state = "running";
    const logPath = pathOf(this.deps.sessionsDir, sessionId);
    const message =
      def.prompt +
      `\n\n—— 本会话由定时任务「${def.name}」在 ${dueAt.toISOString()}（${def.timeZone}）无人值守触发；` +
      `工作区：${this.deps.workspace}。无人值守下一切审批请求会被自动拒绝（fail-closed），` +
      `写向操作需任务档位允许的自主路径才可执行。`;
    const controller = new AbortController();
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
        const exec = this.deps.runSession({ sessionId, message, mode: tierToMode(def.permissionTier), signal: controller.signal });
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
    // 完成回写：从会话事件投影摘要（零新 LLM 调用）；终态事件落会话日志 + 主时间线（完成卡复用 report）
    let status: "succeeded" | "failed" = timedOut ? "failed" : outcome && outcome.ok ? "succeeded" : "failed";
    let reason: string | undefined = timedOut ? "timeout" : (outcome && !outcome.ok ? outcome.error ?? "run_failed" : undefined);
    let events: AgentEvent[] = [];
    try {
      events = await replay(logPath);
    } catch {
      events = [];
    }
    if (!timedOut && status === "succeeded") reason = undefined;
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
    await this.emitTimelineSafe(completed);
    // P1-9（审查）：completions 加容量帽（每个 occurrence 一条、永不删 → 无界增长）；淘汰最早插入。
    if (this.completions.size >= COMPLETIONS_MAX) {
      const oldest = this.completions.keys().next().value;
      if (oldest !== undefined) this.completions.delete(oldest);
    }
    this.completions.set(key, { status, ...(reason !== undefined ? { reason } : {}) });
    this.inflight.delete(key);
    if (timedOut) {
      this.warn(`[scheduler] 运行超时（runTimeoutMs=${String(this.runTimeoutMs)}ms${aborted ? "，已 abort" : "，settlesWithin 二道退出"}）: ${def.name} ${sessionId}`);
    }
  }

  // ---- 任务定义 CRUD（设置页 / agent 工具共用；name 唯一）----

  list(): AutomationDefinition[] {
    return [...this.tasks];
  }

  /** 创建或更新（按 id）；name 唯一（除自身）。返回校验后的完整定义。 */
  async upsert(raw: unknown, opts: { form?: boolean } = {}): Promise<ValidationResult & { duplicate?: boolean }> {
    const v = validateAutomation(raw, { form: opts.form === true });
    if (!v.ok) return v;
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
    await saveAutomationsFile(this.definitionsPath, this.tasks);
    return { ok: true, value };
  }

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length === before) return { ok: false, error: "任务不存在: " + id };
    await saveAutomationsFile(this.definitionsPath, this.tasks);
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
  async snapshot(): Promise<ScheduleSnapshot> {
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
          history.push({ task_id: taskId, task_name: name, occurrence_key: e.occurrence_key, due_at: e.due_at, decision: e.decision, session_id: e.session_id, state: mem.status, ...(mem.reason !== undefined ? { reason: mem.reason } : {}), at: e.at });
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
    return { tasks, history, running, queued, cap: this.cap, startupDone: this.firstTickDone };
  }

  private findSessionIdByKey(key: string): string | undefined {
    // P2-6（审查）：O(1) 反查（旧实现遍历全部任务的全部条目 = snapshot 的 O(n²) 根因）。
    return this.sessionIdByKey.get(key);
  }

  /** H3-P2：会话终态（automation_completed）按文件签名缓存读取。签名 = size:mtimeMs——
   *  会话 JSONL 是 append-only，签名不变则终态不可能变化，免全量 replay。 */
  private async terminalOf(sid: string): Promise<{ state: HistoryState; reason?: string } | null> {
    const p = pathOf(this.deps.sessionsDir, sid);
    const st = await stat(p).catch(() => null);
    if (!st) {
      this.termCache.delete(sid);
      return null;
    }
    const sig = String(st.size) + ":" + String(st.mtimeMs);
    const hit = this.termCache.get(sid);
    if (hit && hit.sig === sig) return { state: hit.state, reason: hit.reason };
    try {
      const events = await replay(p);
      const term = [...events].reverse().find((x): x is Extract<AgentEvent, { type: "automation_completed" }> => x.type === "automation_completed");
      if (!term) {
        this.termCache.delete(sid);
        return null;
      }
      const out: { state: HistoryState; reason?: string } = { state: term.status, ...(term.reason !== undefined ? { reason: term.reason } : {}) };
      if (this.termCache.size >= 512) {
        const first = this.termCache.keys().next().value;
        if (first !== undefined) this.termCache.delete(first);
      }
      this.termCache.set(sid, { sig, ...out });
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
