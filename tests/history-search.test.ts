import { describe, expect, it } from "vitest";
import { searchHistory } from "../src/agent/history-search";
import type { AgentEvent, EventRef } from "../src/events";

const WORKSPACE = "/tmp/ws";
const SESSION = "session-1";

function ref(eventId: number): EventRef {
  return { workspace: WORKSPACE, sessionId: SESSION, eventId };
}

function entry(event: AgentEvent, eventId: number) {
  return { event, ref: ref(eventId) };
}

describe("searchHistory", () => {
  it("finds exact English facts in user and tool history and returns source refs", () => {
    const result = searchHistory({
      query: "ALPHA-417",
      entries: [
        entry({ type: "user_message", content: "remember ALPHA-417" }, 2),
        entry({ type: "assistant_message", content: "unrelated" }, 3),
        entry({ type: "tool_result", callId: "c1", ok: true, output: "value=ALPHA-417" }, 4),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "unavailable") throw new Error(result.reason);
    expect(result.hits.map((hit) => hit.ref)).toEqual([ref(2), ref(4)]);
    expect(result.hits[0]!.matched).toContain("alpha");
    expect(result.hits[0]!.excerpt).toContain("ALPHA-417");
  });

  it("finds CJK bigrams and reports the matched terms", () => {
    const result = searchHistory({
      query: "部署超时怎么处理",
      entries: [
        entry({ type: "assistant_message", content: "部署超时后先检查网关" }, 1),
        entry({ type: "assistant_message", content: "命名风格问题" }, 2),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "unavailable") throw new Error(result.reason);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.matched).toEqual(expect.arrayContaining(["部署", "超时"]));
  });

  it("distinguishes an empty query from an empty completed search", () => {
    const empty = searchHistory({ query: "   ", entries: [] });
    expect(empty).toEqual({ kind: "unavailable", reason: "empty-query" });

    const noHits = searchHistory({ query: "not-present", entries: [] });
    expect(noHits).toEqual({
      kind: "ok",
      hits: [],
      scannedEvents: 0,
      totalEvents: 0,
    });
  });

  it("scans the newest bounded window and reports partial instead of no-match", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry({
        type: "user_message",
        content: index === 0 ? "old ALPHA-417" : "new-" + String(index),
      }, index + 1),
    );
    const result = searchHistory({ query: "ALPHA-417", entries, maxEvents: 3 });

    expect(result).toMatchObject({
      kind: "partial",
      hits: [],
      scannedEvents: 3,
      totalEvents: 5,
      reason: "event-limit",
    });
  });

  it("orders equal scores by event id and de-duplicates matched tokens", () => {
    const result = searchHistory({
      query: "same token",
      entries: [
        entry({ type: "user_message", content: "same same token" }, 9),
        entry({ type: "user_message", content: "token same" }, 4),
      ],
      maxResults: 2,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "unavailable") throw new Error(result.reason);
    expect(result.hits.map((hit) => hit.ref.eventId)).toEqual([4, 9]);
    expect(result.hits[0]!.matched).toEqual(["same", "token"]);
  });

  it("excludes hidden reasoning and clips excerpts by Unicode code point", () => {
    const hidden = searchHistory({
      query: "SECRET",
      entries: [entry({ type: "thinking_delta", callId: "reasoning-1", text: "SECRET plan" }, 1)],
    });
    expect(hidden).toMatchObject({ kind: "ok", hits: [] });

    const emoji = "😀".repeat(80);
    const clipped = searchHistory({
      query: "needle",
      entries: [entry({ type: "user_message", content: emoji + " needle " + emoji }, 1)],
      maxExcerptChars: 24,
    });
    expect(clipped.kind).toBe("ok");
    if (clipped.kind === "unavailable") throw new Error(clipped.reason);
    const excerptChars = Array.from(clipped.hits[0]!.excerpt);
    expect(excerptChars.length).toBeLessThanOrEqual(24);
    expect(excerptChars.every((char) => char === "😀" || char === "…" || " needle".includes(char))).toBe(true);
  });

  it("reports unreadable source entries as partial", () => {
    const result = searchHistory({
      query: "needle",
      entries: [entry({ type: "user_message", content: "needle" }, 1)],
      unreadableEntries: 2,
    });
    expect(result).toMatchObject({ kind: "partial", unreadableEntries: 2 });
  });
});

