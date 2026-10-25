import { describe, expect, it } from "vitest";
import type { FlowTask, OrchestrationView, PlanView, TaskPhase } from "../src/orchestration/types";
import { DEPENDENCY_ESCALATION_REASON, nextActions } from "../src/orchestration/schedule";

function task(id: string, extra: Partial<FlowTask> = {}): FlowTask {
  return { task_id: id, goal: id, non_goals: [], agent_spec: "worker", lane: "write", depends_on: [], write_scopes: [`src/${id}.ts`], inputs: [], contract: { acceptance: [], effect: "workspace" }, budget: { usd: 2 }, max_attempts: 2, priority: 0, ...extra };
}
function plan(id: string, tasks = [task("a")], max = 4): PlanView {
  return { plan: { plan_id: id, version: 1, goal: id, non_goals: [], domain: "coding", tasks, agents: [], budget: { usd: 10 }, max_concurrency: max, policy_ref: "test", created_by: "user" }, phase: "approved", tasks: Object.fromEntries(tasks.map(t => [t.task_id, { task: t, phase: "planned", attempt: 0, evidence: "absent", spent_usd: 0, reserved_usd: 0 }])), spent_usd: 0, reserved_usd: 0, source_event_id: 1 };
}
function view(...plans: PlanView[]): OrchestrationView { return { plans: Object.fromEntries(plans.map(p => [p.plan.plan_id, p])), anomalies: [], last_event_id: 1, now: 50 }; }
function running(p: PlanView, id = "a", phase: TaskPhase = "running") {
  Object.assign(p.tasks[id], { phase, run_id: `run-${id}`, attempt: 1, agent_id: "producer", reserved_usd: 2, lease_expires_at: 100 });
  p.reserved_usd += 2;
}

describe("orchestration scheduling", () => {
  it("dispatches approved dependency-ready tasks by priority with stable ties", () => {
    const p = plan("p", [task("b"), task("a"), task("urgent", { priority: 3 }), task("child", { depends_on: ["a"] })]);
    expect(nextActions(view(p)).map(a => a.task_id)).toEqual(["urgent", "a", "b"]);
    expect(nextActions(view(p))).toEqual(nextActions(view(p)));
  });
  it("respects total and per-plan concurrency", () => {
    const p = plan("p", [task("a"), task("b"), task("c")], 2);
    running(p);
    expect(nextActions(view(p), { max_concurrency: 1 })).toEqual([]);
    expect(nextActions(view(p), { max_concurrency: 3 }).map(a => a.task_id)).toEqual(["b"]);
  });
  it("round-robins multiple plans and gives a previously served plan lower turn priority", () => {
    const p = plan("p", [task("a"), task("b"), task("c")]);
    const q = plan("q", [task("d"), task("e"), task("f")]);
    expect(nextActions(view(p, q), { max_concurrency: 4 }).map(a => a.plan_id)).toEqual(["p", "q", "p", "q"]);
    p.tasks.a.phase = "done"; p.tasks.a.attempt = 1;
    expect(nextActions(view(p, q), { max_concurrency: 1 })[0].plan_id).toBe("q");
  });
  it("reserves complete remaining task budgets across all actions in one decision", () => {
    const p = plan("p", [task("a"), task("b")]);
    p.plan.budget.usd = 3;
    const actions = nextActions(view(p));
    expect(actions.filter(a => a.kind === "dispatch")).toHaveLength(1);
    expect(actions.some(a => a.kind === "escalate" && a.reason?.includes("budget"))).toBe(true);
  });
  it("blocks failed dependencies and does not automatically retry terminal tasks", () => {
    const p = plan("p", [task("a"), task("b", { depends_on: ["a"] })]);
    p.tasks.a.phase = "failed"; p.tasks.a.attempt = 1;
    const actions = nextActions(view(p));
    expect(actions.every(a => a.kind === "escalate")).toBe(true);
    expect(actions.find(a => a.task_id === "b")?.reason).toBe(DEPENDENCY_ESCALATION_REASON);
  });
  it("does not dispatch paused, needs_you or unapproved tasks", () => {
    for (const phase of ["proposed", "paused", "rejected"] as const) {
      const p = plan("p"); p.phase = phase;
      expect(nextActions(view(p))).toEqual([]);
    }
    for (const phase of ["paused", "needs_you"] as const) {
      const p = plan("p"); p.tasks.a.phase = phase;
      expect(nextActions(view(p))).toEqual([]);
    }
  });
  it("keeps leases held by needs_you tasks and cancels expired runs instead of respawning", () => {
    const p = plan("p", [task("a"), task("b", { write_scopes: ["src/a.ts"] })]);
    running(p, "a", "needs_you");
    expect(nextActions(view(p))).toEqual([]);
    p.tasks.a.lease_expires_at = 20;
    expect(nextActions(view(p))).toEqual([{ kind: "cancel", plan_id: "p", version: 1, task_id: "a", reason: "lease expired; confirm the previous executor stopped" }]);
  });
  it("conservatively finds crossed glob scopes that neither glob matches as a literal", () => {
    const p = plan("p", [task("a", { write_scopes: ["src/*/a.ts"] }), task("b", { write_scopes: ["src/foo/*.ts"] }), task("c", { write_scopes: ["docs/**"] })]);
    expect(nextActions(view(p)).filter(a => a.kind === "dispatch").map(a => a.task_id)).toEqual(["a", "c"]);
  });
  it("treats unknown or empty write scopes as global, while read lanes share", () => {
    const p = plan("p", [task("a", { write_scopes: [] }), task("b"), task("c", { lane: "read", write_scopes: [] })]);
    expect(nextActions(view(p)).map(a => a.task_id)).toEqual(["a", "c"]);
  });
  it("schedules independent verification then serial delivery without dispatching another writer", () => {
    const p = plan("p", [task("a"), task("b", { write_scopes: ["src/a.ts"] })]);
    running(p, "a", "verifying");
    expect(nextActions(view(p)).map(a => a.kind)).toEqual(["verify"]);
    Object.assign(p.tasks.a, { evidence: "verified", verdict: "pass", revision: "rev", verifier_id: "independent" });
    expect(nextActions(view(p)).map(a => a.kind)).toEqual(["merge"]);
  });
  it("escalates failed or unverifiable evidence instead of spinning verification", () => {
    const p = plan("p"); running(p, "a", "verifying");
    p.tasks.a.evidence = "failed"; p.tasks.a.verdict = "fail";
    expect(nextActions(view(p))).toEqual([{ kind: "escalate", plan_id: "p", version: 1, task_id: "a", reason: "verification failed or is unverifiable" }]);
  });
  it("does not mutate the projection and ignores expired TTL for a terminal task", () => {
    const p = plan("p"); running(p); p.tasks.a.phase = "done"; p.tasks.a.lease_expires_at = 1;
    const v = view(p), before = JSON.stringify(v);
    expect(nextActions(v)).toEqual([]);
    expect(JSON.stringify(v)).toBe(before);
  });
  it("treats the workspace root scope as a global write lease", () => {
    const p = plan("p", [task("a", { write_scopes: ["."] }), task("b", { write_scopes: ["docs/page.md"] })]);
    expect(nextActions(view(p)).filter(a => a.kind === "dispatch").map(a => a.task_id)).toEqual(["a"]);
  });

});
