import type { AgentEvent, CardActionEvent, VerifyResultEvent } from "../events/types";
import { writeScopesConflict } from "./schedule";
import { parsePlan } from "./validate";
import type { ControlAction, OrchestrationStamp, OrchestrationView, PlanView, TaskView } from "./types";

const terminal = (task: TaskView) => ["done", "failed", "cancelled"].includes(task.phase);
const live = (task: TaskView) => !!task.run_id && !terminal(task);
const money = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined;
const taskControls = new Set<ControlAction>(["pause_task", "resume_task", "cancel_task", "takeover_task", "retry_task", "merge_task", "reject_merge", "rollback_task"]);
interface PendingControl { event_id: number; event: CardActionEvent; stamp: OrchestrationStamp; }

function freshPass(event: VerifyResultEvent, stamp: OrchestrationStamp, task: TaskView): boolean {
  if (stamp.verdict !== "pass" || !event.ok || !stamp.verifier_id || stamp.verifier_id === (task.producer_id ?? task.agent_id) ||
      !stamp.revision || stamp.revision !== task.revision || !stamp.checks?.length || !task.task.contract.acceptance.length) return false;
  const checks = new Map(stamp.checks.map(check => [check.id, check]));
  if (checks.size !== stamp.checks.length || stamp.checks.some(check => check.verdict !== "pass" || !check.detail?.trim())) return false;
  return task.task.contract.acceptance.every(check => {
    if (checks.get(check.id)?.verdict !== "pass") return false;
    return check.kind !== "command" || (Array.isArray(event.results) && event.results.some(result => result.command === check.run && result.ok && result.exitCode === 0 && !result.cause));
  });
}

