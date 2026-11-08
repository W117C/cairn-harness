import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/events";
import { OrchestrationEngine } from "../src/orchestration/engine";
import { createLocalBackend } from "../src/orchestration/local-backend";
import { createRemoteExecutionBackend } from "../src/orchestration/remote-backend";
import { projectOrchestration } from "../src/orchestration/project";
import { OrchestrationStore } from "../src/orchestration/store";
import type { AcceptanceCheck, ExecutionBackend, ExecutionRequest } from "../src/orchestration/types";
import { orchestrationPlan } from "./orchestration-fixture";
import { startRemoteWorkerServer } from "./helpers/remote-worker-server";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.restoreAllMocks();
});

async function root() {
  const directory = await mkdtemp(join(tmpdir(), "orch-lease-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function setup(backend: ExecutionBackend, directory: string, deadline?: number, acceptance?: AcceptanceCheck[]) {
  const store = await OrchestrationStore.open(join(directory, "events.jsonl"));
  cleanup.push(() => store.close());
  const observed: AgentEvent[] = [];
  const engine = new OrchestrationEngine({ store, backend, enabled: true, onEvent: event => { observed.push(event); } });
  cleanup.push(() => engine.stop());
  const plan = orchestrationPlan();
  plan.tasks[0]!.contract.acceptance = acceptance ?? [{ kind: "evidence", id: "revision", fields: ["revision"] }];
  if (deadline !== undefined) plan.tasks[0]!.deadline_ms = deadline;
  await engine.submit(plan, "submit");
  await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
  return { store, engine, observed };
}

function blockedBackend() {
  let request!: ExecutionRequest;
  let begin!: () => void;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const backend: ExecutionBackend = {
    id: "blocked", max_concurrency: 1, supports: () => null,
    async execute(input) {
      request = input; begin();
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      throw new Error("unreachable");
    },
    async verify() { throw new Error("unreachable"); },
  };
  // Optional until every adapter supports progress; an older backend remains valid.
  const progress = () => (request as ExecutionRequest & { onProgress?: () => Promise<void> }).onProgress?.();
  return { backend, began, progress, request: () => request };
}

it("keeps a local provider with durable progress alive beyond its initial lease", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const directory = await root();
  const workspace = join(directory, "workspace");
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "input.txt"), "input");
  let engine!: OrchestrationEngine;
  const backend = createLocalBackend({
    workspace, dataDir: join(directory, "data"),
    producer: { cost: { kind: "scripted" }, create: () => ({ async *stream() {
      yield { type: "assistant_delta", callId: "producer", text: "started" };
      for (const time of [1_240_000, 1_480_000]) {
        now = time;
        yield { type: "assistant_delta", callId: "producer", text: "progress" };
        await engine.tick();
      }
      yield { type: "assistant_message", content: "complete" };
    } }) },
    verifier: { cost: { kind: "scripted" }, create: context => ({ async *stream() {
      yield { type: "assistant_message", content: JSON.stringify({ verdict: "pass", revision: context.revision }) };
    } }) },
  });
  const initialized = await setup(backend, directory); engine = initialized.engine;
  const view = await engine.runUntilIdle();
  expect(view.plans.plan!.tasks.t0!.phase).toBe("done");
  expect(view.plans.plan!.tasks.t0!.attempt).toBe(1);
  expect(view.anomalies).toEqual([]);
  expect(await initialized.store.view()).toEqual(view);
});

it("still aborts silent executors and cannot revive an already expired lease", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const blocked = blockedBackend();
  const { engine } = await setup(blocked.backend, await root());
  await engine.tick(); await blocked.began;
  now = 1_300_001;
  await blocked.progress();
  await engine.tick();
  expect(blocked.request().signal.aborted).toBe(true);
  const view = await engine.runUntilIdle();
  expect(view.plans.plan!.tasks.t0!.phase).toBe("cancelled");
  expect(view.plans.plan!.tasks.t0!.attempt).toBe(1);
  expect(view.anomalies).toEqual([]);
});

it("replays bounded renewal without changing phase, reservation or attempt", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const blocked = blockedBackend();
  const { engine, store, observed } = await setup(blocked.backend, await root());
  await engine.tick(); await blocked.began;
  const before = (await engine.view()).plans.plan!.tasks.t0!;
  now = 1_240_000;
  await blocked.progress();
  const after = (await store.view()).plans.plan!.tasks.t0!;
  expect(after.lease_expires_at).toBe(1_540_000);
  expect({ ...after, lease_expires_at: before.lease_expires_at }).toEqual(before);
  const logged = (await store.events()).length;
  for (let index = 0; index < 10; index++) await blocked.progress();
  now = 1_299_999;
  await blocked.progress();
  expect((await store.events()).length).toBe(logged);

  const events = await store.events();
  expect(observed).toEqual(events);
  const renewal = events.at(-1);
  if (renewal?.type !== "agent_status") throw new Error("missing durable renewal");
  const prior = events.slice(0, -1);
  for (const invalid of [
    { ...renewal, ts: 1_300_001 },
    { ...renewal, orchestration: { ...renewal.orchestration!, attempt: 2 } },
    { ...renewal, orchestration: { ...renewal.orchestration!, lease_expires_at: 9_999_999 } },
    { ...renewal, orchestration: { ...renewal.orchestration!, actor: "producer" } },
    { ...renewal, orchestration: { ...renewal.orchestration!, run_id: "old-run" } },
    { ...renewal, agent_id: "another-agent" },
    { ...renewal, orchestration: { ...renewal.orchestration!, lease_expires_at: undefined } },
  ] as AgentEvent[]) {
    const replayed = projectOrchestration([...prior, invalid]);
    expect(replayed.plans.plan!.tasks.t0!.lease_expires_at).toBe(before.lease_expires_at);
    expect(replayed.anomalies).toHaveLength(1);
  }
});

