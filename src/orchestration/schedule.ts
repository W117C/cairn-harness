import type { FlowTask, OrchestrationView, PlanView, ScheduleAction, TaskView } from "./types";

const terminal = (task: TaskView) => ["done", "failed", "cancelled"].includes(task.phase);
const live = (task: TaskView) => !!task.run_id && !terminal(task) && task.phase !== "paused";
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Single source for the dependency failure reason; tests import it instead of copying prose. */
export const DEPENDENCY_ESCALATION_REASON = "dependency failed, was cancelled or requires user action";
const order = (a: TaskView, b: TaskView) => b.task.priority - a.task.priority || compare(a.task.task_id, b.task.task_id);

function prefix(scope: string): string {
  const normalized = scope.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === ".") return "";
  const wildcard = normalized.search(/[?*[{(]/);
  return wildcard < 0 ? normalized : normalized.slice(0, wildcard);
}

export function writeScopesConflict(a: FlowTask, b: FlowTask): boolean {
  if (a.lane === "read" || b.lane === "read") return false;
  if (a.lane === "external" || b.lane === "external" || !a.write_scopes.length || !b.write_scopes.length) return true;
  // ponytail: literal-prefix overlap deliberately over-serializes ambiguous globs;
  // a complete glob-language intersection is only needed if this limits measured throughput.
  return a.write_scopes.some(left => b.write_scopes.some(right => {
    const l = prefix(left), r = prefix(right);
    return !l || !r || l.startsWith(r) || r.startsWith(l);
  }));
}

/** Deterministic suggestions. Only durable kernel events may reserve or execute them. */
export function nextActions(view: OrchestrationView, options: { max_concurrency?: number; now?: number } = {}): ScheduleAction[] {
  const actions: ScheduleAction[] = [];
  const now = options.now ?? view.now;
  const plans = Object.values(view.plans).sort((a, b) =>
    Object.values(a.tasks).reduce((n, t) => n + t.attempt, 0) - Object.values(b.tasks).reduce((n, t) => n + t.attempt, 0) ||
    compare(a.plan.plan_id, b.plan.plan_id));
  const active = plans.flatMap(p => Object.values(p.tasks).filter(live));
  const held = active.map(task => task.task);
  const cap = options.max_concurrency === undefined ? 4 : Number.isSafeInteger(options.max_concurrency) && options.max_concurrency > 0 ? options.max_concurrency : 0;
  let slots = Math.max(0, cap - active.length);
  let deliveryScheduled = active.some(task => task.phase === "merging");
  const emit = (kind: ScheduleAction["kind"], plan: PlanView, task: TaskView, reason?: string) => {
    actions.push({ kind, plan_id: plan.plan.plan_id, version: plan.plan.version, task_id: task.task.task_id, ...(reason ? { reason } : {}) });
  };
  const candidates = new Map<PlanView, TaskView[]>();
  const used = new Map<PlanView, number>();
  const remaining = new Map<PlanView, number>();

  for (const plan of plans) {
    const tasks = Object.values(plan.tasks).sort(order);
    const count = tasks.filter(live).length;
    used.set(plan, count);
    remaining.set(plan, plan.plan.budget.usd - plan.spent_usd - plan.reserved_usd);
    const ready: TaskView[] = [];
    const overBudget = plan.spent_usd + plan.reserved_usd > plan.plan.budget.usd + 1e-9 || tasks.some(task => task.spent_usd > task.task.budget.usd + 1e-9);
    for (const task of tasks) {
      if (live(task)) {
        if (plan.phase === "cancelled") emit("cancel", plan, task, "plan cancelled; confirm the previous executor stopped");
        else if (task.lease_expires_at !== undefined && task.lease_expires_at <= now) emit("cancel", plan, task, "lease expired; confirm the previous executor stopped");
        else if (plan.phase === "approved" && !overBudget && task.phase === "verifying") {
          if (task.evidence === "failed" || task.verdict === "fail" || task.verdict === "unverifiable") emit("escalate", plan, task, "verification failed or is unverifiable");
          else if (task.evidence === "verified" && task.verdict === "pass" && task.verifier_id && task.verifier_id !== (task.producer_id ?? task.agent_id) && task.revision) {
            if (!deliveryScheduled) { emit("merge", plan, task); deliveryScheduled = true; }
          } else if (!task.verdict) emit("verify", plan, task);
          else emit("escalate", plan, task, "verification lacks fresh contract evidence");
        }
        continue;
      }
      if (plan.phase !== "approved" || ["paused", "needs_you", "done", "cancelled"].includes(task.phase)) continue;
      if (overBudget) { emit("escalate", plan, task, "plan budget exceeded"); continue; }
      if (task.phase === "failed") { emit("escalate", plan, task, "task failed; explicit retry or takeover required"); continue; }
      if (!["planned", "queued"].includes(task.phase)) continue;
      const dependencies = task.task.depends_on.map(id => plan.tasks[id]);
      if (dependencies.some(dep => !dep || ["failed", "cancelled", "needs_you"].includes(dep.phase))) {
        emit("escalate", plan, task, DEPENDENCY_ESCALATION_REASON); continue;
      }
      if (dependencies.some(dep => dep.phase !== "done")) continue;
      if (task.task.deadline_ms !== undefined && task.task.deadline_ms <= now) { emit("escalate", plan, task, "task deadline exceeded"); continue; }
      if (task.attempt >= task.task.max_attempts) { emit("escalate", plan, task, "attempt limit reached"); continue; }
      ready.push(task);
    }
    candidates.set(plan, ready);
  }
  // One candidate per plan per pass gives a large plan no monopoly on free slots.
  let progress = true;
  while (slots > 0 && progress) {
    progress = false;
    for (const plan of plans) {
      if (slots <= 0) break;
      const ready = candidates.get(plan)!;
      if ((used.get(plan) ?? 0) >= plan.plan.max_concurrency || !ready?.length) continue;
      while (ready.length) {
        const task = ready.shift()!;
        const reservation = task.task.budget.usd - task.spent_usd;
        if (reservation <= 0 || reservation > remaining.get(plan)! + 1e-9) { emit("escalate", plan, task, "insufficient task or plan budget"); continue; }
        if (held.some(other => writeScopesConflict(task.task, other))) continue;
        emit("dispatch", plan, task);
        remaining.set(plan, remaining.get(plan)! - reservation);
        used.set(plan, used.get(plan)! + 1);
        held.push(task.task);
        slots--; progress = true;
        break;
      }
    }
  }
  return actions;
}
