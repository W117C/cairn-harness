// Episode 存储（Cairn Evolve · P0）：追加式 JSONL 为事实源，索引是可重建投影。
//
// 纪律与既有账本族一致：
//  · 追加式：一行一 Episode；不整文件重写；
//  · 坏行只丢那一条并计数，不整账作废；
//  · 读侧按 id 去重（重放/重试可能追加同一 Episode；后写者胜）；
//  · usd 缺席 = 不可定价，summary 单列 priced/unpriced，不折成 $0；
//  · 写索引用原子写，但索引不是事实源，丢了可以重建。

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../../events";
import {
  projectEpisode,
  type EpisodeArm,
  type EpisodeAssignmentSource,
  type EpisodeFinal,
  type EpisodeJudge,
  type EpisodeRecord,
  type EpisodeTaskClass,
  type EpisodeUser,
  type ProjectEpisodeInput,
} from "../../agent/evolve/episode";
import { writeFileAtomic } from "../../atomic-write";
import { EVOLVE_DIR, evolveDirFor } from "./paths";
import { readAssignment } from "./assignment-store";
import { FeedbackStore, type FeedbackRecord } from "../feedback";
import { finalOutcomeOf } from "../../agent/evolve/episode";
import { isRecord } from "../../is-record";

export { EVOLVE_DIR, evolveDirFor } from "./paths";

export const EPISODES_FILE = "episodes.jsonl";
export const EPISODES_INDEX_FILE = "episodes.index.json";

export function episodesPathFor(workspace: string): string {
  return join(evolveDirFor(workspace), EPISODES_FILE);
}

export function episodesIndexPathFor(workspace: string): string {
  return join(evolveDirFor(workspace), EPISODES_INDEX_FILE);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const TASK_CLASSES: ReadonlySet<EpisodeTaskClass> = new Set([
  "edit", "debug", "refactor", "test", "explain", "research", "ops", "ui", "other",
]);
const FINALS: ReadonlySet<EpisodeFinal> = new Set(["success", "failure", "unknown"]);
const ARMS: ReadonlySet<EpisodeArm> = new Set(["none", "control", "treatment", "shadow"]);
const SOURCES: ReadonlySet<EpisodeAssignmentSource> = new Set(["meta", "sidecar", "absent", "invalid"]);
const JUDGES: ReadonlySet<EpisodeJudge> = new Set(["pass", "fail", "unknown"]);
const USERS: ReadonlySet<EpisodeUser> = new Set(["accepted", "rejected", "unknown"]);

/** 单行 parse + 形状校验。认不出 ⇒ null（调用方按「坏行只丢这一条」处置）。 */
export function parseEpisodeLine(line: string): EpisodeRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (typeof raw.id !== "string" || !raw.id.startsWith("ep_")) return null;
  if (!isFiniteNumber(raw.ts) || typeof raw.workspace !== "string" || typeof raw.sessionId !== "string") return null;

  const run = raw.run;
  if (!isRecord(run)
    || !isFiniteNumber(run.startEventId) || !isFiniteNumber(run.endEventId)
    || typeof run.logPath !== "string"
    || (run.logSha256 !== null && typeof run.logSha256 !== "string")) return null;

  const task = raw.task;
  if (!isRecord(task)
    || typeof task.signature !== "string"
    || typeof task.class !== "string" || !TASK_CLASSES.has(task.class as EpisodeTaskClass)
    || typeof task.intentExcerpt !== "string"
    || !isStringArray(task.tokens)) return null;

  const assembly = raw.assembly;
  if (!isRecord(assembly)) return null;
  for (const key of ["harnessRev", "configDigest", "model", "provider", "tier"] as const) {
    if (assembly[key] !== null && typeof assembly[key] !== "string") return null;
  }

  const outcome = raw.outcome;
  if (!isRecord(outcome)
    || (outcome.verify !== "green" && outcome.verify !== "red" && outcome.verify !== "none")
    || typeof outcome.judge !== "string" || !JUDGES.has(outcome.judge as EpisodeJudge)
    || typeof outcome.user !== "string" || !USERS.has(outcome.user as EpisodeUser)
    || typeof outcome.final !== "string" || !FINALS.has(outcome.final as EpisodeFinal)) return null;

  const cost = raw.cost;
  if (!isRecord(cost)
    || !isFiniteNumber(cost.tokensIn) || !isFiniteNumber(cost.tokensOut)
    || !isFiniteNumber(cost.mainTokens) || !isFiniteNumber(cost.workerTokens)
    || !isFiniteNumber(cost.requests) || !isFiniteNumber(cost.toolCalls)
    || (cost.usd !== null && !isFiniteNumber(cost.usd))
    || (cost.durationMs !== null && !isFiniteNumber(cost.durationMs))) return null;

  const evidence = raw.evidence;
  if (!isRecord(evidence)
    || !isRecord(evidence.verifyCauses)
    || Object.values(evidence.verifyCauses).some((value) => !isFiniteNumber(value))
    || !isFiniteNumber(evidence.failedToolCalls)
    || !isStringArray(evidence.stuckSignals)
    || !isStringArray(evidence.touchedPaths)
    || !isStringArray(evidence.toolNames)
    || !isStringArray(evidence.toolSequence)
    || (evidence.nudgedExperienceIds !== undefined && !isStringArray(evidence.nudgedExperienceIds))
    || (evidence.diffDigest !== null && typeof evidence.diffDigest !== "string")) return null;

  const assignment = raw.assignment;
  if (!isRecord(assignment)
    || typeof assignment.source !== "string" || !SOURCES.has(assignment.source as EpisodeAssignmentSource)
    || (assignment.experimentId !== null && typeof assignment.experimentId !== "string")
    || typeof assignment.arm !== "string" || !ARMS.has(assignment.arm as EpisodeArm)
    || (assignment.propensity !== null && !isFiniteNumber(assignment.propensity))
    || typeof assignment.policyVersion !== "string"
    || !isStringArray(assignment.injectedExperienceIds)
    || !isFiniteNumber(assignment.injectedChars)) return null;

  return raw as unknown as EpisodeRecord;
}

