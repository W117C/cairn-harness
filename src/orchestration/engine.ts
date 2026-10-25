import { createHash, randomUUID } from "node:crypto";
import type { AgentEvent } from "../events";
import { OrchestrationStore } from "./store";
import { parsePlan } from "./validate";
import { nextActions } from "./schedule";
import type { ControlCommand, ExecutionBackend, ExecutionRequest, ExecutionResult, OrchestrationStamp, OrchestrationView, VerificationResult } from "./types";

const ACTIONS = new Set(["approve_plan", "reject_plan", "pause_plan", "resume_plan", "cancel_plan", "pause_task", "resume_task", "cancel_task", "takeover_task", "retry_task", "merge_task", "reject_merge", "rollback_task"]);
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined;
function nonempty(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error(name + " is invalid"); }
function cost(value: number): void { if (!Number.isFinite(value) || value < 0) throw new Error("backend returned invalid spent_usd"); }
interface ActiveRun { request: ExecutionRequest; controller: AbortController; promise: Promise<void>; }

/** Durable intent precedes effects. Worker reports never directly grant completion. */
export class OrchestrationEngine {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<string, ActiveRun>();
  constructor(private readonly options: { store: OrchestrationStore; backend: ExecutionBackend; enabled?: boolean; onEvent?: (event: AgentEvent) => void }) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(fn); this.chain = next; return next;
  }
  private async append(event: AgentEvent): Promise<void> {
    await this.options.store.append(event);
    // The observer is not the journal: a UI failure cannot turn a durable write into a retry.
    try { this.options.onEvent?.(event); } catch { /* persisted event remains authoritative */ }
  }
  view(): Promise<OrchestrationView> { return this.options.store.view(); }
  private async previous(requestId: string, digest: string): Promise<{ done: boolean; requested: boolean }> {
    const events = await this.options.store.events();
    const prior = events.filter((e): e is Extract<AgentEvent, { type: "card_action" }> => e.type === "card_action" && e.card_type === "orchestration" && e.orchestration?.request_id === requestId);
    if (prior.some(e => e.payload?.digest !== digest)) throw new Error("request_id reused with different payload");
    const result = prior.find(e => e.payload?.stage === "result");
    if (result && result.payload?.ok !== true) throw new Error(String(result.payload?.error ?? "previous request failed"));
    return { done: result !== undefined, requested: prior.length > 0 };
  }
  private async commandEvent(command: { request_id: string; plan_id: string; version: number; task_id?: string; action: string }, digest: string, stage: "request" | "result", error?: string): Promise<void> {
    const view = await this.view();
    const events = stage === "result" ? await this.options.store.events() : [];
    const source = stage === "result" ? events.findIndex(e => e.type === "card_action" && e.card_type === "orchestration" && e.payload?.stage === "request" && e.orchestration?.request_id === command.request_id) + 1 : view.plans[command.plan_id]?.source_event_id ?? 0;
    await this.append({ type: "card_action", card_id: command.plan_id, source_event_id: source,
      card_type: "orchestration", action: command.action,
      payload: { stage, digest, ...(stage === "result" ? { ok: error === undefined, ...(error ? { error } : {}) } : {}) },
      orchestration: { schema_version: 1, plan_id: command.plan_id, version: command.version, actor: "kernel", request_id: command.request_id, ...(command.task_id ? { task_id: command.task_id } : {}) },
    });
  }
  async submit(value: unknown, requestId: string): Promise<OrchestrationView> {
    nonempty(requestId, "request_id");
    const plan = parsePlan(value);
    await this.serial(async () => {
      const digest = hash({ action: "submit_plan", plan });
      const previous = await this.previous(requestId, digest);
      if (previous.done) return;
      const view = await this.view(); const prior = own(view.plans, plan.plan_id);
      if (prior && prior.plan.version === plan.version && hash(prior.plan) !== hash(plan)) throw new Error("plan version is immutable");
      if (prior && prior.plan.version !== plan.version && plan.version !== prior.plan.version + 1) throw new Error("plan versions must increase by one");
      if (prior && prior.plan.version !== plan.version && Object.values(prior.tasks).some(t => t.run_id && !["done", "failed", "cancelled"].includes(t.phase))) throw new Error("previous plan still owns live runs");
      const cmd = { request_id: requestId, plan_id: plan.plan_id, version: plan.version, action: "submit_plan" };
      if (!previous.requested) await this.commandEvent(cmd, digest, "request");
      if (!prior || prior.plan.version !== plan.version) {
        await this.append({ type: "plan_proposed", callId: "orch:" + requestId, plan: { goal: plan.goal, files: [], orchestration: plan } });
      }
      await this.commandEvent(cmd, digest, "result");
    });
    return this.view();
  }
  async control(command: ControlCommand): Promise<OrchestrationView> {
    nonempty(command?.request_id, "request_id"); nonempty(command.plan_id, "plan_id");
    if (!ACTIONS.has(command.action) || !Number.isInteger(command.version)) throw new Error("unknown orchestration command/version");
    const digest = hash(command);
    await this.serial(async () => {
      const previous = await this.previous(command.request_id, digest);
      if (previous.done) return;
      const view = await this.view(); const plan = own(view.plans, command.plan_id);
      if (!plan || plan.plan.version !== command.version) throw new Error("unknown or stale plan version");
      if (command.action.endsWith("_task") || ["merge_task", "reject_merge"].includes(command.action)) {
        if (!command.task_id || !own(plan.tasks, command.task_id)) throw new Error("unknown task");
      }
      if (command.action === "retry_task") {
        const t = own(plan.tasks, command.task_id!)!;
        if (!["failed", "cancelled", "needs_you"].includes(t.phase) || t.attempt >= t.task.max_attempts) throw new Error("task cannot be retried");
      }
      const phases: Partial<Record<ControlCommand["action"], string[]>> = {
        approve_plan: ["proposed"], reject_plan: ["proposed"], pause_plan: ["approved"], resume_plan: ["paused"], cancel_plan: ["proposed", "approved", "paused"],
      };
      if (phases[command.action] && !phases[command.action]!.includes(plan.phase)) throw new Error("invalid plan control transition");
      const task = command.task_id ? own(plan.tasks, command.task_id) : undefined;
      if (command.action === "resume_task" && task?.phase !== "paused" && task?.reason !== "paused by user") throw new Error("task is not paused");
      if (["pause_task", "takeover_task", "cancel_task"].includes(command.action) && task && ["done", "failed", "cancelled"].includes(task.phase)) throw new Error("task already terminated");
      // Publication and rollback require a live retained result and explicit backend support.
      if (["merge_task", "reject_merge"].includes(command.action)) throw new Error("delivery is controlled by the verified execution queue; manual delivery is unavailable");
      if (command.action === "rollback_task" && (task?.phase !== "done" || !task.run_id || !this.options.backend.rollback)) throw new Error("verified delivered task with backend rollback support required");
      if (!previous.requested) await this.commandEvent(command, digest, "request");
      if (["cancel_plan", "cancel_task", "takeover_task"].includes(command.action)) {
        const targets = [...this.active.values()].filter(a => a.request.plan.plan_id === command.plan_id && a.request.plan.version === command.version && (!command.task_id || a.request.task.task_id === command.task_id));
        for (const run of targets) run.controller.abort();
        // Execute never waits on this command queue: cancellation can await confirmed stop safely.
        await Promise.all(targets.map(run => run.promise));
      }
      if (command.action === "rollback_task") {
        const request: ExecutionRequest = {
          plan: structuredClone(plan.plan), task: structuredClone(task!.task), run_id: task!.run_id!, request_id: "rollback:" + task!.run_id!, signal: new AbortController().signal,
          context: { plan_goal: plan.plan.goal, plan_non_goals: plan.plan.non_goals, task_goal: task!.task.goal, task_non_goals: task!.task.non_goals,
            inputs: task!.task.inputs, write_scopes: task!.task.write_scopes, acceptance: task!.task.contract.acceptance,
            capability: plan.plan.agents.find(a => a.agent_spec_id === task!.task.agent_spec)!.capability, budget: { usd: 0 } },
        };
        try { await this.options.backend.rollback!(request); }
        catch (error) { await this.commandEvent(command, digest, "result", String(error instanceof Error ? error.message : error)); throw error; }
      }
      if (["approve_plan", "reject_plan"].includes(command.action)) {
        await this.append({ type: "plan_approved", callId: "orch:" + command.request_id, approved: command.action === "approve_plan",
          orchestration: { schema_version: 1, plan_id: command.plan_id, version: command.version, actor: "kernel", request_id: command.request_id } });
      }
      await this.commandEvent(command, digest, "result");
    });
    return this.view();
  }
  async tick(): Promise<number> {
    return this.serial(async () => {
      if (this.options.enabled !== true) return 0;
      const view = await this.view();
      const actions = nextActions(view, { max_concurrency: this.options.backend.max_concurrency });
      let started = 0;
      for (const action of actions) {
        if (action.kind === "cancel") {
          for (const run of this.active.values()) if (run.request.plan.plan_id === action.plan_id && run.request.task.task_id === action.task_id) run.controller.abort();
          continue;
        }
        if (action.kind === "escalate") {
          const task = (() => { const p = own(view.plans, action.plan_id); return p ? own(p.tasks, action.task_id) : undefined; })();
          if (task && ["planned", "queued"].includes(task.phase)) {
            const cmd = { request_id: randomUUID(), plan_id: action.plan_id, version: action.version, task_id: action.task_id, action: "takeover_task" };
            const digest = hash(cmd); await this.commandEvent(cmd, digest, "request"); await this.commandEvent(cmd, digest, "result");
          }
          continue;
        }
        if (action.kind !== "dispatch") continue;
        const p = own(view.plans, action.plan_id); const t = p ? own(p.tasks, action.task_id) : undefined;
        if (!p || !t) continue;
        const key = action.plan_id + ":" + action.version + ":" + action.task_id;
        if (this.active.has(key)) continue;
        const runId = randomUUID(); const controller = new AbortController();
        const request: ExecutionRequest = {
          plan: structuredClone(p.plan), task: structuredClone(t.task), run_id: runId, request_id: runId,
          context: { plan_goal: p.plan.goal, plan_non_goals: p.plan.non_goals, task_goal: t.task.goal, task_non_goals: t.task.non_goals, inputs: t.task.inputs,
            write_scopes: t.task.write_scopes, acceptance: t.task.contract.acceptance, capability: p.plan.agents.find(s => s.agent_spec_id === t.task.agent_spec)!.capability,
            budget: { usd: Math.max(0, t.task.budget.usd - t.spent_usd) } }, signal: controller.signal,
        };
        const stamp: OrchestrationStamp = { schema_version: 1, plan_id: p.plan.plan_id, version: p.plan.version, task_id: t.task.task_id, run_id: runId,
          attempt: t.attempt + 1, phase: "running", actor: "kernel", request_id: runId, reserved_usd: request.context.budget.usd, lease_expires_at: Date.now() + 300_000 };
        await this.append({ type: "agent_spawned", agent_id: "orch:" + runId, parent_event_id: p.source_event_id, mode: t.task.lane === "read" ? "read" : "write",
          task: t.task.goal, max_turns: p.plan.agents.find(s => s.agent_spec_id === t.task.agent_spec)!.max_turns, permission_mode: t.task.lane === "read" ? "read-only" : "default", resources: t.task.write_scopes, orchestration: stamp });
        const active: ActiveRun = { request, controller, promise: Promise.resolve() };
        this.active.set(key, active);
        active.promise = Promise.resolve().then(() => this.execute(request, stamp)).finally(() => this.active.delete(key));
        // Prevent an unhandled rejection while a UI is polling instead of awaiting drain.
        void active.promise.catch(() => undefined);
        started++;
      }
      return started;
    });
  }
  private async status(stamp: OrchestrationStamp, phase: NonNullable<OrchestrationStamp["phase"]>, reason?: string): Promise<void> {
    await this.append({ type: "agent_status", agent_id: "orch:" + stamp.run_id,
      status: phase === "done" ? "done" : phase === "failed" ? "failed" : phase === "cancelled" ? "cancelled" : "running",
      ...(reason ? { reason } : {}), orchestration: { ...stamp, actor: "kernel", phase } });
  }
  private async execute(request: ExecutionRequest, stamp: OrchestrationStamp): Promise<void> {
    let charged = 0;
    let recorded = 0;
    try {
      const spec = request.plan.agents.find(s => s.agent_spec_id === request.task.agent_spec)!;
      const unsupported = this.options.backend.supports(request.task, spec);
      if (unsupported) { await this.status(stamp, "failed", unsupported); return; }
      request.signal.throwIfAborted();
      const result: ExecutionResult = await this.options.backend.execute(request);
      cost(result.spent_usd); charged += result.spent_usd;
      nonempty(result.agent_id, "producer agent_id"); nonempty(result.revision, "revision");
      if (charged > request.context.budget.usd) throw new Error("backend exceeded reserved budget");
      request.signal.throwIfAborted();
      // Persist the real producer identity so an independent verifier cannot impersonate it.
      await this.append({ type: "agent_result", agent_id: "orch:" + stamp.run_id, status: "done", summary: result.summary,
        artifacts: { verified: "absent", spent_usd: result.spent_usd }, usage: { inputTokens: 0, outputTokens: 0 }, tool_stats: {},
        orchestration: { ...stamp, phase: "verifying", actor: "producer", revision: result.revision, spent_usd: result.spent_usd, evidence: "absent", producer_id: result.agent_id,
          output: { artifacts: result.artifacts, evidence: result.evidence } } });
      recorded += result.spent_usd;
      const verified: VerificationResult = await this.options.backend.verify({ ...request, context: { ...request.context, budget: { usd: request.context.budget.usd - charged } } }, result);
      cost(verified.spent_usd); charged += verified.spent_usd;
      if (charged > request.context.budget.usd) throw new Error("verifier exceeded reserved budget");
      if (verified.verifier_id === result.agent_id) throw new Error("producer cannot verify its own result");
      const pass = verified.verdict === "pass" && verified.revision === result.revision && verified.checks.length === request.task.contract.acceptance.length
        && verified.checks.every(c => c.verdict === "pass" && c.detail.trim()) && request.task.contract.acceptance.every(c => verified.checks.some(v => v.id === c.id)
          && (c.kind !== "command" || verified.results?.some(r => r.command === c.run && r.ok && r.exitCode === 0 && !r.cause)));
      await this.append({ type: "verify_result", callId: "verify:" + request.run_id, agent_id: "orch:" + stamp.run_id, ok: pass, attempt: stamp.attempt!, maxAttempts: request.task.max_attempts,
        results: verified.results ?? [], orchestration: { ...stamp, actor: "verifier", phase: "verifying", verifier_id: verified.verifier_id, revision: verified.revision,
          verdict: pass ? "pass" : verified.verdict === "unverifiable" ? "unverifiable" : "fail", evidence: pass ? "verified" : "failed", checks: verified.checks, spent_usd: verified.spent_usd } });
      recorded += verified.spent_usd;
      request.signal.throwIfAborted();
      if (!pass) { await this.status(stamp, verified.verdict === "unverifiable" ? "needs_you" : "failed", "independent verification: " + verified.verdict); return; }
      if (request.task.contract.effect !== "none") {
        if (!this.options.backend.deliver) { await this.status(stamp, "needs_you", "backend has no controlled delivery"); return; }
        await this.status(stamp, "merging");
        const delivered = await this.options.backend.deliver(request, result);
        if (delivered.revision !== result.revision) throw new Error("delivery revision changed after verification");
        await this.append({ type: "agent_status", agent_id: "orch:" + stamp.run_id, status: "running", orchestration: { ...stamp, actor: "delivery", phase: "merging", revision: delivered.revision } });
      }
      await this.status({ ...stamp, revision: result.revision }, "done");
    } catch (error) {
      // A user/kernel cancellation has no reported cost yet; do not turn the whole remaining
      // reservation into spend (that makes a cancelled task unretryable). A real backend error
      // keeps the reservation: it may have incurred unreported provider cost.
      const remaining = request.signal.aborted
        ? Math.max(0, charged - recorded)
        : Math.max(0, Math.max(request.context.budget.usd, charged) - recorded);
      await this.status({ ...stamp, spent_usd: remaining }, request.signal.aborted ? "cancelled" : "failed", String(error instanceof Error ? error.message : error));
    }
  }
  /** Run until nothing can proceed. Blocked/needs-you tasks remain visible, not falsely completed. */
  async runUntilIdle(): Promise<OrchestrationView> {
    for (;;) {
      const started = await this.tick();
      const pending = [...this.active.values()].map(a => a.promise);
      if (!pending.length && !started) break;
      await Promise.all(pending);
    }
    return this.view();
  }
  async recover(): Promise<OrchestrationView> {
    await this.serial(async () => {
      const view = await this.view();
      for (const p of Object.values(view.plans)) for (const t of Object.values(p.tasks)) {
        if (t.run_id && ["running", "verifying", "merging"].includes(t.phase) && ![...this.active.values()].some(a => a.request.run_id === t.run_id)) {
          await this.status({ schema_version: 1, plan_id: p.plan.plan_id, version: p.plan.version, task_id: t.task.task_id, run_id: t.run_id, attempt: t.attempt }, "needs_you", "interrupted run; confirm the old executor stopped before retry");
        }
      }
    });
    return this.view();
  }
  async stop(): Promise<void> {
    const runs = [...this.active.values()]; for (const run of runs) run.controller.abort(); await Promise.all(runs.map(r => r.promise));
  }
}