it("does not let cancellation callbacks renew or block the command queue", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let begin!: () => void;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const backend: ExecutionBackend = {
    id: "cancel-callback", max_concurrency: 1, supports: () => null,
    async execute(request) {
      begin();
      await new Promise<void>((_resolve, reject) => request.signal.addEventListener("abort", () => {
        void Promise.resolve(request.onProgress?.()).then(() => reject(new Error("stopped")));
      }, { once: true }));
      throw new Error("unreachable");
    },
    async verify() { throw new Error("unreachable"); },
  };
  const { engine, store } = await setup(backend, await root());
  await engine.tick(); await began;
  now = 1_240_000;
  const view = await engine.control({ request_id: "cancel", plan_id: "plan", version: 1, task_id: "t0", action: "cancel_task" });
  expect(view.plans.plan!.tasks.t0!.phase).toBe("cancelled");
  expect(view.anomalies).toEqual([]);
  expect((await store.events()).filter(event => event.type === "agent_status" && event.status === "running")).toEqual([]);
});

it("ignores late progress after terminal completion and accepts old status records without a lease update", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let completedRequest!: ExecutionRequest;
  const backend: ExecutionBackend = {
    id: "complete", max_concurrency: 1, supports: () => null,
    async execute(request) { completedRequest = request; return { agent_id: "producer", summary: "done", revision: "rev", artifacts: [], evidence: {}, spent_usd: 0 }; },
    async verify() { return { verdict: "pass", verifier_id: "independent", revision: "rev", spent_usd: 0, checks: [{ id: "revision", verdict: "pass", detail: "checked" }] }; },
  };
  const { engine, store } = await setup(backend, await root());
  const done = await engine.runUntilIdle();
  const events = await store.events();
  now = 1_240_000;
  await completedRequest.onProgress?.();
  expect(await store.events()).toEqual(events);
  expect(done.plans.plan!.tasks.t0!.phase).toBe("done");
  expect(done.plans.plan!.tasks.t0!.lease_expires_at).toBeUndefined();

  const spawnIndex = events.findIndex(event => event.type === "agent_spawned");
  const spawn = events[spawnIndex]!;
  if (spawn.type !== "agent_spawned") throw new Error("missing spawn");
  const oldRecords: AgentEvent[] = [
    ...events.slice(0, spawnIndex + 1),
    { type: "agent_status", agent_id: "legacy-agent", status: "running", ts: 1_240_000 },
    { type: "agent_status", agent_id: spawn.agent_id, status: "running", reason: "interrupted", ts: 1_240_000,
      orchestration: { ...spawn.orchestration!, phase: "needs_you", lease_expires_at: undefined } },
  ];
  const oldView = projectOrchestration(oldRecords);
  expect(oldView.plans.plan!.tasks.t0).toMatchObject({ phase: "needs_you", lease_expires_at: 1_300_000, attempt: 1 });
  expect(oldView.anomalies).toEqual([]);
  const late = projectOrchestration([...events, { type: "agent_status", agent_id: spawn.agent_id, status: "running", ts: now,
    orchestration: { ...spawn.orchestration!, phase: "running", lease_expires_at: 1_540_000 } }]);
  expect(late.plans.plan!.tasks.t0!.phase).toBe("done");
  expect(late.plans.plan!.tasks.t0!.lease_expires_at).toBeUndefined();
  expect(late.anomalies).toHaveLength(1);
});

it("renews a remote executor only after acknowledged fenced heartbeats", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const capability = orchestrationPlan().agents[0]!.capability;
  const remote = await startRemoteWorkerServer({ token: "lease-token", grant: capability, delayExecuteMs: 80 });
  cleanup.push(() => remote.close());
  let engine!: OrchestrationEngine;
  let acknowledgements = 0;
  const remoteBackend = createRemoteExecutionBackend({
    baseUrl: remote.url, token: "lease-token", capability, heartbeatMs: 10, defaultDeadlineMs: 1_000_000,
  });
  const backend: ExecutionBackend = { ...remoteBackend, execute: request => remoteBackend.execute({
    ...request, onProgress: async () => {
        acknowledgements++;
        now = acknowledgements === 1 ? 1_240_000 : 1_480_000;
        await request.onProgress?.();
        await engine.tick();
    },
  }) };
  const initialized = await setup(backend, await root()); engine = initialized.engine;
  const view = await engine.runUntilIdle();
  expect(acknowledgements).toBeGreaterThanOrEqual(2);
  expect(view.plans.plan!.tasks.t0!.phase).toBe("done");
  expect(view.plans.plan!.tasks.t0!.attempt).toBe(1);
  expect(view.anomalies).toEqual([]);
});

