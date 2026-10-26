import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideRuntimeControl,
  expandRuntimeFlow,
  runtimeGroups,
  runtimeTasks,
} from "../src/orchestration/control-node";
import { OrchestrationEngine } from "../src/orchestration/engine";
import { OrchestrationStore } from "../src/orchestration/store";
import type {
  ExecutionBackend,
  ExecutionRequest,
  FlowNode,
  FlowTask,
  RuntimeControlGroup,
} from "../src/orchestration/types";
import { orchestrationPlan } from "./orchestration-fixture";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function task(id: string): FlowTask {
  return {
    task_id: id,
    goal: "Read evidence " + id,
    non_goals: [],
    agent_spec: "reader",
    lane: "read",
    depends_on: [],
    write_scopes: [],
    inputs: [],
    contract: {
      effect: "none",
      acceptance: [{ kind: "evidence", id: "answer", fields: ["answer"] }],
    },
    budget: { usd: 1 },
    max_attempts: 2,
    priority: 5,
  };
}

function node(id: string): FlowNode {
  return { kind: "task", task: task(id) };
}

function backend(onExecute?: (request: ExecutionRequest) => Promise<void>): ExecutionBackend {
  return {
    id: "dynamic-test",
    max_concurrency: 2,
    supports: () => null,
    async execute(request) {
      await onExecute?.(request);
      return {
        agent_id: "producer:" + request.task.task_id,
        summary: request.task.task_id + " complete",
        revision: "rev-" + request.task.task_id,
        artifacts: [],
        evidence: { answer: request.task.task_id },
        spent_usd: 0.01,
      };
    },
    async verify(_request, result) {
      return {
        verdict: "pass",
        verifier_id: "independent-verifier",
        revision: result.revision,
        checks: [{ id: "answer", verdict: "pass", detail: "checked" }],
        spent_usd: 0.01,
      };
    },
  };
}

