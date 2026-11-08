import { describe, expect, it } from "vitest";
import {
  acceptanceLabel, artifactKindLabel, canEnableExecution, effectLabel, evidenceLabel, laneLabel, planControls,
  planPhaseLabel, reasonLabel, scheduleKindLabel, taskControls, taskPhaseLabel, verdictLabel,
} from "../src/renderer/derived/orchestration";
import type { PlanPhase, PlanView, TaskView } from "../../../src/orchestration/types";
import { orchestrationPlan } from "../../../tests/orchestration-fixture";

function task(phase: TaskView["phase"], overrides: Partial<TaskView> = {}): TaskView {
  const plan = orchestrationPlan();
  return { task: plan.tasks[0]!, phase, attempt: 0, evidence: "absent", spent_usd: 0, reserved_usd: 0, ...overrides };
}

function plan(phase: PlanPhase, tasks: Record<string, TaskView> = {}): PlanView {
  return { plan: orchestrationPlan(), phase, tasks, spent_usd: 0, reserved_usd: 0, source_event_id: 1 };
}

const actionsOf = (taskView: TaskView, rollback = false): string[] => taskControls(taskView, { rollback }).map(c => c.action);

describe("plan controls mirror the engine's transition table", () => {
  it("offers approve/reject only while proposed, and cancel everywhere non-terminal", () => {
    expect(planControls(plan("proposed")).map(c => c.action)).toEqual(["approve_plan", "reject_plan", "cancel_plan"]);
    expect(planControls(plan("approved")).map(c => c.action)).toEqual(["pause_plan", "cancel_plan"]);
    expect(planControls(plan("paused")).map(c => c.action)).toEqual(["resume_plan", "cancel_plan"]);
    expect(planControls(plan("cancelled"))).toEqual([]);
    expect(planControls(plan("rejected"))).toEqual([]);
  });

  it("marks destructive plan controls for confirmation", () => {
    expect(planControls(plan("proposed")).filter(c => c.confirm === true).map(c => c.action)).toEqual(["cancel_plan"]);
    expect(planControls(plan("approved")).filter(c => c.confirm === true).map(c => c.action)).toEqual(["cancel_plan"]);
  });
});

describe("task controls never offer an action the engine refuses", () => {
  it("never offers manual merge or reject delivery", () => {
    for (const phase of ["planned", "queued", "running", "verifying", "merging", "done", "failed", "cancelled", "paused", "needs_you"] as const) {
      const actions = actionsOf(task(phase, { run_id: "run-1", attempt: 1 }), true);
      expect(actions).not.toContain("merge_task");
      expect(actions).not.toContain("reject_merge");
    }
  });

  it("offers pause/cancel while a task owns a live run, and no takeover", () => {
    expect(actionsOf(task("running", { run_id: "run-1" }))).toEqual(["pause_task", "cancel_task"]);
    expect(actionsOf(task("verifying", { run_id: "run-1" }))).toEqual(["pause_task", "cancel_task"]);
  });

  it("offers takeover only when no live executor owns the task", () => {
    expect(actionsOf(task("planned"))).toEqual(["takeover_task", "pause_task", "cancel_task"]);
    expect(actionsOf(task("paused"))).toEqual(["resume_task", "takeover_task", "cancel_task"]);
    expect(actionsOf(task("needs_you", { attempt: 1 }))).toEqual(["retry_task", "takeover_task", "pause_task", "cancel_task"]);
  });

  it("resumes when paused by the user, and does not offer pause twice", () => {
    expect(actionsOf(task("running", { run_id: "run-1", reason: "paused by user" }))).toEqual(["resume_task", "cancel_task"]);
  });

  it("keeps retry bounded by the remaining attempt budget", () => {
    expect(actionsOf(task("failed", { attempt: 1 }))).toEqual(["retry_task"]);
    expect(actionsOf(task("failed", { attempt: 2 }))).toEqual([]);
    expect(actionsOf(task("cancelled", { attempt: 0 }))).toEqual(["retry_task"]);
    expect(actionsOf(task("needs_you", { attempt: 2 }))).toEqual(["takeover_task", "pause_task", "cancel_task"]);
  });

  it("rolls back only a delivered run with backend support", () => {
    expect(actionsOf(task("done", { run_id: "run-1" }), true)).toEqual(["rollback_task"]);
    expect(actionsOf(task("done", { run_id: "run-1" }), false)).toEqual([]);
    expect(actionsOf(task("done"), true)).toEqual([]);
    expect(taskControls(task("done", { run_id: "run-1" }), { rollback: true })[0]?.confirm).toBe(true);
  });

  it("offers nothing on failed/cancelled tasks beyond retry", () => {
    expect(actionsOf(task("done", { run_id: "run-1" }))).toEqual([]);
    expect(actionsOf(task("cancelled", { attempt: 2 }))).toEqual([]);
  });
});

