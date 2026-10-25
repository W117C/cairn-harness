import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events/types";
import type { FlowTask, OrchPlan, OrchestrationStamp } from "../src/orchestration/types";
import { projectOrchestration } from "../src/orchestration/project";

const task = (id = "a", extra: Partial<FlowTask> = {}): FlowTask => ({
  task_id: id, goal: id, non_goals: [], agent_spec: "worker", lane: "write", depends_on: [], write_scopes: [`src/${id}.ts`], inputs: [],
  contract: { acceptance: [{ kind: "command", id: "test", run: "pnpm test", timeout_ms: 1000 }], effect: "workspace" },
  budget: { usd: 3 }, max_attempts: 2, priority: 0, ...extra,
});
const plan = (id = "p", tasks = [task()], version = 1): OrchPlan => ({
  plan_id: id, version, goal: id, non_goals: [], domain: "coding", tasks, agents: [{ agent_spec_id: "worker", role: "writer", max_turns: 3, capability: { tools: [], fs_read: [], fs_write: ["src/**"], network: [], shell: "none", git: "none", external_effects: "none" } }], budget: { usd: 10 }, max_concurrency: 2, policy_ref: "test", created_by: "user",
});
const stamp = (extra: Partial<OrchestrationStamp> = {}): OrchestrationStamp => ({ schema_version: 1, plan_id: "p", version: 1, task_id: "a", run_id: "r1", attempt: 1, actor: "kernel", ...extra });
const proposal = (p = plan()): AgentEvent => ({ type: "plan_proposed", callId: `plan-${p.plan_id}-${p.version}`, plan: { goal: p.goal, files: [], orchestration: p }, ts: 1 });
const approval = (extra: Partial<OrchestrationStamp> = {}): AgentEvent => ({ type: "plan_approved", callId: "plan-p-1", approved: true, orchestration: stamp(extra), ts: 2 });
const spawn = (extra: Partial<OrchestrationStamp> = {}): AgentEvent => ({ type: "agent_spawned", agent_id: "producer", parent_event_id: 1, mode: "write", task: "a", max_turns: 2, permission_mode: "default", orchestration: stamp({ phase: "running", reserved_usd: 3, lease_expires_at: 100, ...extra }), ts: 3 });
const result = (extra: Partial<OrchestrationStamp> = {}): AgentEvent => ({ type: "agent_result", agent_id: "producer", status: "done", summary: "done", artifacts: {}, usage: { inputTokens: 0, outputTokens: 0 }, tool_stats: {}, orchestration: stamp({ actor: "producer", phase: "verifying", revision: "rev1", spent_usd: 1, ...extra }), ts: 4 });
const verified = (extra: Partial<OrchestrationStamp> = {}): AgentEvent => ({ type: "verify_result", callId: "verify", ok: true, attempt: 1, maxAttempts: 1, results: [{ command: "pnpm test", ok: true, output: "1 passed", exitCode: 0 }], orchestration: stamp({ actor: "verifier", revision: "rev1", verifier_id: "independent", verdict: "pass", checks: [{ id: "test", verdict: "pass", detail: "1 passed" }], spent_usd: 0.5, ...extra }), ts: 5 });
const status = (phase: "done" | "failed" | "cancelled" | "merging" | "needs_you", extra: Partial<OrchestrationStamp> = {}): AgentEvent => ({ type: "agent_status", agent_id: "producer", status: phase === "done" ? "done" : phase === "cancelled" ? "cancelled" : phase === "failed" ? "failed" : "running", orchestration: stamp({ phase, revision: "rev1", ...extra }), ts: 6 });
const control = (action: string, stage: "request" | "result", requestId = "c", extra: Partial<AgentEvent & { type: "card_action" }> = {}): AgentEvent => ({ type: "card_action", card_type: "orchestration", card_id: "plan:p:1", source_event_id: stage === "request" ? 1 : 3, action, payload: { stage, ok: true }, orchestration: stamp({ request_id: requestId }), ...extra });
const base = () => [proposal(), approval(), spawn()];
const viewTask = (events: AgentEvent[]) => projectOrchestration(events).plans.p.tasks.a;

