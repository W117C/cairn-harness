// Bot 侧报告判卷：每个 bot 能力都要有证人且文件存在；缺证人 ⇒ missing + incomplete。
import { describe, expect, it } from "vitest";
import { buildBotReport } from "../src/verification/bot-report";

const items = [
  { id: "bot.a", capability: "能力 A", status: "covered", evidence: ["tests/segments.test.ts"], ours: "边界：无" },
  { id: "bot.b", capability: "能力 B", status: "covered", evidence: ["tests/team-secrets.test.ts"] },
  { id: "wallpaper.x", capability: "壁纸不归这份", status: "covered", evidence: ["nope"] },
];

describe("Bot 侧报告", () => {
  it("只收 bot.*；证人都存在 ⇒ pass；统计对得上", () => {
    const r = buildBotReport({ items, exists: () => true });
    expect(r.rows.map((x) => x.id)).toEqual(["bot.a", "bot.b"]);
    expect(r.summary).toEqual({ total: 2, covered: 2, partial: 0, out: 0, missing: 0 });
    expect(r.verdict).toBe("pass");
    expect(r.rows[0]!.note).toBe("边界：无");
  });

  it("证人文件不存在 ⇒ 那行 missing，整体 incomplete（不许拿嘴报完成）", () => {
    const r = buildBotReport({ items, exists: (p) => p !== "tests/team-secrets.test.ts" });
    expect(r.rows.find((x) => x.id === "bot.b")).toMatchObject({
      status: "missing", missingWitnesses: ["tests/team-secrets.test.ts"],
    });
    expect(r.verdict).toBe("incomplete");
  });

  it("partial 也会让整体 incomplete（有边界就别说完成）", () => {
    const r = buildBotReport({
      items: [{ id: "bot.c", capability: "C", status: "partial", evidence: ["tests/segments.test.ts"] }],
      exists: () => true,
    });
    expect(r.verdict).toBe("incomplete");
    expect(r.summary.partial).toBe(1);
  });
});
