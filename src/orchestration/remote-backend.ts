import { createHash } from "node:crypto";
import type {
  AgentSpec,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
  VerificationResult,
} from "./types";
import {
  REMOTE_PROTOCOL_VERSION,
  RemoteExecutionUncertainError,
  RemoteProtocolError,
  assertArtifactRefs,
  capabilityCovers,
  parseRemoteError,
  remoteContractDigest,
  remoteIdempotencyKey,
  type RemoteExecutionEnvelope,
  type RemoteExecutionResponse,
  type RemoteHeartbeat,
  type RemoteVerifyRequest,
  type RemoteVerifyResponse,
} from "./remote-protocol";

export interface RemoteExecutionBackendOptions {
  baseUrl: string;
  token: string;
  capability: RemoteExecutionEnvelope["capability"];
  maxConcurrency?: number;
  heartbeatMs?: number;
  defaultDeadlineMs?: number;
  fetch?: typeof globalThis.fetch;
  fenceFor?: (request: ExecutionRequest) => string;
  agentIdFor?: (request: ExecutionRequest) => string;
  deadlineAtFor?: (request: ExecutionRequest) => number;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function specFor(request: ExecutionRequest): AgentSpec {
  const spec = request.plan.agents.find((agent) => agent.agent_spec_id === request.task.agent_spec);
  if (!spec) throw new Error("missing task agent spec");
  return spec;
}

function numberInRange(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(name + " is invalid");
  return value;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 1_048_576) throw new RemoteExecutionUncertainError("remote response exceeded 1 MiB; outcome is unknown");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (response.ok) throw new RemoteExecutionUncertainError("remote response was not JSON; outcome is unknown");
    throw new RemoteProtocolError("internal", "remote error response was not JSON", response.status);
  }
}

function assertExecutionResult(value: unknown): asserts value is ExecutionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteProtocolError("internal", "remote execution result is malformed");
  }
  const result = value as Partial<ExecutionResult>;
  if (typeof result.agent_id !== "string" || !result.agent_id.trim() ||
      typeof result.summary !== "string" ||
      typeof result.revision !== "string" || !result.revision.trim() ||
      !Number.isFinite(result.spent_usd) || (result.spent_usd ?? -1) < 0 ||
      !result.evidence || typeof result.evidence !== "object" || Array.isArray(result.evidence)) {
    throw new RemoteProtocolError("internal", "remote execution result is malformed");
  }
  assertArtifactRefs(result.artifacts);
}

function assertVerification(value: unknown): asserts value is VerificationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteProtocolError("internal", "remote verification result is malformed");
  }
  const result = value as Partial<VerificationResult>;
  if (!["pass", "fail", "unverifiable"].includes(result.verdict ?? "") ||
      typeof result.verifier_id !== "string" || !result.verifier_id.trim() ||
      typeof result.revision !== "string" || !result.revision.trim() ||
      !Number.isFinite(result.spent_usd) || (result.spent_usd ?? -1) < 0 ||
      !Array.isArray(result.checks) ||
      result.checks.some((check) =>
        !check || typeof check.id !== "string" || !["pass", "fail", "unverifiable"].includes(check.verdict) ||
        typeof check.detail !== "string")) {
    throw new RemoteProtocolError("internal", "remote verification result is malformed");
  }
}

