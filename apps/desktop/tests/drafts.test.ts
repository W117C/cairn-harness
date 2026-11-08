// 草稿集合解析（2026-10-18）：侧栏“有草稿”标记与 Composer 落盘共用同一把键/同一份解析。
import { describe, expect, it } from "vitest";
import { draftIdsFrom, draftKeyFor, HOME_DRAFT_KEY, sessionIdOfDraftKey } from "../src/renderer/drafts";

describe("draftIdsFrom", () => {
  it("只收非空文本、排除 home 键与空白", () => {
    const raw = JSON.stringify({ "\u0000home": "home draft", "s1": "x", "s2": "   ", "s3": "" });
    expect([...draftIdsFrom(raw)]).toEqual(["s1"]);
  });

  it("坏数据/空值当没有", () => {
    expect(draftIdsFrom(null).size).toBe(0);
    expect(draftIdsFrom("{not json").size).toBe(0);
    expect(draftIdsFrom("[]").size).toBe(0);
  });
});

describe("draftKeyFor / sessionIdOfDraftKey（草稿键带工作区）", () => {
  it("同 id 两个工作区给不同键——裸 id 键会把 A 的草稿/铅笔套到 B", () => {
    expect(draftKeyFor("/ws/a", "s1")).not.toBe(draftKeyFor("/ws/b", "s1"));
  });

  it("首页用常量键；工作区未知退回裸 id（与 runKey 同口径）", () => {
    expect(draftKeyFor("/ws/a", null)).toBe(HOME_DRAFT_KEY);
    expect(draftKeyFor(null, "s1")).toBe("s1");
    expect(draftKeyFor("", "s1")).toBe("s1");
  });

  it("引用键取回会话 id；旧裸 id 原样；home ⇒ null（旧桶懒迁移的依据）", () => {
    expect(sessionIdOfDraftKey(draftKeyFor("/ws/a", "s1"))).toBe("s1");
    expect(sessionIdOfDraftKey("s1")).toBe("s1");
    expect(sessionIdOfDraftKey(HOME_DRAFT_KEY)).toBeNull();
    expect(sessionIdOfDraftKey('["/ws/a"]')).toBe('["/ws/a"]'); // 坏键当裸 id，不猜
  });
});