/** Replay is intentionally pure: no wall clock, IO, retries or execution authority. */
export function projectOrchestration(events: readonly AgentEvent[]): OrchestrationView {
  const view: OrchestrationView = { plans: {}, anomalies: [], last_event_id: events.length, now: 0 };
  const requests = new Map<string, PendingControl>();
  const finishedControls = new Set<string>();
  const receipts = new Set<string>();
  const runs = new Set<string>();
  const anomaly = (id: number, reason: string) => { view.anomalies.push(`${id}: ${reason}`); };
  const totals = (plan: PlanView) => {
    plan.spent_usd = Object.values(plan.tasks).reduce((sum, task) => sum + task.spent_usd, 0);
    plan.reserved_usd = Object.values(plan.tasks).reduce((sum, task) => sum + task.reserved_usd, 0);
  };
  const spend = (plan: PlanView, task: TaskView, stamp: OrchestrationStamp, id: number) => {
    const delta = stamp.spent_usd ?? 0;
    task.spent_usd += delta;
    task.reserved_usd = Math.max(0, task.reserved_usd - delta);
    totals(plan);
    if (task.spent_usd > task.task.budget.usd || plan.spent_usd + plan.reserved_usd > plan.plan.budget.usd + 1e-9) {
      task.phase = "needs_you";
      task.reason = "budget exceeded";
      anomaly(id, `budget exceeded for ${plan.plan.plan_id}/${task.task.task_id}`);
    }
  };
  const stop = (plan: PlanView, task: TaskView, phase: "done" | "failed" | "cancelled") => {
    task.phase = phase;
    task.reserved_usd = 0;
    delete task.lease_expires_at;
    totals(plan);
  };

  for (const [index, event] of events.entries()) {
    const id = index + 1;
    if (typeof event.ts === "number" && Number.isFinite(event.ts)) view.now = Math.max(view.now, event.ts);
    if (event.type === "plan_proposed" && event.plan.orchestration) {
      let proposed;
      try { proposed = parsePlan(event.plan.orchestration); }
      catch { anomaly(id, "invalid orchestration plan"); continue; }
      const previous = own(view.plans, proposed.plan_id);
      if (previous && (proposed.version <= previous.plan.version || Object.values(previous.tasks).some(live))) {
        anomaly(id, "duplicate/stale plan version or previous run still live"); continue;
      }
      const plan = structuredClone(proposed);
      // Define a data property so even a log-supplied '__proto__' stays a namespaced key.
      Object.defineProperty(view.plans, plan.plan_id, { enumerable: true, configurable: true, writable: true, value: {
        plan, phase: "proposed", tasks: Object.fromEntries(plan.tasks.map(task => [task.task_id, {
          task, phase: "planned", attempt: 0, evidence: "absent", spent_usd: 0, reserved_usd: 0,
        }])), spent_usd: 0, reserved_usd: 0, source_event_id: id,
      } satisfies PlanView });
      continue;
    }
    const stamp = "orchestration" in event ? event.orchestration : undefined;
    if (!stamp) continue;
    if (stamp.schema_version !== 1 || typeof stamp.plan_id !== "string" || !Number.isSafeInteger(stamp.version)) {
      anomaly(id, "invalid orchestration stamp"); continue;
    }
    if (event.type === "card_action" && event.action === "submit_plan" && event.card_type === "orchestration") {
      const requestId = stamp.request_id;
      if (!requestId || stamp.actor !== "kernel") { anomaly(id, "submission missing kernel authority or request id"); continue; }
      if (event.payload?.stage === "request") {
        if (requests.has(requestId) || finishedControls.has(requestId)) anomaly(id, "duplicate submission request");
        else requests.set(requestId, { event_id: id, event, stamp });
      } else {
        const request = requests.get(requestId);
        if (event.payload?.stage !== "result" || !request || finishedControls.has(requestId) || request.event.action !== "submit_plan" ||
            event.source_event_id !== request.event_id || stamp.plan_id !== request.stamp.plan_id || stamp.version !== request.stamp.version) anomaly(id, "unmatched submission result");
        else {
          finishedControls.add(requestId);
          if (event.payload.ok === true && own(view.plans, stamp.plan_id)?.plan.version !== stamp.version) anomaly(id, "submission result lacks proposed plan");
        }
      }
      continue;
    }
    const plan = own(view.plans, stamp.plan_id);
    if (!plan || stamp.version !== plan.plan.version) { anomaly(id, "unknown plan or stale version"); continue; }
    if (event.type === "plan_approved") {
      if (stamp.actor !== "kernel" || plan.phase !== "proposed") { anomaly(id, "invalid plan approval"); continue; }
      plan.phase = event.approved ? "approved" : "rejected";
      continue;
    }
    if (event.type === "card_action") {
      if (event.card_type !== "orchestration") { anomaly(id, "invalid orchestration card type"); continue; }
      const requestId = stamp.request_id;
      if (!requestId || stamp.actor !== "kernel") { anomaly(id, "control missing kernel authority or request id"); continue; }
      const stage = event.payload?.stage;
      if (stage === "request") {
        if (requests.has(requestId) || finishedControls.has(requestId)) anomaly(id, "duplicate control request");
        else requests.set(requestId, { event_id: id, event, stamp });
        continue;
      }
      const request = requests.get(requestId);
      if (stage !== "result" || !request || finishedControls.has(requestId) || request.event_id !== event.source_event_id ||
          request.event.action !== event.action || request.stamp.plan_id !== stamp.plan_id || request.stamp.version !== stamp.version || request.stamp.task_id !== stamp.task_id || request.stamp.run_id !== stamp.run_id || request.stamp.attempt !== stamp.attempt) {
        anomaly(id, "unmatched or duplicate control result"); continue;
      }
      finishedControls.add(requestId);
      if (event.payload?.ok !== true) continue;
      const action = event.action as ControlAction;
      const task = stamp.task_id ? own(plan.tasks, stamp.task_id) : undefined;
      if (taskControls.has(action) && !task) { anomaly(id, "unknown control task"); continue; }
      if (taskControls.has(action) && task && request.stamp.run_id &&
          (task.run_id !== request.stamp.run_id || (request.stamp.attempt !== undefined && task.attempt !== request.stamp.attempt))) {
        anomaly(id, "stale control task run or attempt"); continue;
      }
      let valid = true;
      switch (action) {
        case "approve_plan": break; // Approval authority lives in plan_approved, never a card.
        case "reject_plan": if (plan.phase === "proposed") plan.phase = "rejected"; else if (plan.phase !== "rejected") valid = false; break;
        case "pause_plan": if (plan.phase === "approved") plan.phase = "paused"; else valid = false; break;
        case "resume_plan": if (plan.phase === "paused") plan.phase = "approved"; else valid = false; break;
        case "cancel_plan":
          if (["proposed", "approved", "paused"].includes(plan.phase)) {
            plan.phase = "cancelled";
            for (const child of Object.values(plan.tasks)) if (!live(child) && !terminal(child)) stop(plan, child, "cancelled");
          } else valid = false;
          break;
        case "pause_task": if (task && !terminal(task)) { task.reason = "paused by user"; if (!live(task)) task.phase = "paused"; } else valid = false; break;
        case "resume_task": if (task?.phase === "paused" && !task.run_id) { task.phase = "queued"; delete task.reason; } else if (task?.reason === "paused by user") delete task.reason; else valid = false; break;
        case "cancel_task": if (task && (task.phase === "needs_you" || task.phase === "cancelled" || (!live(task) && !terminal(task)))) stop(plan, task, "cancelled"); else valid = false; break;
        case "takeover_task": if (task && (task.phase === "needs_you" || !live(task))) { task.phase = "needs_you"; task.reason = "taken over by user"; delete task.run_id; delete task.agent_id; delete task.lease_expires_at; } else valid = false; break;
        case "retry_task":
          if (task && ["failed", "cancelled", "needs_you"].includes(task.phase) && task.attempt < task.task.max_attempts && task.spent_usd < task.task.budget.usd) {
            task.phase = "queued"; task.evidence = "absent"; task.delivered = false;
            delete task.run_id; delete task.agent_id; delete task.revision; delete task.verifier_id; delete task.producer_id; delete task.verdict; delete task.reason;
          } else valid = false;
          break;
        case "merge_task": if (!task || task.phase !== "verifying" || task.evidence !== "verified") valid = false; break;
        case "reject_merge": if (task && ["verifying", "merging"].includes(task.phase)) { task.phase = "needs_you"; task.reason = "merge rejected"; } else valid = false; break;
        case "rollback_task": if (task && !live(task)) { task.phase = "needs_you"; task.reason = "rolled back"; task.evidence = "stale"; } else valid = false; break;
        default: valid = false;
      }
      if (!valid) anomaly(id, `invalid control transition: ${action}`);
      continue;
    }
    const task = stamp.task_id ? own(plan.tasks, stamp.task_id) : undefined;
    if (!task) { anomaly(id, "unknown orchestration task"); continue; }
    if (stamp.spent_usd !== undefined && !money(stamp.spent_usd)) { anomaly(id, "invalid spent amount"); continue; }
    const runKey = JSON.stringify([stamp.plan_id, stamp.version, stamp.task_id, stamp.run_id]);
    if (event.type === "agent_spawned") {
      const remaining = task.task.budget.usd - task.spent_usd;
      const activeTasks = Object.values(view.plans).flatMap(p => Object.values(p.tasks)).filter(live);
      const dependenciesReady = task.task.depends_on.every(dependency => own(plan.tasks, dependency)?.phase === "done");
      if (!dependenciesReady || activeTasks.some(other => writeScopesConflict(task.task, other.task)) ||
          Object.values(plan.tasks).filter(live).length >= plan.plan.max_concurrency ||
          Object.values(plan.tasks).some(other => other.spent_usd > other.task.budget.usd + 1e-9) ||stamp.actor !== "kernel" || stamp.phase !== "running" || plan.phase !== "approved" ||
          !["planned", "queued"].includes(task.phase) || task.run_id || !stamp.run_id || runs.has(runKey) ||
          stamp.attempt !== task.attempt + 1 || stamp.attempt > task.task.max_attempts || !money(stamp.reserved_usd) ||
          Math.abs(stamp.reserved_usd - remaining) > 1e-9 || stamp.reserved_usd + plan.spent_usd + plan.reserved_usd > plan.plan.budget.usd + 1e-9 ||
          !Number.isFinite(stamp.lease_expires_at) || stamp.lease_expires_at! <= (event.ts ?? 0) || !event.agent_id) {
        anomaly(id, "invalid spawn or previous run still live"); continue;
      }
      runs.add(runKey);
      Object.assign(task, { phase: "running", attempt: stamp.attempt, run_id: stamp.run_id, agent_id: event.agent_id,
        evidence: "absent", reserved_usd: stamp.reserved_usd, lease_expires_at: stamp.lease_expires_at, delivered: false });
      totals(plan);
      continue;
    }
    if (!stamp.run_id || task.run_id !== stamp.run_id || task.attempt !== stamp.attempt || terminal(task)) {
      anomaly(id, "stale/terminal task run or attempt"); continue;
    }
    if ((event.type === "agent_result" || event.type === "agent_status") && event.agent_id !== task.agent_id) {
      anomaly(id, "agent identity does not match run"); continue;
    }
    const receiptKey = JSON.stringify([runKey, stamp.actor, event.type]);
    if ((event.type === "agent_result" || event.type === "verify_result") && receipts.has(receiptKey)) {
      anomaly(id, "duplicate result receipt"); continue;
    }
    if (event.type === "agent_result") {
      if (!money(stamp.spent_usd) || stamp.actor !== "producer" || stamp.phase !== "verifying" || task.phase !== "running" || !stamp.revision || event.status !== "done") {
        anomaly(id, "invalid producer result transition"); continue;
      }
      receipts.add(receiptKey);
      task.phase = "verifying"; task.revision = stamp.revision; task.producer_id = stamp.producer_id ?? task.agent_id; task.evidence = "absent"; task.delivered = false;
      task.summary = event.summary;
      task.artifacts = stamp.output?.artifacts ? structuredClone(stamp.output.artifacts) : [];
      spend(plan, task, stamp, id);
    } else if (event.type === "verify_result") {
      if (!money(stamp.spent_usd) || stamp.actor !== "verifier" || task.phase !== "verifying" || !stamp.verifier_id || stamp.verifier_id === (task.producer_id ?? task.agent_id) ||
          stamp.revision !== task.revision || !["pass", "fail", "unverifiable"].includes(stamp.verdict ?? "")) {
        anomaly(id, "invalid/stale independent verification"); continue;
      }
      receipts.add(receiptKey);
      task.verdict = stamp.verdict; task.verifier_id = stamp.verifier_id;
      task.evidence = freshPass(event, stamp, task) ? "verified" : stamp.verdict === "fail" ? "failed" : "absent";
      if (stamp.verdict === "pass" && task.evidence !== "verified") anomaly(id, "verification pass lacks real contract checks");
      spend(plan, task, stamp, id);
    } else if (event.type === "agent_status") {
      const phase = stamp.phase;
      if (stamp.actor === "delivery" && phase === "merging" && ["verifying", "merging"].includes(task.phase) && task.evidence === "verified" && stamp.revision === task.revision && !task.delivered) {
        task.phase = "merging"; task.delivered = true;
      } else if (stamp.actor === "kernel" && phase === "merging" && task.phase === "verifying" && task.evidence === "verified") {
        task.phase = "merging";
      } else if (stamp.actor === "kernel" && (phase === "failed" || phase === "cancelled") && event.status === phase) {
        spend(plan, task, stamp, id);
        task.reason = event.reason;
        stop(plan, task, phase);
      } else if (stamp.actor === "kernel" && phase === "done" && event.status === "done" &&
          ["verifying", "merging"].includes(task.phase) && task.evidence === "verified" && task.verdict === "pass" && stamp.revision === task.revision &&
          (task.task.contract.effect === "none" || task.delivered === true)) {
        stop(plan, task, "done");
      } else if (stamp.actor === "kernel" && (phase === "needs_you" || phase === "paused") && live(task)) {
        task.phase = phase; task.reason = event.reason;
      } else anomaly(id, "invalid agent status transition or unverified delivery");
    } else anomaly(id, `unsupported orchestration event: ${event.type}`);
  }
  return view;
}
