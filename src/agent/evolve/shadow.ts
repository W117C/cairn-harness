// 离线 Shadow（Cairn Evolve · P1）：不注入、不改运行面，只回答
// “如果这一轮启用候选经验，本会命中哪些条目、在成功/失败 Episode 上分别命中多少”。
//
// 这是 P1 的验收面：没有它，candidate/shadow 状态只是一个标签；有了它，
// 触发器误报、候选只在成功跑里出现（或只在失败跑里出现）都能被看见。
// 命中不是因果：shadow 只能用于调触发与发现噪声，不能用于晋升（晋升要 P2 的对照）。

import type { EpisodeRecord } from "./episode";
import {
  retrieveExperiences,
  type ExperienceEntry,
  type ExperienceKind,
  type ExperienceStatus,
  type RetrievalContext,
  type RetrievalSkipReason,
} from "./playbook";

export function contextFromEpisode(episode: EpisodeRecord): RetrievalContext {
  const signals = new Set<string>([`verify:${episode.outcome.verify}`]);
  for (const cause of Object.keys(episode.evidence.verifyCauses)) signals.add(`verify-cause:${cause}`);
  for (const signal of episode.evidence.stuckSignals) signals.add(signal);
  if (episode.outcome.judge !== "unknown") signals.add(`judge:${episode.outcome.judge}`);
  return {
    workspace: episode.workspace,
    taskClass: episode.task.class,
    tokens: episode.task.tokens,
    signals: [...signals].sort(),
    toolNames: episode.evidence.toolNames ?? [],
    paths: episode.evidence.touchedPaths,
    now: episode.ts,
  };
}

/** 同一会话**上一跑**的读数信号（续聊时把上一跑的症状带进本轮触发面）。
 *  新会话 / 该会话还没有 Episode ⇒ 空数组。当前跑的 Episode 要到收束才落账，
 *  所以装配时看到的最新同会话 Episode 就是上一跑。 */
export function previousRunSignals(
  episodes: readonly EpisodeRecord[],
  sessionId: string | undefined,
): string[] {
  if (sessionId === undefined || sessionId.length === 0) return [];
  const rows = episodes.filter((episode) => episode.sessionId === sessionId);
  if (rows.length === 0) return [];
  const latest = [...rows].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(-1)!;
  return [...contextFromEpisode(latest).signals];
}

export interface ShadowEntryStat {
  id: string;
  kind: ExperienceKind;
  status: ExperienceStatus;
  hits: number;
  hitsByOutcome: { success: number; failure: number; unknown: number };
  chars: number;
  /** 命中分布的判读：只在失败跑命中 / 两边都命中（无法区分）等；不是因果结论。 */
  signal: string;
}

export interface ShadowReport {
  v: 1;
  episodes: number;
  totalHits: number;
  hitsByOutcome: { success: number; failure: number; unknown: number };
  entries: ShadowEntryStat[];
  skipped: Record<RetrievalSkipReason, number>;
  conflicts: string[];
}

export interface ShadowOptions {
  maxEntries?: number;
  maxChars?: number;
}

const SKIP_REASONS: readonly RetrievalSkipReason[] = ["status", "expired", "scope", "trigger", "conflict", "budget"];

function shadowSignal(hits: ShadowEntryStat["hitsByOutcome"]): string {
  const total = hits.success + hits.failure + hits.unknown;
  if (total === 0) return "未命中";
  if (hits.success > 0 && hits.failure > 0) {
    const separation = Math.abs(hits.failure - hits.success) / total;
    return separation < 0.2
      ? "成功/失败都命中（无法区分，可能是噪声）"
      : "成功/失败都命中（有区分度，仍需对照）";
  }
  if (hits.failure > 0) return "只在失败跑命中（方向正确，需对照）";
  if (hits.success > 0) return "只在成功跑命中（可能是噪声或成功策略）";
  return "只在未知结局命中";
}

/** 对每个历史 Episode 跑一次候选检索；不写盘、不改条目状态。 */
export function shadowReport(
  episodes: readonly EpisodeRecord[],
  entries: readonly ExperienceEntry[],
  options: ShadowOptions = {},
): ShadowReport {
  const stats = new Map<string, ShadowEntryStat>();
  for (const entry of entries) {
    stats.set(entry.id, {
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      hits: 0,
      hitsByOutcome: { success: 0, failure: 0, unknown: 0 },
      chars: 0,
      signal: "未命中",
    });
  }
  const skipped: Record<RetrievalSkipReason, number> = {
    status: 0, expired: 0, scope: 0, trigger: 0, conflict: 0, budget: 0,
  };
  const conflicts = new Set<string>();
  const hitsByOutcome = { success: 0, failure: 0, unknown: 0 };
  let totalHits = 0;

  for (const episode of episodes) {
    const result = retrieveExperiences(entries, contextFromEpisode(episode), {
      includeStatuses: ["candidate", "shadow", "active"],
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
      ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
    });
    for (const reason of SKIP_REASONS) {
      skipped[reason] += result.skipped.filter((item) => item.reason === reason).length;
    }
    for (const id of result.conflicts) conflicts.add(id);
    for (const entry of result.selected) {
      const stat = stats.get(entry.id);
      if (stat === undefined) continue;
      stat.hits += 1;
      stat.hitsByOutcome[episode.outcome.final] += 1;
      stat.chars += entry.body.length;
      hitsByOutcome[episode.outcome.final] += 1;
      totalHits += 1;
    }
  }

  const entryStats = [...stats.values()]
    .map((stat) => ({ ...stat, signal: shadowSignal(stat.hitsByOutcome) }))
    .sort((a, b) => b.hits - a.hits || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    v: 1,
    episodes: episodes.length,
    totalHits,
    hitsByOutcome,
    entries: entryStats,
    skipped,
    conflicts: [...conflicts].sort(),
  };
}

/** 人读的 shadow 面；命中不是因果，标题与正文都这么说。 */
export function formatShadowReport(report: ShadowReport): string {
  const lines = [
    "Shadow（候选/active 在历史 Episode 上的命中；命中不是因果，不用于晋升）",
    "  Episode " + String(report.episodes) + "｜命中 " + String(report.totalHits)
      + "｜成功 " + String(report.hitsByOutcome.success)
      + " / 失败 " + String(report.hitsByOutcome.failure)
      + " / 未知 " + String(report.hitsByOutcome.unknown),
    "  跳过：status " + String(report.skipped.status)
      + "｜expired " + String(report.skipped.expired)
      + "｜scope " + String(report.skipped.scope)
      + "｜trigger " + String(report.skipped.trigger)
      + "｜conflict " + String(report.skipped.conflict)
      + "｜budget " + String(report.skipped.budget),
  ];
  if (report.entries.length === 0) {
    lines.push("  条目：无");
  } else {
    lines.push("  条目：");
    for (const entry of report.entries) {
      lines.push("    " + entry.id + " [" + entry.kind + "/" + entry.status + "]"
        + " hits=" + String(entry.hits)
        + " success=" + String(entry.hitsByOutcome.success)
        + " failure=" + String(entry.hitsByOutcome.failure)
        + " unknown=" + String(entry.hitsByOutcome.unknown)
        + " chars=" + String(entry.chars)
        + "｜" + entry.signal);
    }
  }
  if (report.conflicts.length > 0) lines.push("  冲突：" + report.conflicts.join("、"));
  return lines.join("\n");
}