it("allows trusted sandbox output progress to renew a long verification command", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const directory = await root();
  const workspace = join(directory, "workspace");
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "input.txt"), "input");
  let engine!: OrchestrationEngine;
  const backend = createLocalBackend({
    workspace, dataDir: join(directory, "data"),
    producer: { cost: { kind: "scripted" }, create: () => ({ async *stream() { yield { type: "assistant_message", content: "produced" }; } }) },
    verifier: { cost: { kind: "scripted" }, create: context => ({ async *stream() {
      yield { type: "assistant_message", content: JSON.stringify({ verdict: "pass", revision: context.revision }) };
    } }) },
    commandSandbox: { async run(options) {
      for (const time of [1_240_000, 1_480_000]) {
        now = time;
        await options.onProgress?.();
        await engine.tick();
      }
      return { exitCode: 0, output: "1 assertion passed", assertions: 1 };
    } },
  });
  const initialized = await setup(backend, directory, undefined, [{ kind: "command", id: "command", run: "check", timeout_ms: 600_000 }]);
  engine = initialized.engine;
  const view = await engine.runUntilIdle();
  expect(view.plans.plan!.tasks.t0!.phase).toBe("done");
  expect(view.plans.plan!.tasks.t0!.attempt).toBe(1);
  expect(view.anomalies).toEqual([]);
});

it("rechecks a newer durable lease before acting on an expired scheduling snapshot", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const blocked = blockedBackend();
  const { engine, store } = await setup(blocked.backend, await root());
  await engine.tick(); await blocked.began;
  const read = store.view.bind(store);
  let reads = 0;
  now = 1_240_000;
  const delayed = vi.spyOn(store, "view").mockImplementation(async () => {
    const snapshot = await read();
    if (++reads === 2) {
      await blocked.progress();
      now = 1_300_001;
    }
    return snapshot;
  });
  await engine.tick(); delayed.mockRestore();
  expect(blocked.request().signal.aborted).toBe(false);
  const view = await engine.view();
  expect(view.plans.plan!.tasks.t0).toMatchObject({ phase: "running", lease_expires_at: 1_540_000, attempt: 1 });
  expect(view.anomalies).toEqual([]);
});

it("does not renew when remote heartbeats fail", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const capability = orchestrationPlan().agents[0]!.capability;
  const remote = await startRemoteWorkerServer({ token: "lease-token", grant: capability, delayExecuteMs: 500, heartbeatDisconnect: true });
  cleanup.push(() => remote.close());
  const backend = createRemoteExecutionBackend({
    baseUrl: remote.url, token: "lease-token", capability, heartbeatMs: 10, defaultDeadlineMs: 1_000_000,
    fetch: async (url, init) => {
      if (String(url).endsWith("/v1/heartbeat")) now = 1_240_000;
      return fetch(url, init);
    },
  });
  const { engine } = await setup(backend, await root());
  const view = await engine.runUntilIdle();
  expect(remote.heartbeats).toBeGreaterThan(0);
  expect(view.plans.plan!.tasks.t0).toMatchObject({ phase: "needs_you", lease_expires_at: 1_300_000, attempt: 1 });
  expect(view.anomalies).toEqual([]);
});

it("expires a remote executor whose heartbeat requests never receive acknowledgements", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const capability = orchestrationPlan().agents[0]!.capability;
  const remote = await startRemoteWorkerServer({ token: "lease-token", grant: capability, delayExecuteMs: 500 });
  cleanup.push(() => remote.close());
  let heartbeatStarted!: () => void;
  const silentHeartbeat = new Promise<void>(resolve => { heartbeatStarted = resolve; });
  const backend = createRemoteExecutionBackend({
    baseUrl: remote.url, token: "lease-token", capability, heartbeatMs: 10, defaultDeadlineMs: 1_000_000,
    fetch: async (url, init) => {
      if (!String(url).endsWith("/v1/heartbeat")) return fetch(url, init);
      heartbeatStarted();
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
  });
  const { engine } = await setup(backend, await root());
  await engine.tick(); await silentHeartbeat;
  now = 1_300_001;
  await engine.tick();
  const view = await engine.runUntilIdle();
  expect(view.plans.plan!.tasks.t0!.phase).toBe("cancelled");
  expect(view.plans.plan!.tasks.t0!.attempt).toBe(1);
  expect(view.anomalies).toEqual([]);
});

it("caps progress renewal at the declared task deadline", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const blocked = blockedBackend();
  const { engine } = await setup(blocked.backend, await root(), 1_400_000);
  await engine.tick(); await blocked.began;
  now = 1_240_000;
  await blocked.progress();
  expect((await engine.view()).plans.plan!.tasks.t0!.lease_expires_at).toBe(1_400_000);
  now = 1_400_001;
  await engine.tick();
  expect(blocked.request().signal.aborted).toBe(true);
});