export interface LoadedEpisodes {
  episodes: EpisodeRecord[];
  badLines: number;
  duplicateIds: number;
  rawLines: number;
}

/** 读整份 Episode 账。文件缺失 = 空账（首启正常）；坏行只丢那一条；重复 id 后写者胜。 */
export async function loadEpisodes(workspace: string): Promise<LoadedEpisodes> {
  let raw: string;
  try {
    raw = await readFile(episodesPathFor(workspace), "utf8");
  } catch {
    return { episodes: [], badLines: 0, duplicateIds: 0, rawLines: 0 };
  }
  const byId = new Map<string, EpisodeRecord>();
  let badLines = 0;
  let duplicateIds = 0;
  let rawLines = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    rawLines += 1;
    const parsed = parseEpisodeLine(line);
    if (parsed === null) {
      badLines += 1;
      continue;
    }
    if (byId.has(parsed.id)) duplicateIds += 1;
    byId.set(parsed.id, parsed);
  }
  return { episodes: [...byId.values()], badLines, duplicateIds, rawLines };
}

export interface AppendEpisodeResult {
  path: string;
  written: boolean;
}

/** 追加一条 Episode。同 id 已存在 ⇒ 不重复写（跨进程竞态由读侧去重兜住）。 */
export async function appendEpisode(workspace: string, episode: EpisodeRecord): Promise<AppendEpisodeResult> {
  const path = episodesPathFor(workspace);
  const existing = await loadEpisodes(workspace);
  if (existing.episodes.some((item) => item.id === episode.id)) return { path, written: false };
  await mkdir(evolveDirFor(workspace), { recursive: true });
  await appendFile(path, JSON.stringify(episode) + "\n", "utf8");
  return { path, written: true };
}

export async function sha256File(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

async function fileMtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** 会话起始时刻：只认 session_meta 的 ts（如有）；缺席 = 未记录，不拿别的时刻冒充。 */
export function sessionStartedAt(events: readonly AgentEvent[]): number | null {
  for (const event of events) {
    if (event.type !== "session_meta") continue;
    const ts = (event as { ts?: unknown }).ts;
    return isFiniteNumber(ts) ? ts : null;
  }
  return null;
}

/** 会话反馈账的位置：与 session-handlers 的默认落点同源（`<ws>/.agent/sessions/feedback.jsonl`）。 */
export function feedbackPathFor(workspace: string): string {
  return join(workspace, ".agent", "sessions", "feedback.jsonl");
}

/** 用户信号覆盖（纯函数）：反馈落在某场 run 的事件窗口内 ⇒ 改 outcome.user，并按**同一优先级**
 *  重算 final（判卷/验证仍压过用户）。同一场多条反馈以时间最新为准（`none` = 撤回 ⇒ unknown）。
 *
 *  映射口径：
 *   · 只认 owner 自己的 eventId（`eventRef` 指向祖先文件的那种跨会话指针不在此列——分叉后的行号
 *     与本场窗口不同域，硬套只会张冠李戴）；
 *   · run 窗口 startEventId..endEventId 含端点；空 run（0..0）不接受反馈。
 */
export function applyUserFeedback(
  episodes: readonly EpisodeRecord[],
  records: readonly FeedbackRecord[],
): EpisodeRecord[] {
  if (records.length === 0) return [...episodes];
  const bySession = new Map<string, FeedbackRecord[]>();
  for (const record of records) {
    if (record.eventRef !== undefined) continue;
    const list = bySession.get(record.sessionId) ?? [];
    list.push(record);
    bySession.set(record.sessionId, list);
  }
  return episodes.map((episode) => {
    const pool = bySession.get(episode.sessionId);
    if (pool === undefined) return episode;
    const { startEventId, endEventId } = episode.run;
    if (startEventId <= 0 || endEventId < startEventId) return episode;
    const hits = pool.filter((r) => r.eventId >= startEventId && r.eventId <= endEventId);
    if (hits.length === 0) return episode;
    // 文件顺序 = 追加顺序；同刻（ISO 字符串相同）时后写者胜（稳定排序保留原序）。
    const latest = [...hits].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1)!;
    const user = latest.rating === "up" ? "accepted" : latest.rating === "down" ? "rejected" : "unknown";
    if (user === episode.outcome.user) return episode;
    return {
      ...episode,
      outcome: { ...episode.outcome, user, final: finalOutcomeOf(episode.outcome.judge, episode.outcome.verify, user) },
    };
  });
}

