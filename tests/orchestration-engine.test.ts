import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestrationStore } from "../src/orchestration/store";
import { OrchestrationEngine } from "../src/orchestration/engine";
import type { ExecutionBackend, ExecutionRequest } from "../src/orchestration/types";
import { orchestrationPlan } from "./orchestration-fixture";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(backend: ExecutionBackend, enabled = true) {
  const dir = await mkdtemp(join(tmpdir(), "cairn-orchestration-engine-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = await OrchestrationStore.open(join(dir, "events.jsonl")); cleanup.push(() => store.close());
  const engine = new OrchestrationEngine({ store, backend, enabled });
  return { store, engine };
}
function backend(onExecute?: (r: ExecutionRequest) => Promise<void>): ExecutionBackend {
  return { id: "scripted", max_concurrency: 3, supports: () => null,
    execute: async r => { await onExecute?.(r); return { agent_id: "producer:" + r.run_id, summary: "complete", revision: "hash", artifacts: [], evidence: { answer: "yes" }, spent_usd: 0.01 }; },
    verify: async () => ({ verdict: "pass", verifier_id: "independent", revision: "hash", checks: [{ id: "answer", verdict: "pass", detail: "checked answer" }], spent_usd: 0.01 }),
  };
}
it("queues 120 tasks, verifies independently and replays identical completion", async () => {
  let active = 0, peak = 0, calls = 0;
  const { store, engine } = await setup(backend(async () => { active++; peak = Math.max(peak, active); calls++; await Promise.resolve(); active--; }));
  const plan = orchestrationPlan(120); plan.budget.usd = 200; plan.max_concurrency = 3;
  await engine.submit(plan, "submit"); await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
  await engine.runUntilIdle();
  const view = await store.view();
  expect(Object.values(view.plans.plan!.tasks).filter(t => t.phase === "done")).toHaveLength(120);
  expect(calls).toBe(120); expect(peak).toBeLessThanOrEqual(3); expect(view.anomalies).toEqual([]);
  expect(await engine.view()).toEqual(view);
});
it("deduplicates submit and control keys but rejects key reuse with a different payload", async () => {
  let calls = 0; const { engine } = await setup(backend(async () => { calls++; }));
  const plan = orchestrationPlan(); await engine.submit(plan, "submit"); await engine.submit(plan, "submit");
  await expect(engine.submit({ ...plan, goal: "different" }, "submit")).rejects.toThrow(/request|幂等/);
  const cmd = { request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" as const };
  await Promise.all([engine.control(cmd), engine.control(cmd)]); await engine.runUntilIdle(); expect(calls).toBe(1);
});
it("shadow mode persists plans and performs no backend calls", async () => {
  let calls = 0; const { engine } = await setup(backend(async () => { calls++; }), false);
  await engine.submit(orchestrationPlan(), "submit"); await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
  await engine.runUntilIdle(); expect(calls).toBe(0);
});
it("producer success cannot become done when verifier rejects", async () => {
  const b = backend(); b.verify = async () => ({ verdict: "fail", verifier_id: "independent", revision: "hash", checks: [{ id: "answer", verdict: "fail", detail: "wrong" }], spent_usd: 0 });
  const { engine } = await setup(b); await engine.submit(orchestrationPlan(), "submit");
  await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" }); await engine.runUntilIdle();
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("failed");
});
it("cancel waits until the running backend acknowledges abort", async () => {
  let started!: () => void; const began = new Promise<void>(r => { started = r; });
  const { engine } = await setup(backend(async r => { started(); await new Promise<void>((resolve, reject) => { r.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }); }));
  await engine.submit(orchestrationPlan(), "submit"); await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
  await engine.tick(); await began;
  await engine.control({ request_id: "cancel", plan_id: "plan", version: 1, action: "cancel_plan" });
  expect((await engine.view()).plans.plan!.phase).toBe("cancelled");
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("cancelled");
});
it("an invalid reused control key cannot cancel an active run", async () => {
  let started!: () => void, release!: () => void; let aborted = false;
  const began = new Promise<void>(r => { started = r; }); const gate = new Promise<void>(r => { release = r; });
  const { engine } = await setup(backend(async r => { r.signal.addEventListener("abort", () => { aborted = true; release(); }); started(); await gate; }));
  await engine.submit(orchestrationPlan(), "submit"); await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
  await engine.tick(); await began;
  await expect(engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "cancel_plan" })).rejects.toThrow(/request/);
  release(); await engine.runUntilIdle(); expect(aborted).toBe(false);
});
it("rolls back a verified delivery once and records the changed evidence state", async () => {
  let rollbacks = 0; const b = backend(); b.deliver = async () => ({ revision: "hash" }); b.rollback = async () => { rollbacks++; };
  const { engine } = await setup(b); const plan = orchestrationPlan();
  // Delivery is a backend effect. Use a write grant consistent with the task contract.
  plan.tasks[0]!.lane = "write"; plan.tasks[0]!.write_scopes = ["src"]; plan.tasks[0]!.contract.effect = "workspace";
  plan.agents[0]!.capability.fs_write = ["src"]; plan.agents[0]!.capability.tools.push("write_file");
  await engine.submit(plan, "submit"); await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" }); await engine.runUntilIdle();
  const cmd = { request_id: "rollback", plan_id: "plan", version: 1, task_id: "t0", action: "rollback_task" as const };
  await engine.control(cmd); await engine.control(cmd); expect(rollbacks).toBe(1);
  const t = (await engine.view()).plans.plan!.tasks.t0!; expect(t.phase).toBe("needs_you"); expect(t.evidence).toBe("stale");
});
it("invalid plan transitions are rejected without poisoning the log", async () => {
  const { engine } = await setup(backend()); await engine.submit(orchestrationPlan(), "submit");
  await expect(engine.control({ request_id: "bad", plan_id: "plan", version: 1, action: "pause_plan" })).rejects.toThrow(/transition/);
  expect((await engine.view()).anomalies).toEqual([]);
});
