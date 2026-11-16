// 一轮的自动仲裁判卷（发言权在编排引擎里的调用点）。
//
// 判的是什么：
//   ① paused ⇒ 这一轮**不派**，且落一条 `needs_you` 状态（停要有原因，人和 UI 都看得见）；
//   ② order ⇒ 只改派发顺序（`agent_spawned` 的先后），不改并发与依赖；
//   ③ 仲裁器自己抛错 ⇒ **fail-open**（这一轮照常派，不能因为策略坏了把活卡死）；
//   ④ `teamRoundArbiter`：空转到阈值 ⇒ 停机；否则主持先派。
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestrationStore } from "../src/orchestration/store";
import { OrchestrationEngine } from "../src/orchestration/engine";
import { IDLE_PAUSE_REASON, teamRoundArbiter, type RoundArbiter } from "../src/orchestration/round-arbiter";
import type { ExecutionBackend, ExecutionRequest } from "../src/orchestration/types";
import { orchestrationPlan } from "./orchestration-fixture";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function setup(backend: ExecutionBackend, roundArbiter: RoundArbiter) {
  const dir = await mkdtemp(join(tmpdir(), "cairn-round-arbiter-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = await OrchestrationStore.open(join(dir, "events.jsonl"));
  cleanup.push(() => store.close());
  const engine = new OrchestrationEngine({ store, backend, enabled: true, roundArbiter });
  return { store, engine };
}

function backend(calls: ExecutionRequest[]): ExecutionBackend {
  return { id: "scripted", max_concurrency: 3, supports: () => null,
    execute: async (r) => { calls.push(r); return { agent_id: "producer:" + r.run_id, summary: "ok", revision: "h", artifacts: [], evidence: { answer: "yes" }, spent_usd: 0 }; },
    verify: async () => ({ verdict: "pass", verifier_id: "independent", revision: "h", checks: [{ id: "a", verdict: "pass", detail: "ok" }], spent_usd: 0 }),
  };
}

async function approved(engine: OrchestrationEngine, tasks = 3): Promise<void> {
  const plan = orchestrationPlan(tasks);
  await engine.submit(plan, "submit");
  await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
}

it("仲裁 paused ⇒ 这一轮不派，并落一条 needs_you 状态", async () => {
  const calls: ExecutionRequest[] = [];
  const { store, engine } = await setup(backend(calls), () => ({ paused: true, reason: IDLE_PAUSE_REASON }));
  await approved(engine);
  await engine.runUntilIdle();
  expect(calls).toHaveLength(0);
  const events = await store.events();
  const needsYou = events.filter((e) => e.type === "agent_status" && (e as { orchestration?: { phase?: string } }).orchestration?.phase === "needs_you");
  expect(needsYou).toHaveLength(1);
  expect((needsYou[0] as { reason?: string }).reason).toBe(IDLE_PAUSE_REASON);
});

it("仲裁 order ⇒ 改派发顺序（agent_spawned 的先后）", async () => {
  const calls: ExecutionRequest[] = [];
  const waves: string[][] = [];
  const { store, engine } = await setup(backend(calls), ({ task_ids }) => {
    waves.push([...task_ids]);
    return { paused: false, order: [...task_ids].reverse() };
  });
  await approved(engine, 3);
  await engine.runUntilIdle();
  // 判「派发顺序」读 `agent_spawned` 的落盘顺序：execute() 是异步的，`calls` 的先后会被
  // 每轮的落盘 await 打乱，拿它当顺序判据是假读数（第一版就是这么错的）。
  const spawned = (await store.events())
    .filter((e) => e.type === "agent_spawned")
    .map((e) => (e as { task?: string }).task);
  // 并发上限是**计划自己**的 `max_concurrency`（fixture = 2）⇒ 两轮：先 [t0,t1]（被反转），再 [t2]。
  expect(waves).toEqual([["t0", "t1"], ["t2"]]);
  expect(spawned).toEqual(["Read evidence 1", "Read evidence 0", "Read evidence 2"]);
  expect(calls).toHaveLength(3);
});

it("仲裁器抛错 ⇒ fail-open：这一轮照常派", async () => {
  const calls: ExecutionRequest[] = [];
  const { engine } = await setup(backend(calls), () => { throw new Error("策略坏了"); });
  await approved(engine, 2);
  await engine.runUntilIdle();
  expect(calls).toHaveLength(2);
});

it("teamRoundArbiter：空转到阈值 ⇒ 停机；否则主持先派", async () => {
  const paused = teamRoundArbiter({ members: [{ id: "m1", role: "主持" }], idleRounds: 6 })(
    { plan_id: "p", version: 1, task_ids: ["a", "b"] },
  );
  expect(paused.paused).toBe(true);
  const normal = teamRoundArbiter({ members: [{ id: "b", role: "主持" }, { id: "a", role: "实现" }] })(
    { plan_id: "p", version: 1, task_ids: ["a", "b"] },
  );
  expect(normal.paused).toBe(false);
  expect(normal.order).toEqual(["b", "a"]);
});
