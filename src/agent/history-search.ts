import type { AgentEvent, EventRef } from "../events";
import { tokensOf } from "./map/retrieve";

export interface HistorySearchEntry {
  event: AgentEvent;
  ref: EventRef;
}

export interface HistorySearchHit {
  ref: EventRef;
  type: AgentEvent["type"];
  excerpt: string;
  matched: string[];
  score: number;
}

export type HistorySearchResult =
  | {
      kind: "ok";
      hits: HistorySearchHit[];
      scannedEvents: number;
      totalEvents: number;
    }
  | {
      kind: "partial";
      hits: HistorySearchHit[];
      scannedEvents: number;
      totalEvents: number;
      unreadableEntries: number;
      reason: "event-limit" | "unreadable";
    }
  | {
      kind: "unavailable";
      reason: string;
      detail?: string;
    };

export const HISTORY_SEARCH_MAX_RESULTS = 6;
export const HISTORY_SEARCH_MAX_EVENTS = 512;
export const HISTORY_SEARCH_MAX_EXCERPT_CHARS = 320;

const SEARCHABLE_FIELDS = ["content", "text", "output", "summary", "task", "reason", "message"] as const;

/** Current-session history is raw data. Hidden reasoning is deliberately absent. */
function searchableText(event: AgentEvent): string | null {
  if (event.type === "thinking_delta") return null;
  const record = event as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of SEARCHABLE_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value !== "") parts.push(value);
  }
  if (event.type === "tool_call") {
    parts.push(event.name);
    try {
      parts.push(JSON.stringify(event.args));
    } catch {
      parts.push("[unserializable arguments]");
    }
  }
  const text = parts.join("\n").trim();
  return text === "" ? null : text;
}

function positiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function codepointIndex(haystack: readonly string[], needle: string): number {
  const target = Array.from(needle.toLowerCase());
  if (target.length === 0) return -1;
  const lower = haystack.map((char) => char.toLowerCase());
  for (let start = 0; start + target.length <= lower.length; start += 1) {
    let same = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (lower[start + offset] !== target[offset]) {
        same = false;
        break;
      }
    }
    if (same) return start;
  }
  return -1;
}

/** Center a bounded window on the first matched term without splitting surrogates. */
export function historyExcerpt(
  text: string,
  matched: readonly string[],
  maxChars: number,
): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= maxChars) return flat;

  let hit = -1;
  for (const token of matched) {
    hit = codepointIndex(chars, token);
    if (hit >= 0) break;
  }
  if (hit < 0) return chars.slice(0, Math.max(1, maxChars - 1)).join("") + "…";

  const prefix = hit > 0;
  const suffixReserve = 1;
  let bodyBudget = Math.max(1, maxChars - (prefix ? 1 : 0) - suffixReserve);
  let start = Math.max(0, hit - Math.floor(bodyBudget / 2));
  let end = Math.min(chars.length, start + bodyBudget);
  start = Math.max(0, end - bodyBudget);
  const prefixText = start > 0 ? "…" : "";
  const out = chars.slice(start, end).join("");
  const suffix = end < chars.length ? "…" : "";
  let excerpt = prefixText + out + suffix;
  while (Array.from(excerpt).length > maxChars) {
    end = Math.max(start + 1, end - 1);
    excerpt = (start > 0 ? "…" : "") + chars.slice(start, end).join("") + (end < chars.length ? "…" : "");
  }
  return excerpt;
}

/**
 * Search a bounded, newest-first window of the complete current-session source
 * view. The caller supplies refs so every hit remains traceable to its physical
 * log line, including entries inherited from a pointer fork.
 */
export function searchHistory(input: {
  entries: readonly HistorySearchEntry[];
  query: string;
  maxResults?: number;
  maxEvents?: number;
  maxExcerptChars?: number;
  unreadableEntries?: number;
}): HistorySearchResult {
  const query = input.query.trim();
  if (query === "") return { kind: "unavailable", reason: "empty-query" };
  const queryTokens = tokensOf(query);
  if (queryTokens.length === 0) {
    return { kind: "unavailable", reason: "empty-token-query", detail: "query contains no searchable terms" };
  }

  const maxResults = positiveInt(input.maxResults, HISTORY_SEARCH_MAX_RESULTS, 50);
  const maxEvents = positiveInt(input.maxEvents, HISTORY_SEARCH_MAX_EVENTS, 10_000);
  const maxExcerptChars = positiveInt(input.maxExcerptChars, HISTORY_SEARCH_MAX_EXCERPT_CHARS, 2_000);
  const unreadableEntries = Math.max(0, Math.floor(input.unreadableEntries ?? 0));
  const totalEvents = input.entries.length;
  const scanStart = Math.max(0, totalEvents - maxEvents);
  const querySet = new Set(queryTokens);
  const matchedRows: HistorySearchHit[] = [];

  for (let index = totalEvents - 1; index >= scanStart; index -= 1) {
    const item = input.entries[index]!;
    const text = searchableText(item.event);
    if (text === null) continue;
    const matched = [...new Set(tokensOf(text))].filter((token) => querySet.has(token)).sort();
    if (matched.length === 0) continue;
    matchedRows.push({
      ref: item.ref,
      type: item.event.type,
      excerpt: historyExcerpt(text, matched, maxExcerptChars),
      matched,
      score: matched.length,
    });
  }

  matchedRows.sort((left, right) =>
    right.score - left.score ||
    left.ref.eventId - right.ref.eventId ||
    left.ref.workspace.localeCompare(right.ref.workspace) ||
    left.ref.sessionId.localeCompare(right.ref.sessionId));

  const hits = matchedRows.slice(0, maxResults);
  const scannedEvents = totalEvents - scanStart;
  const limitReason = scanStart > 0 ? "event-limit" : null;
  if (limitReason !== null || unreadableEntries > 0) {
    return {
      kind: "partial",
      hits,
      scannedEvents,
      totalEvents,
      unreadableEntries,
      reason: limitReason ?? "unreadable",
    };
  }
  return {
    kind: "ok",
    hits,
    scannedEvents,
    totalEvents,
  };
}

