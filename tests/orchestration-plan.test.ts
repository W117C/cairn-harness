import { describe, expect, it } from "vitest";
import { expandFlow } from "../src/orchestration/flow.js";
import { parsePlan } from "../src/orchestration/validate.js";
import type { AgentSpec, FlowNode, FlowTask, OrchPlan } from "../src/orchestration/types.js";

function task(id = "inspect"): FlowTask {
  return {
    task_id: id, goal: "Inspect repository", non_goals: [], agent_spec: "reader", lane: "read",
    depends_on: [], write_scopes: [], inputs: [],
    contract: { effect: "none", acceptance: [{ kind: "evidence", id: "proof", fields: ["summary"] }] },
    budget: { usd: 0.5 }, max_attempts: 2, priority: 0,
  };
}
function agent(): AgentSpec {
  return {
    agent_spec_id: "reader", role: "Inspect source", max_turns: 10,
    capability: { tools: ["read_file"], fs_read: ["."], fs_write: [], network: [], shell: "none", git: "read", external_effects: "none" },
  };
}
function plan(): OrchPlan {
  return {
    plan_id: "plan-a", version: 1, goal: "Review a change", non_goals: [], domain: "coding",
    tasks: [task()], agents: [agent()], budget: { usd: 1 }, max_concurrency: 2,
    policy_ref: "local-policy-v1", created_by: "user",
  };
}
function node(id: string): FlowNode { return { kind: "task", task: task(id) }; }

