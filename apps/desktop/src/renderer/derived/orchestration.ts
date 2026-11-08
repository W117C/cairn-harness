// 编排控制面的可用动作：镜像引擎 engine.control() 的合法转移表，别让面板出现「必然被拒」的按钮。
// 事实源是 `src/orchestration/engine.ts` 的 phases 表与终态守卫；这里只做投影，不新增规则。
// 手动合并/拒绝交付在引擎里恒被拒（交付由验证队列控制）⇒ 面板永不出这两个动作。
import type {
  AcceptanceCheck, ArtifactRef, Contract, ControlAction, EvidenceState, FlowTask, PlanPhase, PlanView,
  ScheduleAction, TaskPhase, TaskView, Verdict,
} from "../../../../../src/orchestration/types";

import { verificationLabel } from "./verification-labels";

export interface OrchestrationControl {
  action: ControlAction;
  label: string;
  /** 会改写用户文件或终止进行中的工作：面板必须二次确认。 */
  confirm?: boolean;
}

export interface PlanExecutionContext {
  mode: "shadow" | "execute";
  backend: string | null;
  executionUnavailable?: boolean | undefined;
}

export interface TaskCapabilities {
  rollback: boolean;
}

const TERMINAL: ReadonlySet<TaskPhase> = new Set(["done", "failed", "cancelled"]);

export function planControls(plan: PlanView): OrchestrationControl[] {
  switch (plan.phase) {
    case "proposed":
      return [
        { action: "approve_plan", label: "批准" },
        { action: "reject_plan", label: "拒绝" },
        { action: "cancel_plan", label: "取消计划", confirm: true },
      ];
    case "approved":
      return [
        { action: "pause_plan", label: "暂停计划" },
        { action: "cancel_plan", label: "取消计划", confirm: true },
      ];
    case "paused":
      return [
        { action: "resume_plan", label: "恢复计划" },
        { action: "cancel_plan", label: "取消计划", confirm: true },
      ];
    default:
      return [];
  }
}

export function taskControls(task: TaskView, capabilities: TaskCapabilities): OrchestrationControl[] {
  if (TERMINAL.has(task.phase)) {
    // 终态只留「再试一次」与「回滚」；暂停/取消/接管在引擎里都被终态守卫拒绝。
    const controls: OrchestrationControl[] = [];
    if ((task.phase === "failed" || task.phase === "cancelled")
      && task.attempt < task.task.max_attempts) controls.push({ action: "retry_task", label: "重试任务" });
    // 回滚要同时满足：已有交付修订的 run（引擎按 run_id 找回滚记录）+ 后端声明支持。
    if (task.phase === "done" && task.run_id !== undefined && capabilities.rollback) {
      controls.push({ action: "rollback_task", label: "回滚改动", confirm: true });
    }
    return controls;
  }
  const controls: OrchestrationControl[] = [];
  if (task.phase === "needs_you" && task.attempt < task.task.max_attempts) {
    controls.push({ action: "retry_task", label: "重试任务" });
  }
  if (task.phase === "paused" || task.reason === "paused by user") {
    controls.push({ action: "resume_task", label: "恢复任务" });
  }
  // 接管把任务交还给人：只对「没有活执行器」的任务有意义（引擎同口径）。
  const live = task.run_id !== undefined && task.phase !== "paused";
  if (task.phase === "needs_you" || !live) controls.push({ action: "takeover_task", label: "接管任务" });
  if (task.phase !== "paused" && task.reason !== "paused by user") {
    controls.push({ action: "pause_task", label: "暂停任务" });
  }
  controls.push({ action: "cancel_task", label: "取消任务", confirm: true });
  return controls;
}

export function canEnableExecution(plan: PlanView, context: PlanExecutionContext): boolean {
  return context.mode === "shadow" && context.backend !== null
    && plan.phase === "approved" && context.executionUnavailable !== true;
}

const PLAN_PHASE_LABEL: Record<PlanPhase, string> = {
  proposed: "待批准", approved: "已批准", paused: "已暂停", cancelled: "已取消", rejected: "已拒绝",
};
const TASK_PHASE_LABEL: Record<TaskPhase, string> = {
  planned: "待调度", queued: "排队中", running: "执行中", verifying: "验证中", merging: "交付中",
  done: "已完成", failed: "失败", cancelled: "已取消", paused: "已暂停", needs_you: "需你处理",
};
const VERDICT_LABEL: Record<Verdict, string> = { pass: "通过", fail: "未通过", unverifiable: "无法验证" };

export const planPhaseLabel = (phase: PlanPhase): string => PLAN_PHASE_LABEL[phase];
export const taskPhaseLabel = (phase: TaskPhase): string => TASK_PHASE_LABEL[phase];
export const evidenceLabel = (evidence: EvidenceState): string => verificationLabel(evidence);
export const verdictLabel = (verdict: Verdict | undefined): string => verdict === undefined ? "未知" : VERDICT_LABEL[verdict];

const LANE_LABEL: Record<FlowTask["lane"], string> = { read: "只读", write: "写入", external: "外部" };
const EFFECT_LABEL: Record<Contract["effect"], string> = { none: "无", workspace: "工作区", external: "外部" };
const ACCEPTANCE_LABEL: Record<AcceptanceCheck["kind"], string> = { evidence: "证据", human: "人工", command: "命令", artifact: "产物" };
const ARTIFACT_LABEL: Record<ArtifactRef["kind"], string> = { file: "文件", blob: "二进制", json: "JSON", url: "链接" };
const SCHEDULE_LABEL: Record<ScheduleAction["kind"], string> = { dispatch: "派发", verify: "验证", merge: "合并", cancel: "取消", escalate: "升级" };

/** 引擎与调度器写进事件的原因原句。未知原句原样透出——宁可显示英文，也不编一句没发生的话。 */
const REASON_LABEL: Record<string, string> = {
  "budget exceeded": "超出预算",
  "paused by user": "已由你暂停",
  "taken over by user": "已由你接管",
  "merge rejected": "交付被拒绝",
  "rolled back": "已回滚",
  "plan cancelled; confirm the previous executor stopped": "计划已取消；请确认上一个执行器已停止",
  "lease expired; confirm the previous executor stopped": "租约过期；请确认上一个执行器已停止",
  "verification failed or is unverifiable": "验证未通过或无法验证",
  "verification lacks fresh contract evidence": "验证缺少最新的契约证据",
  "plan budget exceeded": "计划预算已超",
  "task failed; explicit retry or takeover required": "任务失败；需要显式重试或接管",
  "dependency failed, was cancelled or requires user action": "依赖失败、被取消或需要你处理",
  "task deadline exceeded": "任务已超时",
  "attempt limit reached": "已达到尝试次数上限",
  "insufficient task or plan budget": "任务或计划预算不足",
};

export const laneLabel = (lane: FlowTask["lane"]): string => LANE_LABEL[lane];
export const effectLabel = (effect: Contract["effect"]): string => EFFECT_LABEL[effect];
export const acceptanceLabel = (kind: AcceptanceCheck["kind"]): string => ACCEPTANCE_LABEL[kind];
export const artifactKindLabel = (kind: ArtifactRef["kind"]): string => ARTIFACT_LABEL[kind];
export const scheduleKindLabel = (kind: ScheduleAction["kind"]): string => SCHEDULE_LABEL[kind];
export function reasonLabel(reason: string | undefined): string {
  if (reason === undefined || reason === "") return "";
  return REASON_LABEL[reason] ?? reason;
}