describe("execution stays a separate, explicit step", () => {
  const context = { mode: "shadow" as const, backend: "local", executionUnavailable: false };
  it("enables execution only for an approved plan in shadow mode with a backend", () => {
    expect(canEnableExecution(plan("approved"), context)).toBe(true);
    expect(canEnableExecution(plan("proposed"), context)).toBe(false);
    expect(canEnableExecution(plan("approved"), { ...context, mode: "execute" })).toBe(false);
    expect(canEnableExecution(plan("approved"), { ...context, backend: null })).toBe(false);
    expect(canEnableExecution(plan("approved"), { ...context, executionUnavailable: true })).toBe(false);
  });
});

describe("phase labels keep machine codes available", () => {
  it("translates every plan and task phase", () => {
    const planPhases = ["proposed", "approved", "paused", "cancelled", "rejected"] as const;
    expect(planPhases.map(planPhaseLabel)).toEqual(["待批准", "已批准", "已暂停", "已取消", "已拒绝"]);
    const taskPhases = ["planned", "queued", "running", "verifying", "merging", "done", "failed", "cancelled", "paused", "needs_you"] as const;
    expect(taskPhases.map(taskPhaseLabel)).toEqual(["待调度", "排队中", "执行中", "验证中", "交付中", "已完成", "失败", "已取消", "已暂停", "需你处理"]);
  });
  it("translates evidence and verdict, and leaves unknown verdict unknown", () => {
    expect(["verified", "failed", "stale", "absent"].map(e => evidenceLabel(e as never))).toEqual(["已验证", "验证失败", "证据已过期", "未验证"]); // 第 944 页：stale 与交付卡同词
    expect([verdictLabel("pass"), verdictLabel("fail"), verdictLabel("unverifiable"), verdictLabel(undefined)]).toEqual(["通过", "未通过", "无法验证", "未知"]);
  });

  it("translates lanes, effects, acceptance kinds, artifacts and schedule kinds", () => {
    expect((["read", "write", "external"] as const).map(laneLabel)).toEqual(["只读", "写入", "外部"]);
    expect((["none", "workspace", "external"] as const).map(effectLabel)).toEqual(["无", "工作区", "外部"]);
    expect((["evidence", "human", "command", "artifact"] as const).map(acceptanceLabel)).toEqual(["证据", "人工", "命令", "产物"]);
    expect((["file", "blob", "json", "url"] as const).map(artifactKindLabel)).toEqual(["文件", "二进制", "JSON", "链接"]);
    expect((["dispatch", "verify", "merge", "cancel", "escalate"] as const).map(scheduleKindLabel)).toEqual(["派发", "验证", "合并", "取消", "升级"]);
  });

  it("translates the engine's own reasons and passes unknown prose through verbatim", () => {
    expect(reasonLabel("paused by user")).toBe("已由你暂停");
    expect(reasonLabel("taken over by user")).toBe("已由你接管");
    expect(reasonLabel("merge rejected")).toBe("交付被拒绝");
    expect(reasonLabel("rolled back")).toBe("已回滚");
    expect(reasonLabel("plan cancelled; confirm the previous executor stopped")).toBe("计划已取消；请确认上一个执行器已停止");
    expect(reasonLabel("dependency failed, was cancelled or requires user action")).toBe("依赖失败、被取消或需要你处理");
    expect(reasonLabel("upstream provider returned 529")).toBe("upstream provider returned 529");
    expect(reasonLabel(undefined)).toBe("");
    expect(reasonLabel("")).toBe("");
  });
});
