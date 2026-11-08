import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRemoteExecutionBackend } from "../src/orchestration/remote-backend";
import { OrchestrationEngine } from "../src/orchestration/engine";
import { OrchestrationStore } from "../src/orchestration/store";
import {
  RemoteExecutionUncertainError,
  RemoteProtocolError,
} from "../src/orchestration/remote-protocol";
import type { Capability, ExecutionRequest } from "../src/orchestration/types";
import { orchestrationPlan } from "./orchestration-fixture";
import {
  startRemoteWorkerServer,
  type RemoteWorkerServer,
  type RemoteWorkerServerOptions,
} from "./helpers/remote-worker-server";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const TOKEN = "remote-secret-token";

function request(runId = "run-1"): ExecutionRequest {
  const plan = orchestrationPlan();
  const task = plan.tasks[0]!;
  const spec = plan.agents[0]!;
  return {
    plan,
    task,
    run_id: runId,
    request_id: "request-" + runId,
    context: {
      plan_goal: plan.goal,
      plan_non_goals: plan.non_goals,
      task_goal: task.goal,
      task_non_goals: task.non_goals,
      inputs: task.inputs,
      write_scopes: task.write_scopes,
      acceptance: task.contract.acceptance,
      capability: spec.capability,
      budget: task.budget,
    },
    signal: new AbortController().signal,
  };
}

function grant(): Capability {
  return structuredClone(orchestrationPlan().agents[0]!.capability);
}

async function server(over: Partial<RemoteWorkerServerOptions> = {}): Promise<RemoteWorkerServer> {
  const instance = await startRemoteWorkerServer({
    token: TOKEN,
    grant: grant(),
    ...over,
  });
  cleanup.push(() => instance.close());
  return instance;
}

describe("remote execution backend", () => {
  it("enforces capability limits on both client and server sides", async () => {
    const remote = await server({ grant: { ...grant(), fs_read: [] } });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
    });

    expect(backend.supports(request().task, orchestrationPlan().agents[0]!)).toBeNull();
    await expect(backend.execute(request())).rejects.toMatchObject({
      code: "capability_denied",
    });

    const shell = structuredClone(orchestrationPlan());
    shell.agents[0]!.capability.shell = "sandboxed";
    expect(backend.supports(shell.tasks[0]!, shell.agents[0]!)).toContain("shell");
  });

  it("rejects request and response contract digest changes", async () => {
    const remote = await server();
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
    });

    remote.setContractDigest("tampered-request-digest");
    await expect(backend.execute(request("digest-request"))).rejects.toMatchObject({
      code: "contract_digest_mismatch",
    });

    remote.setContractDigest(undefined);
    remote.responseContractDigestOverride = "tampered-response-digest";
    await expect(backend.execute(request("digest-response"))).rejects.toMatchObject({
      code: "contract_digest_mismatch",
    });
  });

  it("rejects a stale fence before executing", async () => {
    const remote = await server();
    remote.setFence("stale-run", "new-fence");
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
      fenceFor: () => "old-fence",
    });

    await expect(backend.execute(request("stale-run"))).rejects.toMatchObject({
      code: "stale_fence",
    });
    expect(remote.executeCalls).toBe(0);
  });

  it("rejects a result that arrives after the deadline", async () => {
    const remote = await server({ delayExecuteMs: 100 });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
      heartbeatMs: 20,
      defaultDeadlineMs: 25,
    });

    await expect(backend.execute(request("deadline-run"))).rejects.toMatchObject({
      code: "deadline_exceeded",
    });
  });

  it("sends heartbeats, executes once per idempotency key, and verifies the returned revision", async () => {
    const remote = await server({ delayExecuteMs: 80 });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
      heartbeatMs: 10,
      defaultDeadlineMs: 1_000,
    });
    const input = request("idempotent-run");

    const first = await backend.execute(input);
    const second = await backend.execute(input);
    const verified = await backend.verify(input, first);

    expect(second).toEqual(first);
    expect(remote.executeRequests).toBe(2);
    expect(remote.executeCalls).toBe(1);
    expect(remote.heartbeats).toBeGreaterThan(0);
    expect(verified).toMatchObject({
      verdict: "pass",
      verifier_id: "remote-verifier",
      revision: first.revision,
    });
    expect(remote.verifyCalls).toBe(1);
  });

  it("marks an execution connection loss as needs_you instead of failed or successful", async () => {
    const remote = await server({ executeDisconnect: true });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
    });

    const error = await backend.execute(request("disconnect-run")).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RemoteExecutionUncertainError);
    expect(error).toMatchObject({ code: "disconnected", needsYou: true });
  });

  it("projects a disconnected remote run as needs_you through the orchestration engine", async () => {
    const remote = await server({ executeDisconnect: true });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
    });
    const dir = await mkdtemp(join(tmpdir(), "cairn-remote-needs-you-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const store = await OrchestrationStore.open(join(dir, "events.jsonl"));
    cleanup.push(() => store.close());
    const engine = new OrchestrationEngine({ store, backend, enabled: true });
    const plan = orchestrationPlan();

    await engine.submit(plan, "submit");
    await engine.control({ request_id: "approve", plan_id: "plan", version: 1, action: "approve_plan" });
    await engine.runUntilIdle();

    const view = await engine.view();
    expect(view.plans.plan?.tasks.t0?.phase).toBe("needs_you");
    expect(view.plans.plan?.tasks.t0?.reason).toContain("confirm the executor stopped before retrying");
    expect(view.anomalies).toEqual([]);
  });

  it("turns heartbeat loss into needs_you and stops waiting on the execute response", async () => {
    const remote = await server({ delayExecuteMs: 500, heartbeatDisconnect: true });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
      heartbeatMs: 10,
      defaultDeadlineMs: 1_000,
    });

    const error = await backend.execute(request("heartbeat-loss")).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RemoteExecutionUncertainError);
    expect(error).toMatchObject({ needsYou: true });
    expect(remote.heartbeats).toBeGreaterThan(0);
  });

  it("rejects a verify response whose revision differs from the produced result", async () => {
    const remote = await server({ verifyRevision: "different-revision" });
    const backend = createRemoteExecutionBackend({
      baseUrl: remote.url,
      token: TOKEN,
      capability: grant(),
    });
    const input = request("verify-revision");
    const result = await backend.execute(input);

    await expect(backend.verify(input, result)).rejects.toMatchObject({
      code: "internal",
    });
  });

  it("never places the bearer token in the request URL", async () => {
    const remote = await server();
    expect(() => createRemoteExecutionBackend({
      baseUrl: remote.url + "?token=" + TOKEN,
      token: TOKEN,
      capability: grant(),
    })).toThrow(/URL/);
  });
});

describe("remote protocol errors", () => {
  it("keeps protocol failures distinct from uncertain transport outcomes", () => {
    const protocol = new RemoteProtocolError("stale_fence", "stale", 409);
    const uncertain = new RemoteExecutionUncertainError();
    expect(protocol).not.toHaveProperty("needsYou");
    expect(uncertain.needsYou).toBe(true);
  });
});