describe("orchestration event projection", () => {
  it("ignores legacy events and derives time only from event timestamps", () => {
    expect(projectOrchestration([{ type: "assistant_message", content: "old", ts: 30 }])).toEqual({ plans: {}, anomalies: [], last_event_id: 1, now: 30 });
  });
  it("keeps plans with equal task ids separate and never mutates input", () => {
    const events = [proposal(), approval(), proposal(plan("q")), approval({ plan_id: "q" })];
    const saved = JSON.stringify(events);
    const view = projectOrchestration(events);
    expect(view.plans.p.tasks.a.phase).toBe("planned");
    expect(view.plans.q.phase).toBe("approved");
    expect(JSON.stringify(events)).toBe(saved);
    expect(projectOrchestration(events)).toEqual(view);
  });
  it("requires successful matching control results and rejects duplicate requests", () => {
    const events = [proposal(), approval(), control("pause_plan", "request")];
    expect(projectOrchestration(events).plans.p.phase).toBe("approved");
    expect(projectOrchestration([...events, control("pause_plan", "result", "c", { payload: { stage: "result", ok: false } })]).plans.p.phase).toBe("approved");
    const view = projectOrchestration([...events, control("pause_plan", "result"), control("pause_plan", "request")]);
    expect(view.plans.p.phase).toBe("paused");
    expect(view.anomalies).toHaveLength(1);
    expect(projectOrchestration([proposal(), approval(), control("pause_plan", "result")]).plans.p.phase).toBe("approved");
  });
  it("requires kernel approval and ignores late versions", () => {
    const view = projectOrchestration([proposal(plan("p", [task()], 2)), approval({ version: 2, actor: "producer" }), approval(), spawn()]);
    expect(view.plans.p.phase).toBe("proposed");
    expect(view.anomalies).toHaveLength(3);
  });
  it("reserves remaining task budget, counts each result once and releases only at terminal", () => {
    const events = [...base(), result(), verified()];
    const view = projectOrchestration([...events, result(), verified()]);
    expect(view.plans.p.spent_usd).toBe(1.5);
    expect(view.plans.p.reserved_usd).toBe(1.5);
    expect(view.anomalies).toHaveLength(2);
    const ended = projectOrchestration([...events, status("failed")]);
    expect(ended.plans.p.tasks.a.phase).toBe("failed");
    expect(ended.plans.p.reserved_usd).toBe(0);
    expect(ended.plans.p.spent_usd).toBe(1.5);
  });
  it("producer done is only verifying and cannot certify itself", () => {
    expect(viewTask([...base(), result()]).phase).toBe("verifying");
    const events = [...base(), result(), verified({ verifier_id: "producer" }), status("done", { actor: "producer" })];
    const view = projectOrchestration(events);
    expect(view.plans.p.tasks.a.phase).toBe("verifying");
    expect(view.plans.p.tasks.a.evidence).toBe("absent");
    expect(view.anomalies).toHaveLength(2);
  });
  it("requires independent fresh checks and a matching successful delivery before done", () => {
    expect(viewTask([...base(), result(), verified(), status("done")]).phase).toBe("verifying");
    const events = [...base(), result(), verified(), status("merging", { actor: "delivery" }), status("done")];
    expect(viewTask(events)).toMatchObject({ phase: "done", evidence: "verified", delivered: true, reserved_usd: 0, spent_usd: 1.5 });
  });
  it.each([
    { revision: "old" }, { checks: [] }, { checks: [{ id: "wrong", verdict: "pass" as const, detail: "wrong" }] },
  ])("does not promote missing or stale acceptance evidence: %j", (extra) => {
    const view = projectOrchestration([...base(), result(), verified(extra), status("done")]);
    expect(view.plans.p.tasks.a.phase).not.toBe("done");
    expect(view.anomalies.length).toBeGreaterThan(0);
  });
  it("does not accept command checks without actual successful command execution", () => {
    const event = verified();
    if (event.type === "verify_result") event.results = [{ command: "pnpm test", ok: true, output: "not executed" }];
    expect(viewTask([...base(), result(), event, status("done")]).phase).not.toBe("done");
  });
  it("fences run ids, versions and attempts without changing spend", () => {
    const view = projectOrchestration([...base(), result({ run_id: "old" }), result({ version: 2 }), result({ attempt: 2 }), spawn({ run_id: "r2", attempt: 2 })]);
    expect(view.plans.p.tasks.a).toMatchObject({ phase: "running", run_id: "r1", spent_usd: 0, reserved_usd: 3 });
    expect(view.anomalies).toHaveLength(4);
  });
  it("refuses replacing a version while its previous writer has not stopped", () => {
    const view = projectOrchestration([...base(), proposal(plan("p", [task()], 2))]);
    expect(view.plans.p.plan.version).toBe(1);
    expect(view.plans.p.reserved_usd).toBe(3);
    expect(view.anomalies).toHaveLength(1);
  });
  it("retains needs_you writer lease until kernel confirms it stopped", () => {
    const waiting = viewTask([...base(), status("needs_you")]);
    expect(waiting).toMatchObject({ phase: "needs_you", run_id: "r1", reserved_usd: 3, lease_expires_at: 100 });
    expect(viewTask([...base(), status("needs_you"), status("cancelled")])).toMatchObject({ phase: "cancelled", reserved_usd: 0 });
  });
  it("only explicitly requested retries open another attempt and never double-spend", () => {
    const events = [...base(), result(), status("failed"), control("retry_task", "request", "retry", { source_event_id: 1 }), control("retry_task", "result", "retry", { source_event_id: 6 })];
    const view = projectOrchestration([...events, spawn({ run_id: "r2", attempt: 2, reserved_usd: 2 }), result({ run_id: "r1" })]);
    expect(view.plans.p.tasks.a).toMatchObject({ phase: "running", run_id: "r2", attempt: 2, spent_usd: 1, reserved_usd: 2 });
    expect(view.plans.p.spent_usd).toBe(1);
  });
  it("accepts durable submission audit around the proposal without changing plan authority", () => {
    const events = [control("submit_plan", "request", "submit", { source_event_id: 0 }), proposal(), control("submit_plan", "result", "submit", { source_event_id: 1 })];
    expect(projectOrchestration(events)).toMatchObject({ anomalies: [], plans: { p: { phase: "proposed" } } });
  });
  it("accepts kernel delivery intent but requires the later delivery receipt", () => {
    const events = [...base(), result(), verified(), status("merging")];
    expect(viewTask(events)).toMatchObject({ phase: "merging", delivered: false });
    expect(viewTask([...events, status("done")]).phase).toBe("merging");
    const complete = projectOrchestration([...events, status("merging", { actor: "delivery" }), status("done")]);
    expect(complete.anomalies).toEqual([]);
    expect(complete.plans.p.tasks.a.phase).toBe("done");
  });
  it("charges kernel terminal error costs once including real budget overruns", () => {
    const events = [...base(), result(), status("failed", { spent_usd: 4 })];
    const view = projectOrchestration([...events, status("failed", { spent_usd: 4 })]);
    expect(view.plans.p.tasks.a).toMatchObject({ phase: "failed", spent_usd: 5, reserved_usd: 0 });
    expect(view.plans.p.spent_usd).toBe(5);
    expect(view.anomalies).toHaveLength(2);
  });
  it("rejects successful cancel control until a live executor has confirmed termination", () => {
    const events = [...base(), control("cancel_task", "request"), control("cancel_task", "result", "c", { source_event_id: 4 })];
    expect(viewTask(events)).toMatchObject({ phase: "running", reserved_usd: 3 });
    expect(projectOrchestration(events).anomalies).toHaveLength(1);
  });
  it("does not accept a new spawn while dependencies or writer leases are unresolved", () => {
    const p = plan("p", [task("a"), task("b", { depends_on: ["a"] })]);
    const blocked = projectOrchestration([proposal(p), approval(), spawn({ task_id: "b" })]);
    expect(blocked.plans.p.tasks.b.phase).toBe("planned");
    expect(blocked.anomalies).toHaveLength(1);
    const conflictPlan = plan("p", [task("a"), task("b", { write_scopes: ["src/a.ts"] })]);
    const conflict = projectOrchestration([proposal(conflictPlan), approval(), spawn(), spawn({ task_id: "b", run_id: "r2" })]);
    expect(conflict.plans.p.tasks.b.phase).toBe("planned");
    expect(conflict.anomalies).toHaveLength(1);
  });

  it("rejects verification by the actual producer behind a distinct execution envelope", () => {
    const events = [...base(), result({ producer_id: "actual-producer" }), verified({ verifier_id: "actual-producer" })];
    const projected = projectOrchestration(events);
    expect(projected.plans.p.tasks.a.evidence).toBe("absent");
    expect(projected.anomalies).toHaveLength(1);
  });
  it("validates persisted plan payloads before exposing schedulable state", () => {
    const malformed = plan(); malformed.tasks[0].write_scopes = ["../escape"];
    expect(projectOrchestration([proposal(malformed)]).plans).toEqual({});
    const cyclic = plan("p", [task("a", { depends_on: ["b"] }), task("b", { depends_on: ["a"] })]);
    expect(projectOrchestration([proposal(cyclic)]).anomalies).toHaveLength(1);
  });

  it("does not let a delayed task control for an old run mutate its replacement", () => {
    const events = [...base(), control("pause_task", "request", "late"), status("failed"),
      control("retry_task", "request", "retry"), control("retry_task", "result", "retry", { source_event_id: 6 }),
      spawn({ run_id: "r2", attempt: 2 }), control("pause_task", "result", "late", { source_event_id: 4 })];
    const projected = projectOrchestration(events);
    expect(projected.plans.p.tasks.a.reason).toBeUndefined();
    expect(projected.anomalies).toHaveLength(1);
  });
  it("requires explicit cost on producer and verifier receipts", () => {
    const missingProducer = projectOrchestration([...base(), result({ spent_usd: undefined })]);
    expect(missingProducer.plans.p.tasks.a.phase).toBe("running");
    expect(missingProducer.anomalies).toHaveLength(1);
    const missingVerifier = projectOrchestration([...base(), result(), verified({ spent_usd: undefined })]);
    expect(missingVerifier.plans.p.tasks.a.evidence).toBe("absent");
    expect(missingVerifier.anomalies).toHaveLength(1);
  });

});
