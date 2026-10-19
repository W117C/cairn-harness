// 草稿集合解析（2026-10-18）：侧栏“有草稿”标记与 Composer 落盘共用同一把键/同一份解析。
import { describe, expect, it } from "vitest";
import { draftIdsFrom } from "../src/renderer/drafts";

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
