// 状态条那一格的文案（2026-10-20 独立评审追出的 MEDIUM-HIGH 的修法这一半）。
//
// 缺陷形状：`finishing`（收尾中）的第二个条件是 `answerQuiet`（正文停了 >1.5s）——
// 而那**恰好是"工具在跑"的形状**（模型吐完字就调工具，然后等着它跑完）⇒
// 任何超过 1.5s 的构建/测试都被报成"收尾中"，而 agent 还在干活。
// 那条注释自己写着「读错比不读更坏」——报错的相位比不报更坏。
//
// 修法：文案口径搬进 `projections.runPhaseLabel`（纯函数）⇒ 判卷可以**行为**地钉它，
// 不用钉源码里那串三元表达式（钉字面量＝判据追着实现跑）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runPhaseLabel } from "../src/renderer/projections";

const base = { phase: "idle" as const, stopped: false, running: false, hasAnswerText: false, answerQuiet: false };

describe("状态条文案（runPhaseLabel）", () => {
  it("工具在跑 ⇒ 「执行工具」（哪怕正文早就停了 >1.5s）", () => {
    // 这一格是那批缺陷本体：旧实现这里给"收尾中"。
    expect(runPhaseLabel({ ...base, phase: "tool", running: true, hasAnswerText: true, answerQuiet: true }))
      .toBe("执行工具");
    expect(runPhaseLabel({ ...base, phase: "tool", running: true, hasAnswerText: true, answerQuiet: false }))
      .toBe("执行工具");
  });

  it("正文停了而 run 还在（相位已回 idle）⇒ 「收尾中」", () => {
    expect(runPhaseLabel({ ...base, phase: "idle", running: true, hasAnswerText: true, answerQuiet: true }))
      .toBe("收尾中");
    expect(runPhaseLabel({ ...base, phase: "idle", running: true, hasAnswerText: true, answerQuiet: false }))
      .toBe("收尾中");
  });

  it("三道门在场 ⇒ 各自的等待文案（最高优先于收尾/执行）", () => {
    expect(runPhaseLabel({ ...base, phase: "ask", running: true, hasAnswerText: true, answerQuiet: true })).toBe("等待审批");
    expect(runPhaseLabel({ ...base, phase: "clarify", running: true, hasAnswerText: true })).toBe("等待澄清");
    expect(runPhaseLabel({ ...base, phase: "plan", running: true, hasAnswerText: true })).toBe("等待方案");
  });

  it("已停止 ⇒ 「已停止」（压过一切）", () => {
    expect(runPhaseLabel({ ...base, stopped: true, running: true, phase: "tool", hasAnswerText: true })).toBe("已停止");
  });

  it("思考中：有正文 ⇒ 「生成中」；没有 ⇒ 「思考中」；run 在但没正文 ⇒ 「思考中」", () => {
    expect(runPhaseLabel({ ...base, phase: "thinking", running: true, hasAnswerText: true })).toBe("生成中");
    expect(runPhaseLabel({ ...base, phase: "thinking", running: true, hasAnswerText: false })).toBe("思考中");
    expect(runPhaseLabel({ ...base, phase: "idle", running: true, hasAnswerText: false })).toBe("思考中");
    expect(runPhaseLabel({ ...base })).toBe("就绪");
  });

  it("接线：App 用的是这一个函数（别在 App 里另写一份三元链）", () => {
    const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
    expect(app).toContain("runPhaseLabel({ phase, stopped, running: runningActive, hasAnswerText, answerQuiet })");
    expect(app, "App 里不该再留一份自己的文案三元链").not.toContain('finishing ? "收尾中"');
  });
});