describe("orchestration plan parsing", () => {
  it("accepts a complete read plan and returns detached JSON data", () => {
    const input = plan();
    const parsed = parsePlan(input);
    expect(parsed.tasks[0]?.goal).toBe("Inspect repository");
    input.tasks[0]!.goal = "changed after validation";
    expect(parsed.tasks[0]?.goal).toBe("Inspect repository");
  });

  it.each([
    ["version zero", (p: OrchPlan) => { p.version = 0; }, /version/],
    ["version overflow", (p: OrchPlan) => { p.version = 33; }, /version/],
    ["fractional version", (p: OrchPlan) => { p.version = 1.5; }, /version/],
    ["zero concurrency", (p: OrchPlan) => { p.max_concurrency = 0; }, /max_concurrency/],
    ["large concurrency", (p: OrchPlan) => { p.max_concurrency = 17; }, /max_concurrency/],
    ["zero attempts", (p: OrchPlan) => { p.tasks[0]!.max_attempts = 0; }, /max_attempts/],
    ["large attempts", (p: OrchPlan) => { p.tasks[0]!.max_attempts = 6; }, /max_attempts/],
    ["NaN plan budget", (p: OrchPlan) => { p.budget.usd = Number.NaN; }, /finite|JSON|budget/],
    ["Infinity task budget", (p: OrchPlan) => { p.tasks[0]!.budget.usd = Infinity; }, /finite|JSON|budget/],
    ["negative task budget", (p: OrchPlan) => { p.tasks[0]!.budget.usd = -1; }, /budget/],
    ["unknown agent", (p: OrchPlan) => { p.tasks[0]!.agent_spec = "missing"; }, /agent_spec/],
    ["missing acceptance", (p: OrchPlan) => { p.tasks[0]!.contract.acceptance = []; }, /acceptance/],
    ["read effect", (p: OrchPlan) => { p.tasks[0]!.contract.effect = "workspace"; }, /read|effect/],
    ["read write capability", (p: OrchPlan) => { p.agents[0]!.capability.fs_write = ["src"]; }, /read|capability/],
    ["read git merge", (p: OrchPlan) => { p.agents[0]!.capability.git = "merge"; }, /read|capability/],
    ["bad check timeout", (p: OrchPlan) => { p.tasks[0]!.contract.acceptance = [{ kind: "command", id: "test", run: "pnpm test", timeout_ms: 0 }]; }, /timeout_ms/],
  ])("rejects %s", (_name, mutate, error) => {
    const input = plan();
    mutate(input);
    expect(() => parsePlan(input)).toThrow(error);
  });

  it.each([
    ["plan", (p: any) => { p.surprise = true; }],
    ["task", (p: any) => { p.tasks[0].surprise = true; }],
    ["capability", (p: any) => { p.agents[0].capability.surprise = true; }],
    ["acceptance", (p: any) => { p.tasks[0].contract.acceptance[0].surprise = true; }],
    ["flow", (p: any) => { p.flow = { kind: "parallel", steps: [], surprise: true }; }],
  ])("does not discard unknown %s fields", (_name, mutate) => {
    const input = plan();
    mutate(input);
    expect(() => parsePlan(input)).toThrow(/unknown|unexpected/);
  });

  it("rejects non JSON values instead of coercing them", () => {
    const input = plan() as any;
    input.tasks[0].deadline_ms = undefined;
    expect(() => parsePlan(input)).toThrow(/JSON|undefined/);
    input.tasks[0].deadline_ms = new Date();
    expect(() => parsePlan(input)).toThrow(/JSON|object/);
    const hidden = plan();
    Object.defineProperty(hidden, "ignored", { value: true, enumerable: false });
    expect(() => parsePlan(hidden)).toThrow(/JSON|enumerable/);
    const accessor = plan();
    Object.defineProperty(accessor.tasks, "0", { get: () => { throw new Error("accessor executed"); } });
    expect(() => parsePlan(accessor)).toThrow(/JSON.*accessor/);
  });

  it("rejects duplicate task IDs, unknown dependencies, and dependency cycles", () => {
    const duplicate = plan();
    duplicate.tasks.push(task());
    expect(() => parsePlan(duplicate)).toThrow(/duplicate.*task/i);
    const missing = plan();
    missing.tasks[0]!.depends_on = ["missing"];
    expect(() => parsePlan(missing)).toThrow(/depend/);
    const cycle = plan();
    cycle.tasks = [task("a"), task("b")];
    cycle.tasks[0]!.depends_on = ["b"];
    cycle.tasks[1]!.depends_on = ["a"];
    expect(() => parsePlan(cycle)).toThrow(/cycle|cyclic/);
  });

  it("rejects duplicate agent IDs and duplicate acceptance IDs", () => {
    const duplicate = plan();
    duplicate.agents.push(agent());
    expect(() => parsePlan(duplicate)).toThrow(/duplicate.*agent/i);
    const checks = plan();
    checks.tasks[0]!.contract.acceptance.push({ kind: "human", id: "proof", instruction: "Approve" });
    expect(() => parsePlan(checks)).toThrow(/duplicate.*acceptance/i);
  });

  it("rejects more than 256 flat tasks", () => {
    const input = plan();
    input.tasks = Array.from({ length: 257 }, (_, index) => task(`task-${index}`));
    expect(() => parsePlan(input)).toThrow(/256|tasks/);
  });

  it.each(["../escape", "/tmp/escape", "src/../../escape", "C:/escape", "C:\\escape", "src\\..\\escape", "src/./alias", "src//alias", "~/escape", "src\u0000/file"])("rejects escaping or ambiguous write scope %s", (scope) => {
    const input = plan();
    input.tasks[0]!.lane = "write";
    input.tasks[0]!.contract.effect = "workspace";
    input.tasks[0]!.write_scopes = [scope];
    input.agents[0]!.capability.fs_write = [scope];
    expect(() => parsePlan(input)).toThrow(/scope|relative|path/);
  });

  it("accepts a write task only inside the declared capability", () => {
    const input = plan();
    input.tasks[0]!.lane = "write";
    input.tasks[0]!.contract.effect = "workspace";
    input.tasks[0]!.write_scopes = ["src/orchestration"];
    input.agents[0]!.capability.fs_write = ["src"];
    input.agents[0]!.capability.tools = ["write_file"];
    expect(parsePlan(input).tasks[0]?.lane).toBe("write");
    input.tasks[0]!.write_scopes = ["src-other"];
    expect(() => parsePlan(input)).toThrow(/capability|scope/);
  });

  it("requires external capability and recovery contract for external tasks", () => {
    const input = plan();
    input.tasks[0]!.lane = "external";
    input.tasks[0]!.contract.effect = "external";
    expect(() => parsePlan(input)).toThrow(/external|idempotency|rollback/);
    input.tasks[0]!.contract.idempotency_key = "publish-v1";
    input.tasks[0]!.contract.rollback = "Delete the published object by its key";
    input.agents[0]!.capability.external_effects = "allowlist";
    input.agents[0]!.capability.network = ["example.com"];
    expect(parsePlan(input).tasks[0]?.lane).toBe("external");
  });

  it("uses an expanded flow as the only task source when flat tasks are empty", () => {
    const input = plan();
    input.tasks = [];
    input.flow = { kind: "sequence", steps: [node("a"), node("b")] };
    expect(parsePlan(input).tasks.map(({ task_id, depends_on }) => ({ task_id, depends_on }))).toEqual([
      { task_id: "a", depends_on: [] }, { task_id: "b", depends_on: ["a"] },
    ]);
  });

  it("rejects conflicting flat and flow definitions", () => {
    const input = plan();
    input.flow = node("other-task");
    expect(() => parsePlan(input)).toThrow(/flow.*tasks|tasks.*flow|conflict/);
    input.flow = { kind: "task", task: task() };
    expect(parsePlan(input).tasks).toHaveLength(1);
  });

  it("does not accept a dynamic flow ref without a logged binding", () => {
    const input = plan();
    input.tasks = [];
    input.flow = { kind: "branch", when: { ref: "result.ok" }, then: node("a") };
    expect(() => parsePlan(input)).toThrow(/unbound.*ref|binding/);
  });
});

