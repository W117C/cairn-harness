// 目标漂移判据的两向判卷（M4 交付物的一部分）。
//
// 口径写在 `src/agent/goal-drift.ts` 的模块头（三族算数 / 实现层措辞不算）。
// 判卷钉的是这条判据**两向都成立**：
//   · 负向：**真实跑出来的长任务**（26–28 轮、20 个 bug、跑了两遍）一条都不许报；
//   · 正向：三族各造一条必须报得出且**指名到族**；
//   · 精度：实现层措辞（"把 clamp 改为 sum" / "only change this line"）一条都不许报
//     —— 这条比正向更重要：把干活读成改口，读数就成了噪声。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assistantTurnsFromEvents, goalDriftCell, goalDriftFindings } from "../src/agent/goal-drift";

describe("接线面：goal-drift 不是孤儿模块（2026-10-02 接进 runAgent 收束路径）", () => {
  // 动因：全树 import 扫描实测 `src/agent/goal-drift.ts` 在 `src/` 内**零消费者**，
  // 门里也没有人消费它（只有本文件引用）⇒ 能力 4「长任务不遗忘」的真读数
  // 永远只有单测证据、没有任何运行证据。这条断言钉住那半条接线。
  //
  // 为什么按**文本**钉而不是 import 图扫描：本仓记忆规则 79——按行的正则判据会把注释里的
  // 示例当代码，而 AST 扫一遍 2761 行文件的 import 图成本远高于它挡住的回归。
  // 这里刻意只认 `import {` 那一行（真 import），不认注释里出现的函数名。
  const runner = readFileSync(resolve(import.meta.dirname, "../src/main/agent-runner.ts"), "utf8");
  // 判据调用点只找一次：后两条用例都要它的位置，魔法串抄两遍只会让两处各自漂。
  const driftCallIdx = runner.indexOf("goalDriftFindings(assistantTurnsFromEvents(");

  it("agent-runner 真 import 了 goal-drift 的判据（不是抄第二份）", () => {
    const imp = runner.match(/^import \{[^}]*\} from "\.\.\/agent\/goal-drift";$/m);
    expect(imp, "agent-runner 必须 import goal-drift 的现成判据").not.toBeNull();
    // 三件都要：重组、取命中、读数措辞。少任一件都说明有支路在另拼一套。
    expect(imp?.[0]).toContain("assistantTurnsFromEvents");
    expect(imp?.[0]).toContain("goalDriftFindings");
    expect(imp?.[0]).toContain("goalDriftCell");
  });

  it("读数点落在 runAgent 的收束路径上（runLoop 跑完之后、返回事件之前）", () => {
    expect(driftCallIdx, "runAgent 里必须真调一次判据").toBeGreaterThan(-1);
    // 收束在runLoop 之后：调用点必须在 runLoop 调用点之后
    const loopIdx = runner.lastIndexOf("runLoop(");
    expect(loopIdx).toBeGreaterThan(-1);
    expect(driftCallIdx).toBeGreaterThan(loopIdx);
  });

  it("取不到读数时必须出声，不许静默（静默会把「没量到」读成「没漂移」）", () => {
    expect(driftCallIdx).toBeGreaterThan(-1);
    const seg = runner.slice(driftCallIdx - 400, driftCallIdx + 800);
    expect(seg).toContain("catch");
    expect(seg).toContain("console.warn");
  });
});
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
