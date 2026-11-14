
import { describe, expect, it } from "vitest";
import { runPhaseLabel } from "../src/renderer/projections";
import { readAppSurface } from "./helpers/app-surface";

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
    const app = readAppSurface();
    expect(app).toContain("runPhaseLabel({ phase, stopped, running: runningActive, hasAnswerText, answerQuiet })");
    expect(app, "App 里不该再留一份自己的文案三元链").not.toContain('finishing ? "收尾中"');
  });
});
