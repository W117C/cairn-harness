// 会话代价读数（`scripts/session-cost.ts`）的判卷（2026-09-30 P2）。
//
// 为什么这把尺自己要有判卷：它存在的唯一理由是「别把缓存命中读成变贵」——
// 而 P2 那次改动正好踩在这个形状上：
//   distill 轮 cacheRead 181 → 8,010（命中率 2.2% → 98.8%），input 总量 4,417 → 8,116。
//   只看原始 input 会得出「变贵了」的相反结论；折成有效价才是 4,254 → 907。
// 尺子算错的话，后面每一次优化都会照着错的方向走。
import { describe, expect, it } from "vitest";
import { sessionCostFromJsonl } from "../scripts/session-cost";

/** 造一段会话 JSONL：usage 事件以外的行也要有（尺子只认 usage，别的必须被忽略）。 */
function jsonl(usages: { in: number; cache: number; out: number }[]): string {
  const lines: string[] = [JSON.stringify({ type: "user_message", content: "任务" })];
  for (const u of usages) {
    lines.push(JSON.stringify({ type: "tool_call", name: "read_file" }));
    lines.push(JSON.stringify({
      type: "usage", inputTokens: u.in, cacheReadInputTokens: u.cache, outputTokens: u.out,
    }));
  }
  return lines.join("\n") + "\n";
}

describe("sessionCostFromJsonl：有效输入才是可比的量", () => {
  it("命中部分按折扣、未命中部分全价（折扣 0.1 时：100 全命中 = 10）", () => {
    const c = sessionCostFromJsonl(jsonl([{ in: 100, cache: 100, out: 5 }]));
    expect(c.input).toBe(100);
    expect(c.cacheRead).toBe(100);
    expect(c.effectiveInput).toBeCloseTo(10, 6);
  });

  it("折扣是约定值，可传：同样一份日志在 0.5 折下算出的有效价更高", () => {
    const text = jsonl([{ in: 100, cache: 100, out: 5 }]);
    expect(sessionCostFromJsonl(text, 0.1).effectiveInput).toBeCloseTo(10, 6);
    expect(sessionCostFromJsonl(text, 0.5).effectiveInput).toBeCloseTo(50, 6);
  });

  it("★ 本轮那个反直觉形状：命中率升、原始 input 也升，但有效价降", () => {
    // 改前：小 payload、几乎不命中
    const before = sessionCostFromJsonl(jsonl([{ in: 4417, cache: 181, out: 152 }]));
    // 改后：payload 变大（带上了与主会话同形的前缀）、但几乎全命中
    const after = sessionCostFromJsonl(jsonl([{ in: 8116, cache: 8010, out: 45 }]));
    expect(after.input).toBeGreaterThan(before.input); // 原始量确实变大了
    expect(after.cacheHitRate).toBeGreaterThan(before.cacheHitRate); // 命中率也确实升了
    expect(after.effectiveInput).toBeLessThan(before.effectiveInput); // 但有效价是降的
  });

  it("最后一轮 usage 判为沉淀轮，其余判为主轮（口径要能分开算）", () => {
    const c = sessionCostFromJsonl(jsonl([
      { in: 100, cache: 0, out: 1 },
      { in: 200, cache: 0, out: 2 },
      { in: 300, cache: 0, out: 3 },
    ]));
    expect(c.rounds.map((r) => r.kind)).toEqual(["main", "main", "distill"]);
    expect(c.rounds.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it("非 usage 事件不进读数（tool_call / user_message 一律忽略）", () => {
    const c = sessionCostFromJsonl(jsonl([{ in: 10, cache: 0, out: 1 }]));
    expect(c.rounds).toHaveLength(1);
    expect(c.input).toBe(10);
  });

  it("空会话 / 无 usage：全零且命中率不炸（除零要有定义）", () => {
    const c = sessionCostFromJsonl(JSON.stringify({ type: "user_message", content: "空" }) + "\n");
    expect(c.rounds).toHaveLength(0);
    expect(c.input).toBe(0);
    expect(c.cacheHitRate).toBe(0);
    expect(c.effectiveInput).toBe(0);
  });

  it("缺字段按 0 算（坏行不许把尺子带崩）", () => {
    const c = sessionCostFromJsonl(JSON.stringify({ type: "usage" }) + "\n");
    expect(c.rounds).toHaveLength(1);
    expect(c.rounds[0]!.input).toBe(0);
    expect(c.effectiveInput).toBe(0);
  });
});