export function createRemoteExecutionBackend(options: RemoteExecutionBackendOptions): ExecutionBackend {
  if (typeof options.token !== "string" || options.token.trim() === "") throw new Error("remote token is required");
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("remote baseUrl must use http or https");
  if (base.username || base.password) throw new Error("remote credentials must not be embedded in the URL");
  if (base.toString().includes(options.token)) throw new Error("remote token must not appear in the URL");
  const baseUrl = base.toString().replace(/\/$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const heartbeatMs = numberInRange(options.heartbeatMs ?? 5_000, 1, 60_000, "heartbeatMs");
  const defaultDeadlineMs = numberInRange(options.defaultDeadlineMs ?? 120_000, 1, 86_400_000, "defaultDeadlineMs");
  const maxConcurrency = numberInRange(options.maxConcurrency ?? 1, 1, 16, "maxConcurrency");
  const fenceFor = options.fenceFor ?? ((request: ExecutionRequest) =>
    hash([request.plan.plan_id, request.plan.version, request.task.task_id, request.run_id, request.request_id]));
  const agentIdFor = options.agentIdFor ?? ((request: ExecutionRequest) =>
    "agent:" + request.plan.plan_id + ":" + request.task.task_id);

  const headers = {
    authorization: "Bearer " + options.token,
    "content-type": "application/json",
  };

  const envelopeFor = (request: ExecutionRequest) => {
    const spec = specFor(request);
    const denied = capabilityCovers(options.capability, spec.capability);
    if (denied) throw new RemoteProtocolError("capability_denied", denied, 403);
    if (request.task.lane !== "read" || request.task.contract.effect !== "none") {
      throw new RemoteProtocolError("capability_denied", "remote backend currently accepts read-only/no-effect tasks", 403);
    }
    const deadlineAt = options.deadlineAtFor?.(request) ?? request.task.deadline_ms ?? Date.now() + defaultDeadlineMs;
    if (!Number.isFinite(deadlineAt) || deadlineAt <= 0) throw new Error("remote deadline is invalid");
    const fence = fenceFor(request);
    const contractDigest = remoteContractDigest(request.task, spec);
    const idempotencyKey = remoteIdempotencyKey({
      plan_id: request.plan.plan_id,
      version: request.plan.version,
      task_id: request.task.task_id,
      run_id: request.run_id,
      ...(request.task.contract.idempotency_key ? { contract_idempotency_key: request.task.contract.idempotency_key } : {}),
    });
    const envelope: RemoteExecutionEnvelope = {
      protocol_version: REMOTE_PROTOCOL_VERSION,
      run_id: request.run_id,
      agent_id: agentIdFor(request),
      fence,
      contract_digest: contractDigest,
      idempotency_key: idempotencyKey,
      deadline_at: deadlineAt,
      heartbeat_ms: heartbeatMs,
      capability: options.capability,
      task: request.task,
      agent_spec: spec,
      context: request.context,
    };
    return { envelope, spec, deadlineAt, fence, contractDigest, idempotencyKey };
  };

  const supports = (task: ExecutionRequest["task"], spec: AgentSpec): string | null => {
    if (task.lane !== "read" || task.contract.effect !== "none") return "remote backend currently accepts read-only/no-effect tasks";
    return capabilityCovers(options.capability, spec.capability);
  };

  return {
    id: "remote-json-v1",
    max_concurrency: maxConcurrency,
    supports,
    async execute(request): Promise<ExecutionResult> {
      request.signal.throwIfAborted();
      const { envelope, deadlineAt, fence, contractDigest, idempotencyKey } = envelopeFor(request);
      const controller = new AbortController();
      let deadline = false;
      let heartbeatFailure: RemoteExecutionUncertainError | null = null;
      let completed = false;
      const onAbort = (): void => controller.abort(request.signal.reason);
      request.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        deadline = true;
        controller.abort(new RemoteProtocolError("deadline_exceeded", "remote execution deadline exceeded", 408));
      }, Math.max(1, deadlineAt - Date.now()));
      const heartbeat: RemoteHeartbeat = {
        protocol_version: REMOTE_PROTOCOL_VERSION,
        run_id: request.run_id,
        fence,
        contract_digest: contractDigest,
        idempotency_key: idempotencyKey,
        deadline_at: deadlineAt,
      };
      const heartbeatTimer = setInterval(() => {
        if (completed || controller.signal.aborted) return;
        void fetchImpl(baseUrl + "/v1/heartbeat", {
          method: "POST",
          headers,
          body: JSON.stringify(heartbeat),
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw parseRemoteError(await responseJson(response), response.status);
        }).catch((error: unknown) => {
          if (completed || controller.signal.aborted) return;
          heartbeatFailure = new RemoteExecutionUncertainError(
            "remote heartbeat failed; confirm the remote executor stopped before retrying: " +
            (error instanceof Error ? error.message : String(error)),
          );
          controller.abort(heartbeatFailure);
        });
      }, heartbeatMs);
      heartbeatTimer.unref?.();
      try {
        const response = await fetchImpl(baseUrl + "/v1/execute", {
          method: "POST",
          headers,
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
        const payload = await responseJson(response);
        if (!response.ok) throw parseRemoteError(payload, response.status);
        const remote = payload as Partial<RemoteExecutionResponse>;
        if (remote.protocol_version !== REMOTE_PROTOCOL_VERSION || remote.run_id !== request.run_id) {
          throw new RemoteProtocolError("internal", "remote result identity changed");
        }
        if (remote.fence !== fence) throw new RemoteProtocolError("stale_fence", "remote result fence changed");
        if (remote.contract_digest !== contractDigest) {
          throw new RemoteProtocolError("contract_digest_mismatch", "remote result contract digest changed");
        }
        assertExecutionResult(remote.result);
        if (Date.now() > deadlineAt) {
          throw new RemoteProtocolError("deadline_exceeded", "remote result arrived after the deadline", 408);
        }
        completed = true;
        return remote.result;
      } catch (error) {
        if (error instanceof RemoteProtocolError || error instanceof RemoteExecutionUncertainError) throw error;
        if (deadline) throw new RemoteProtocolError("deadline_exceeded", "remote execution deadline exceeded", 408);
        if (heartbeatFailure) throw heartbeatFailure;
        if (request.signal.aborted) request.signal.throwIfAborted();
        throw new RemoteExecutionUncertainError();
      } finally {
        completed = true;
        clearTimeout(timer);
        clearInterval(heartbeatTimer);
        request.signal.removeEventListener("abort", onAbort);
      }
    },
    async verify(request, result): Promise<VerificationResult> {
      request.signal.throwIfAborted();
      const { spec, deadlineAt, fence, contractDigest } = envelopeFor(request);
      const controller = new AbortController();
      let deadline = false;
      const onAbort = (): void => controller.abort(request.signal.reason);
      request.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        deadline = true;
        controller.abort(new RemoteProtocolError("deadline_exceeded", "remote verification deadline exceeded", 408));
      }, Math.max(1, deadlineAt - Date.now()));
      const body: RemoteVerifyRequest = {
        protocol_version: REMOTE_PROTOCOL_VERSION,
        run_id: request.run_id,
        fence,
        contract_digest: contractDigest,
        deadline_at: deadlineAt,
        task: request.task,
        agent_spec: spec,
        result,
      };
      try {
        const response = await fetchImpl(baseUrl + "/v1/verify", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await responseJson(response);
        if (!response.ok) throw parseRemoteError(payload, response.status);
        const remote = payload as Partial<RemoteVerifyResponse>;
        if (remote.protocol_version !== REMOTE_PROTOCOL_VERSION || remote.run_id !== request.run_id) {
          throw new RemoteProtocolError("internal", "remote verification identity changed");
        }
        if (remote.fence !== fence) {
          throw new RemoteProtocolError("stale_fence", "remote verification fence changed");
        }
        if (remote.contract_digest !== contractDigest) {
          throw new RemoteProtocolError("contract_digest_mismatch", "remote verification contract digest changed");
        }
        if (remote.expected_revision !== result.revision) {
          throw new RemoteProtocolError("internal", "remote verification revision changed");
        }
        assertVerification(remote.verification);
        if (remote.verification.revision !== result.revision) {
          throw new RemoteProtocolError("internal", "remote verifier returned a different revision");
        }
        if (Date.now() > deadlineAt) {
          throw new RemoteProtocolError("deadline_exceeded", "remote verification arrived after the deadline", 408);
        }
        return remote.verification;
      } catch (error) {
        if (error instanceof RemoteProtocolError) throw error;
        if (deadline) throw new RemoteProtocolError("deadline_exceeded", "remote verification deadline exceeded", 408);
        if (request.signal.aborted) request.signal.throwIfAborted();
        throw new RemoteExecutionUncertainError("remote verification connection was lost; verification is unconfirmed");
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