describe("bounded static Flow expansion", () => {
  it("adds sequence barriers across nested parallel branches", () => {
    const flow: FlowNode = { kind: "sequence", steps: [
      { kind: "parallel", steps: [node("a"), node("b")] },
      { kind: "parallel", steps: [node("c"), node("d")] },
    ] };
    expect(expandFlow(flow).map(({ task_id, depends_on }) => ({ task_id, depends_on }))).toEqual([
      { task_id: "a", depends_on: [] }, { task_id: "b", depends_on: [] },
      { task_id: "c", depends_on: ["a", "b"] }, { task_id: "d", depends_on: ["a", "b"] },
    ]);
    expect((flow.steps[1] as { kind: "parallel"; steps: FlowNode[] }).steps[0]).toEqual(node("c"));
  });

  it("preserves explicit dependencies and rejects cycles", () => {
    const second = task("b"); second.depends_on = ["a"];
    expect(expandFlow({ kind: "parallel", steps: [node("a"), { kind: "task", task: second }] })[1]?.depends_on).toEqual(["a"]);
    const first = task("a"); first.depends_on = ["b"];
    expect(() => expandFlow({ kind: "sequence", steps: [{ kind: "task", task: first }, node("b")] })).toThrow(/cycle|cyclic/);
  });

  it("preserves max_concurrency through conservative DAG barriers", () => {
    const flow: FlowNode = { kind: "parallel", max_concurrency: 2, steps: [node("a"), node("b"), node("c"), node("d")] };
    expect(expandFlow(flow).map(({ task_id, depends_on }) => ({ task_id, depends_on }))).toEqual([
      { task_id: "a", depends_on: [] }, { task_id: "b", depends_on: [] },
      { task_id: "c", depends_on: ["a", "b"] }, { task_id: "d", depends_on: ["a", "b"] },
    ]);
  });

  it("expands bounded map with unique IDs, remapped local dependencies, and item bindings", () => {
    const second = task("b"); second.depends_on = ["a"];
    const flow: FlowNode = {
      kind: "map", items: { literal: [true, false] }, max_items: 2,
      body: { kind: "sequence", steps: [node("a"), { kind: "branch", when: { ref: "item" }, then: { kind: "task", task: second } }] },
    };
    expect(expandFlow(flow).map(({ task_id, depends_on }) => ({ task_id, depends_on }))).toEqual([
      { task_id: "a__m0", depends_on: [] }, { task_id: "b__m0", depends_on: ["a__m0"] },
      { task_id: "a__m1", depends_on: [] },
    ]);
  });

  it("accepts explicit nested ref bindings without evaluating source strings", () => {
    const flow: FlowNode = { kind: "branch", when: { ref: "result.ok" }, then: node("yes"), else: node("no") };
    expect(expandFlow(flow, { result: { ok: false } }).map((entry) => entry.task_id)).toEqual(["no"]);
    expect(() => expandFlow(flow)).toThrow(/unbound.*ref|binding/);
    expect(() => expandFlow(flow, { result: { ok: "globalThis.process.exit()" } })).toThrow(/boolean/);
  });

  it("expands a constant bounded loop serially and omits a false loop", () => {
    const flow: FlowNode = { kind: "loop", while: { literal: true }, max_iterations: 2, body: node("try") };
    expect(expandFlow(flow).map(({ task_id, depends_on }) => ({ task_id, depends_on }))).toEqual([
      { task_id: "try__l0", depends_on: [] }, { task_id: "try__l1", depends_on: ["try__l0"] },
    ]);
    expect(expandFlow({ ...flow, while: { literal: false } })).toEqual([]);
  });

  it.each([
    [{ kind: "race", steps: [node("a"), node("b")] }, /race.*DAG|race.*unsupported/],
    [{ kind: "gather", strategy: "any", steps: [node("a")] }, /gather.*any/],
    [{ kind: "gather", strategy: "quorum", quorum: 1, steps: [node("a")] }, /gather.*quorum/],
    [{ kind: "checkpoint", label: "Approve" }, /checkpoint/],
    [{ kind: "escalate", reason: "Need a person" }, /escalate/],
  ] as [FlowNode, RegExp][])("rejects control node that requires runtime state: %j", (flow, error) => {
    expect(() => expandFlow(flow)).toThrow(error);
  });

  it("supports gather all as a dependency-preserving parallel group", () => {
    expect(expandFlow({ kind: "sequence", steps: [{ kind: "gather", strategy: "all", steps: [node("a"), node("b")] }, node("c")] })[2]?.depends_on).toEqual(["a", "b"]);
  });

  it.each([
    [{ kind: "map", items: { literal: [1, 2] }, max_items: 1, body: node("a") }, /max_items/],
    [{ kind: "map", items: { literal: "items" }, max_items: 2, body: node("a") }, /array/],
    [{ kind: "loop", while: { literal: true }, max_iterations: 257, body: node("a") }, /max_iterations/],
    [{ kind: "parallel", max_concurrency: 17, steps: [node("a")] }, /max_concurrency/],
    [{ kind: "parallel", steps: [node("a"), node("a")] }, /duplicate.*task/i],
  ] as [FlowNode, RegExp][])("rejects invalid static flow bounds: %j", (flow, error) => {
    expect(() => expandFlow(flow)).toThrow(error);
  });

  it("enforces the 256-task cap across nested expansion", () => {
    expect(() => expandFlow({ kind: "map", items: { literal: Array.from({ length: 17 }, () => true) }, max_items: 17,
      body: { kind: "loop", while: { literal: true }, max_iterations: 16, body: node("a") } })).toThrow(/256|task.*limit/);
    const empty: FlowNode = { kind: "map", items: { literal: Array.from({ length: 256 }, () => true) }, max_items: 256,
      body: { kind: "map", items: { literal: Array.from({ length: 256 }, () => true) }, max_items: 256, body: { kind: "parallel", steps: [] } } };
    expect(() => expandFlow(empty)).toThrow(/expansion.*limit/);
  });

  it("rejects unresolved task string templates rather than pretending to expand them", () => {
    const template = task("impl-${index}");
    expect(() => expandFlow({ kind: "map", items: { literal: ["src"] }, max_items: 1, body: { kind: "task", task: template } })).toThrow(/template|interpolat/);
  });

  it("fails closed on prototype traversal and unknown flow fields", () => {
    expect(() => expandFlow({ kind: "branch", when: { ref: "__proto__.polluted" }, then: node("a") }, {})).toThrow(/ref|binding/);
    expect(() => expandFlow({ kind: "parallel", steps: [], ignored: true } as unknown as FlowNode)).toThrow(/unknown|unexpected/);
  });
});