/** 读 Episode 账并叠加用户反馈（报告/实验分析用这个入口；feedback 读不了按未知处理，不炸账）。 */
export async function loadEpisodesWithUserFeedback(workspace: string): Promise<LoadedEpisodes> {
  const loaded = await loadEpisodes(workspace);
  if (loaded.episodes.length === 0) return loaded;
  let records: FeedbackRecord[];
  try {
    ({ records } = await new FeedbackStore(feedbackPathFor(workspace)).listAll());
  } catch (err) {
    console.warn("[evolve] 反馈账读不了（用户证据按未知处理）: " + (err instanceof Error ? err.message : String(err)));
    return loaded;
  }
  return { ...loaded, episodes: applyUserFeedback(loaded.episodes, records) };
}

export interface RecordEpisodeInput {
  events: readonly AgentEvent[];
  workspace: string;
  sessionId: string;
  logPath: string;
  observedAt?: number;
  startedAt?: number | null;
  endedAt?: number | null;
  assembly?: ProjectEpisodeInput["assembly"];
  judge?: EpisodeJudge | null;
  user?: EpisodeUser | null;
  /** 显式分配（测试/编排）；缺省读 sidecar，再缺省从 session_meta.evolve 读。 */
  assignment?: ProjectEpisodeInput["assignment"];
}

export interface RecordedEpisode {
  episode: EpisodeRecord;
  path: string;
  written: boolean;
}

