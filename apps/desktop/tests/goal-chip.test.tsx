// 目标芯片（2026-10-18）：桌面此前没有 goal 的可视/可操作面；/goal 斜杠项只塞字。
// 现在 sendWithGoal 先 setGoal 再发目标原文（首页先建会话再落目标），芯片读 traceGoal 同一份 reduce。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalChip } from "../src/renderer/components/GoalChip";
import type { GoalTrace } from "../../../src/agent/goal-trace";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const trace = (over: Partial<GoalTrace>): GoalTrace => ({
  spec: { objective: "完成一个小目标", maxTurns: 8, maxUsd: 0 },
  turn: 1, stopped: null, paused: null, at: 3, ...over,
});

describe("GoalChip", () => {
  it("运行中的目标显示原文/轮次；暂停与停止有明确状态", () => {
    const live = renderToStaticMarkup(<GoalChip trace={trace({})} onPause={() => {}} onResume={() => {}} onClear={() => {}} onDismiss={() => {}} />);
    expect(live).toContain("完成一个小目标");
    expect(live).toContain("1/8 轮");
    expect(live).toContain("目标操作");
    const paused = renderToStaticMarkup(<GoalChip trace={trace({ paused: "人暂停" })} onPause={() => {}} onResume={() => {}} onClear={() => {}} onDismiss={() => {}} />);
    expect(paused).toContain("已暂停");
    const stopped = renderToStaticMarkup(<GoalChip trace={trace({ stopped: "没有可验证产出" })} onPause={() => {}} onResume={() => {}} onClear={() => {}} onDismiss={() => {}} />);
    expect(stopped).toContain("已停止");
    expect(stopped).toContain("没有可验证产出");
  });

  it("App 接线：traceGoal、/goal 拦截、首页补建会话、隐藏已停目标", () => {
    const app = read("../src/renderer/App.tsx");
    expect(app).toContain("const goalTrace = useMemo(() => traceGoal(events), [events]);");
    expect(app).toContain("const cmd = parseGoalCommand(text);");
    expect(app).toContain("pendingGoal.current = cmd;");
    expect(app).toContain("window.agent.setGoal({ sessionId: newId, objective: goalCmd.objective");
    expect(app).toContain("const next = new Map(prev).set(sid, goalTrace.at);");
    expect(app).toContain("writeDismissedGoals(next);");
    expect(app).toContain("dismissedGoals.get(activeId ?? \"\") !== goalTrace.at");
  });
});