async function setup(execution: ExecutionBackend) {
  const dir = await mkdtemp(join(tmpdir(), "cairn-dynamic-control-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = await OrchestrationStore.open(join(dir, "events.jsonl"));
  cleanup.push(() => store.close());
  return { store, engine: new OrchestrationEngine({ store, backend: execution, enabled: true }) };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not reached before timeout");
}

function group(over: Partial<RuntimeControlGroup> = {}): RuntimeControlGroup {
  return {
    id: "g0",
    kind: "race",
    strategy: "race",
    quorum: 1,
    candidates: [
      { candidate_id: "a", task_ids: ["a"] },
      { candidate_id: "b", task_ids: ["b"] },
      { candidate_id: "c", task_ids: ["c"] },
    ],
    ...over,
  };
}

describe("runtime flow expansion", () => {
  it("preserves race and quorum groups while connecting downstream tasks through the group", () => {
    const flow: FlowNode = {
      kind: "sequence",
      steps: [
        { kind: "race", steps: [node("a"), node("b")] },
        { kind: "gather", strategy: "quorum", quorum: 2, steps: [node("c"), node("d"), node("e")] },
        node("after"),
      ],
    };
    const expanded = expandRuntimeFlow(flow);
    const groups = runtimeGroups(expanded);
    const tasks = runtimeTasks(expanded);

    expect(groups).toMatchObject([
      { id: "g0", strategy: "race", quorum: 1 },
      { id: "g1", strategy: "quorum", quorum: 2 },
    ]);
    expect(groups[0]?.candidates.flatMap((candidate) => candidate.task_ids)).toEqual(["a", "b"]);
    expect(groups[1]?.candidates.flatMap((candidate) => candidate.task_ids)).toEqual(["c", "d", "e"]);
    expect(tasks.find((item) => item.task_id === "after")?.depends_on).toEqual(["@group:g1"]);
  });

  it("keeps static map branches parallel when the flow also contains a runtime group", () => {
    const flow: FlowNode = {
      kind: "sequence",
      steps: [
        { kind: "map", items: { literal: ["x", "y"] }, max_items: 2, body: node("inspect") },
        { kind: "race", steps: [node("a"), node("b")] },
      ],
    };
    const tasks = runtimeTasks(expandRuntimeFlow(flow));
    expect(tasks.filter((item) => item.task_id.startsWith("inspect"))).toMatchObject([
      { task_id: "inspect__m0", depends_on: [] },
      { task_id: "inspect__m1", depends_on: [] },
    ]);
  });
});

describe("runtime control decisions", () => {
  it("selects quorum winners in candidate order and rejects impossible quorum", () => {
    const quorum = group({
      kind: "gather",
      strategy: "quorum",
      quorum: 2,
    });
    expect(decideRuntimeControl(quorum, { a: "done", b: "failed", c: "done" })).toMatchObject({
      status: "satisfied",
      winners: ["a", "c"],
      cancelled: ["b"],
    });
    expect(decideRuntimeControl(quorum, { a: "done", b: "failed", c: "failed" })).toMatchObject({
      status: "failed",
      winners: [],
    });
  });

  it("treats gather any as quorum one and leaves remaining candidates pending", () => {
    const any = group({ kind: "gather", strategy: "any", quorum: 1 });
    expect(decideRuntimeControl(any, { a: "failed", b: "done", c: "running" })).toMatchObject({
      status: "satisfied",
      winners: ["b"],
      cancelled: ["a", "c"],
    });
  });
});

describe("race engine integration", () => {
  it("records one winner, cancels losers in task order, and fences a late result", async () => {
    let releaseA = (): void => {};
    const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
    const { store, engine } = await setup(backend(async (request) => {
      if (request.task.task_id === "a") await aGate;
    }));
    const plan = orchestrationPlan(0);
    plan.tasks = [];
    plan.max_concurrency = 2;
    plan.flow = {
      kind: "sequence",
      steps: [
        { kind: "race", steps: [node("a"), node("b"), node("c")] },
        node("after"),
      ],
    };
    await engine.submit(plan, "submit");
    await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });

    const draining = engine.runUntilIdle();
    await waitFor(async () => (await engine.view()).plans.plan?.controls?.g0?.status === "satisfied");
    const won = await engine.view();
    expect(won.plans.plan?.controls?.g0).toMatchObject({
      status: "satisfied",
      winners: ["b"],
      cancelled: ["a", "c"],
    });
    expect(won.plans.plan?.tasks.a?.phase).not.toBe("done");
    expect(won.plans.plan?.tasks.b?.phase).toBe("done");

    releaseA();
    await draining;
    const final = await engine.view();
    expect(final.plans.plan?.tasks.a?.phase).toBe("cancelled");
    expect(final.plans.plan?.tasks.c?.phase).toBe("cancelled");
    expect(final.plans.plan?.tasks.after?.phase).toBe("done");
    expect(final.plans.plan?.controls?.g0?.late_results).toContain("a");
    const controlEvents = (await store.events()).flatMap((event) =>
      "orchestration" in event && event.orchestration?.control ? [event.orchestration.control.event] : []);
    expect(controlEvents).toContain("race_won");
    expect(controlEvents).toContain("late_result_rejected");
    expect(final.anomalies).toEqual([]);
  });

  it("reaches quorum after one child fails and rejects candidates beyond the winner set", async () => {
    const { store, engine } = await setup(backend(async (request) => {
      if (request.task.task_id === "a") throw new Error("candidate failed");
    }));
    const plan = orchestrationPlan(0);
    plan.tasks = [];
    plan.max_concurrency = 2;
    plan.flow = {
      kind: "gather",
      strategy: "quorum",
      quorum: 2,
      steps: [node("a"), node("b"), node("c")],
    };
    await engine.submit(plan, "submit");
    await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });

    await engine.runUntilIdle();
    const view = await engine.view();
    expect(view.plans.plan?.controls?.g0).toMatchObject({
      status: "satisfied",
      winners: ["b", "c"],
      cancelled: ["a"],
    });
    const events = await store.events();
    expect(events.some((event) =>
      "orchestration" in event && event.orchestration?.control?.event === "quorum_reached")).toBe(true);
  });

  it("fails a dynamic group when every candidate times out before dispatch", async () => {
    let calls = 0;
    const { engine } = await setup(backend(async () => { calls++; }));
    const plan = orchestrationPlan(0);
    plan.tasks = [];
    plan.flow = { kind: "race", steps: [node("a"), node("b")] };
    plan.flow.steps.forEach((step) => {
      if (step.kind === "task") step.task.deadline_ms = 1;
    });
    await engine.submit(plan, "submit");
    await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });

    await engine.runUntilIdle();
    const view = await engine.view();
    expect(calls).toBe(0);
    expect(view.plans.plan?.controls?.g0?.status).toBe("failed");
    expect(view.plans.plan?.controls?.g0?.reason).toContain("not enough candidates");
  });
});