/** 收束缝的一行入口：算日志哈希/起止时刻 → 投影 → 追加。失败由调用方处置（不许阻塞主流程）。 */
export async function recordEpisode(input: RecordEpisodeInput): Promise<RecordedEpisode> {
  const logSha256 = await sha256File(input.logPath);
  const startedAt = input.startedAt === undefined ? sessionStartedAt(input.events) : input.startedAt;
  const endedAt = input.endedAt === undefined ? await fileMtimeMs(input.logPath) : input.endedAt;
  const observedAt = input.observedAt ?? Date.now();
  const assignment = input.assignment ?? await readAssignment(input.workspace, input.sessionId);
  const episode = projectEpisode({
    events: input.events,
    workspace: input.workspace,
    sessionId: input.sessionId,
    logPath: input.logPath,
    logSha256,
    observedAt,
    startedAt,
    endedAt,
    ...(input.assembly !== undefined ? { assembly: input.assembly } : {}),
    ...(input.judge !== undefined ? { judge: input.judge } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
    ...(assignment !== null ? { assignment } : {}),
  });
  const appended = await appendEpisode(input.workspace, episode);
  return { episode, ...appended };
}

export interface EpisodeSummary {
  v: 1;
  total: number;
  duplicates: number;
  badLines: number;
  byOutcome: { success: number; failure: number; unknown: number };
  byClass: Record<string, number>;
  byVerify: { green: number; red: number; none: number };
  /** 三个未知面各报各的（可重叠）；不合成一个「unknown」总数。 */
  unknownReasons: { judge: number; verify: number; user: number };
  cost: { mainTokens: number; workerTokens: number; requests: number; pricedRuns: number; unpricedRuns: number };
  lastTs: number | null;
}

/** 纯汇总：只读 Episode；不猜、不补。 */
export function summarizeEpisodes(loaded: LoadedEpisodes): EpisodeSummary {
  const byOutcome = { success: 0, failure: 0, unknown: 0 };
  const byClass: Record<string, number> = {};
  const byVerify = { green: 0, red: 0, none: 0 };
  const unknownReasons = { judge: 0, verify: 0, user: 0 };
  let mainTokens = 0;
  let workerTokens = 0;
  let requests = 0;
  let pricedRuns = 0;
  let unpricedRuns = 0;
  let lastTs: number | null = null;

  for (const episode of loaded.episodes) {
    byOutcome[episode.outcome.final] += 1;
    byClass[episode.task.class] = (byClass[episode.task.class] ?? 0) + 1;
    byVerify[episode.outcome.verify] += 1;
    if (episode.outcome.judge === "unknown") unknownReasons.judge += 1;
    if (episode.outcome.verify === "none") unknownReasons.verify += 1;
    if (episode.outcome.user === "unknown") unknownReasons.user += 1;
    mainTokens += episode.cost.mainTokens;
    workerTokens += episode.cost.workerTokens;
    requests += episode.cost.requests;
    if (episode.cost.usd === null) unpricedRuns += 1;
    else pricedRuns += 1;
    if (lastTs === null || episode.ts > lastTs) lastTs = episode.ts;
  }

  return {
    v: 1,
    total: loaded.episodes.length,
    duplicates: loaded.duplicateIds,
    badLines: loaded.badLines,
    byOutcome,
    byClass,
    byVerify,
    unknownReasons,
    cost: { mainTokens, workerTokens, requests, pricedRuns, unpricedRuns },
    lastTs,
  };
}

// ---- 按经验条目的效果对账（2026-11-06 自进化调研批）----
// Episode 账早已带「这一场注入了哪几条经验」（assignment sidecar，arm=none 的基线注入也记账）
// 与本场结局（outcome.final success/failure/unknown），但汇总面此前只有**全局**计数——
// 晋升/退役的决策面缺**每条**证据：哪条经验注入了 N 次、跟着几绿几红。
// 纯函数，观测口径：分母 = 注入过的条目（没注入不进表），结局用 outcome.final（用户信号已并入）。
export interface ExperienceEfficacyRow {
  id: string;
  injected: number;
  success: number;
  failure: number;
  unknown: number;
}

export function experienceEfficacy(loaded: LoadedEpisodes): ExperienceEfficacyRow[] {
  const byId = new Map<string, ExperienceEfficacyRow>();
  for (const episode of loaded.episodes) {
    for (const id of episode.assignment.injectedExperienceIds) {
      const row = byId.get(id) ?? { id, injected: 0, success: 0, failure: 0, unknown: 0 };
      row.injected += 1;
      row[episode.outcome.final] += 1;
      byId.set(id, row);
    }
  }
  // 稳定排序：注入多的在前；同注入数按 id 字典序（同输入同输出，可判卷）。
  return [...byId.values()].sort((a, b) => (b.injected - a.injected) || (a.id < b.id ? -1 : 1));
}

/** 人读的 facts 面。所有「不可测」都显式出现，不折成 0。 */
export function formatEpisodeSummary(summary: EpisodeSummary): string {
  const classes = Object.entries(summary.byClass)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, count]) => name + "×" + String(count))
    .join("、") || "无";
  return [
    "Episode 证据（" + EVOLVE_DIR + "/" + EPISODES_FILE + "）",
    "  总数 " + String(summary.total)
      + "｜重复 " + String(summary.duplicates) + "（读侧去重）"
      + "｜坏行 " + String(summary.badLines),
    "  结局 success " + String(summary.byOutcome.success)
      + " / failure " + String(summary.byOutcome.failure)
      + " / unknown " + String(summary.byOutcome.unknown),
    "  任务类 " + classes,
    "  verify green " + String(summary.byVerify.green)
      + " / red " + String(summary.byVerify.red)
      + " / none " + String(summary.byVerify.none),
    "  未知面 judge 未测 " + String(summary.unknownReasons.judge)
      + "｜verify 未跑 " + String(summary.unknownReasons.verify)
      + "｜user 未测 " + String(summary.unknownReasons.user),
    "  成本 主面 " + String(summary.cost.mainTokens) + " token｜worker " + String(summary.cost.workerTokens)
      + "｜请求 " + String(summary.cost.requests)
      + "｜可定价 " + String(summary.cost.pricedRuns)
      + " / 不可定价 " + String(summary.cost.unpricedRuns),
    "  最近 " + (summary.lastTs === null ? "无" : new Date(summary.lastTs).toISOString()),
  ].join("\n");
}

export interface EpisodeIndexRecord {
  v: 1;
  ts: number;
  summary: EpisodeSummary;
}

/** 重建索引（原子写）。索引是投影，不是事实源；删了可重建。 */
export async function writeEpisodeIndex(workspace: string): Promise<{ path: string; summary: EpisodeSummary }> {
  const summary = summarizeEpisodes(await loadEpisodes(workspace));
  const path = episodesIndexPathFor(workspace);
  await mkdir(evolveDirFor(workspace), { recursive: true });
  await writeFileAtomic(path, JSON.stringify({ v: 1, ts: Date.now(), summary }, null, 2) + "\n");
  return { path, summary };
}
