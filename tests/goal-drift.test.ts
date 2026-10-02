// 目标漂移判据的两向判卷（M4 交付物的一部分）。
//
// 口径写在 `src/agent/goal-drift.ts` 的模块头（三族算数 / 实现层措辞不算）。
// 判卷钉的是这条判据**两向都成立**：
//   · 负向：**真实跑出来的长任务**（26–28 轮、20 个 bug、跑了两遍）一条都不许报；
//   · 正向：三族各造一条必须报得出且**指名到族**；
//   · 精度：实现层措辞（"把 clamp 改为 sum" / "only change this line"）一条都不许报
//     —— 这条比正向更重要：把干活读成改口，读数就成了噪声。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assistantTurnsFromEvents, goalDriftCell, goalDriftFindings } from "../src/agent/goal-drift";
import type { AgentEvent } from "../src/events";

const ROOT = process.cwd();
const load = (name: string): AgentEvent[] =>
  readFileSync(join(ROOT, "fixtures", "goal-drift", name), "utf8")
    .trim().split("\n").filter((l) => l !== "")
    .map((l) => JSON.parse(l) as AgentEvent);

describe("目标漂移判据（M4）：两向都要成立", () => {
  it("负向 · 真实长跑两遍：一处都不报（误报是这条能力的头号成本）", () => {
    for (const f of ["real-long-run-B12.events.jsonl", "real-long-run-B12b.events.jsonl"]) {
      const turns = assistantTurnsFromEvents(load(f));
      // 取料自检：真实跑里模型输出**只有 assistant_delta**（0 个 assistant_message）
      // ⇒ 若这里退化成 0 段，判据会恒得 0 条，那是"没量到"被读成"没漂移"。
      expect(turns.length, `${f} 没重组出任何正文段 ⇒ 这一格是"没量到"不是"零漂移"`).toBeGreaterThan(0);
      expect(goalDriftFindings(turns), `${f} 误报：${goalDriftCell(goalDriftFindings(turns))}`).toEqual([]);
    }
  });

  it("正向 · 三族各报一条，且指名到族", () => {
    const turns = [
      "我先把 A 修好。",                                            // 0 正常推进
      "范围要收窄一下：这次改目标。只修核心那几个就够，其余先不做。",      // 1 A + B（照口径原话写）
      "其实我们要的是把导出那块也修了，我理解错了真正要的是全绿。",        // 2 C
    ];
    const got = goalDriftFindings(turns);
    const rules = new Set(got.map((g) => g.rule));
    expect(rules.has("A:scope-noun-change")).toBe(true);
    expect(rules.has("B:quantifier-narrowing")).toBe(true);
    expect(rules.has("C:goal-replacement")).toBe(true);
    // 指回现场：每条都带原文片段与段号，不是"你好像改口了"
    expect(got.every((g) => g.quote.length > 0 && g.turn >= 1)).toBe(true);
    expect(goalDriftCell(got)).toContain("目标漂移");
  });

  it("精度 · 实现层措辞一条都不许报（把干活读成改口＝噪声发生器）", () => {
    const turns = [
      "I'll change clamp to sum in m01-clamp.js.",                  // 实现层：改的是函数
      "Only change this line and rerun the test.",                  // 实现层：改一行
      "Let me switch the switch statement to a lookup table.",       // 实现层
      "接下来继续修 m02，还有 18 个没修。",                            // 正常推进
      "这 20 个 bug 没有共同根因，逐个修。",                           // 任务书原文复述
    ];
    expect(goalDriftFindings(turns)).toEqual([]);
  });

  it("英文也要认（真实跑的模型是用英文回答的）——只写中文规则会静默 0 命中", () => {
    const got = goalDriftFindings(["Actually the real goal is to make the export path green."]);
    expect(got.map((g) => g.rule)).toContain("C:goal-replacement");
  });
});
