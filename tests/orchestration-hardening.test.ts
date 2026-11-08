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
async function setup(backend: ExecutionBackend) {
  const dir = await mkdtemp(join(tmpdir(), "cairn-orchestration-hardening-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = await OrchestrationStore.open(join(dir, "events.jsonl")); cleanup.push(() => store.close());
  return { store, engine: new OrchestrationEngine({ store, backend, enabled: true }) };
}
function backend(overrides: Partial<ExecutionBackend> = {}): ExecutionBackend {
  return { id: "scripted", max_concurrency: 3, supports: () => null,
    execute: async (r) => ({ agent_id: "producer:" + r.run_id, summary: "complete", revision: "hash", artifacts: [], evidence: { answer: "yes" }, spent_usd: 0.01 }),
    verify: async () => ({ verdict: "pass", verifier_id: "independent", revision: "hash", checks: [{ id: "answer", verdict: "pass", detail: "checked" }], spent_usd: 0.01 }),
    ...overrides };
}
async function start(engine: OrchestrationEngine) {
  await engine.submit(orchestrationPlan(), "submit");
  await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
}

it("retries a needs_you task instead of leaving its run id unresolvable", async () => {
  const b = backend({ verify: async () => ({ verdict: "unverifiable", verifier_id: "independent", revision: "hash", checks: [{ id: "answer", verdict: "unverifiable", detail: "cannot judge" }], spent_usd: 0.01 }) });
  const { engine } = await setup(b);
  await start(engine); await engine.runUntilIdle();
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("needs_you");
  await engine.control({ request_id: "retry", plan_id: "plan", version: 1, action: "retry_task", task_id: "t0" });
  const task = (await engine.view()).plans.plan!.tasks.t0!;
  expect(task.phase).toBe("queued");
  expect(task.run_id).toBeUndefined();
});

it("refuses cancel on a done task, so retry cannot duplicate delivery", async () => {
  let deliveries = 0;
  const b = backend({ deliver: async () => { deliveries += 1; return { revision: "hash" }; } });
  const { engine } = await setup(b); const plan = orchestrationPlan();
  const task = plan.tasks[0]!; task.lane = "write"; task.write_scopes = ["src"]; task.contract.effect = "workspace";
  plan.agents[0]!.capability.fs_write = ["src"]; plan.agents[0]!.capability.tools.push("write_file");
  await engine.submit(plan, "submit"); await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
  await engine.runUntilIdle();
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("done");
  await expect(engine.control({ request_id: "cancel", plan_id: "plan", version: 1, action: "cancel_task", task_id: "t0" })).rejects.toThrow(/terminated/);
  expect(deliveries).toBe(1);
});

it("cancelling a run before any result does not turn the reservation into spend", async () => {
  let begin!: () => void; const started = new Promise<void>((resolve) => { begin = resolve; });
  const b = backend({ execute: async (r) => { begin(); await new Promise<void>((_, reject) => r.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); throw new Error("unreachable"); } });
  const { engine } = await setup(b); await start(engine);
  await engine.tick(); await started;
  await engine.control({ request_id: "cancel", plan_id: "plan", version: 1, action: "cancel_task", task_id: "t0" });
  const task = (await engine.view()).plans.plan!.tasks.t0!;
  expect(task.phase).toBe("cancelled"); expect(task.spent_usd).toBe(0);
});

it("pause_task stops a live run and resume_task starts a fresh attempt", async () => {
  let attempts = 0; let begin!: () => void; const started = new Promise<void>((resolve) => { begin = resolve; });
  const b = backend({ execute: async (r) => {
    attempts += 1;
    if (attempts === 1) { begin(); await new Promise<void>((_, reject) => r.signal.addEventListener("abort", () => reject(new Error("paused")), { once: true })); }
    return { agent_id: "producer:" + r.run_id, summary: "complete", revision: "hash", artifacts: [], evidence: { answer: "yes" }, spent_usd: 0.01 };
  } });
  const { engine } = await setup(b); await start(engine); await engine.tick(); await started;
  await engine.control({ request_id: "pause", plan_id: "plan", version: 1, action: "pause_task", task_id: "t0" });
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("paused");
  await engine.control({ request_id: "resume", plan_id: "plan", version: 1, action: "resume_task", task_id: "t0" });
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("queued");
  await engine.runUntilIdle();
  expect((await engine.view()).plans.plan!.tasks.t0!.phase).toBe("done");
  expect(attempts).toBe(2);
});

it("does not freeze every plan because one plan has a projection anomaly", async () => {
  const { store, engine } = await setup(backend());
  await store.append({ type: "agent_status", agent_id: "ghost", status: "done", orchestration: { schema_version: 1, plan_id: "missing", version: 1 } } as never);
  await start(engine);
  expect(await engine.tick()).toBe(1);
  await engine.stop();
});
