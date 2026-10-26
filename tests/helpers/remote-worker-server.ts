import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Capability, ExecutionResult } from "../../src/orchestration/types";
import {
  REMOTE_PROTOCOL_VERSION,
  capabilityCovers,
  remoteContractDigest,
  type RemoteExecutionEnvelope,
  type RemoteExecutionResponse,
  type RemoteHeartbeat,
  type RemoteVerifyRequest,
  type RemoteVerifyResponse,
} from "../../src/orchestration/remote-protocol";

export interface RemoteWorkerServerOptions {
  token: string;
  grant: Capability;
  delayExecuteMs?: number;
  delayVerifyMs?: number;
  heartbeatDisconnect?: boolean;
  executeDisconnect?: boolean;
  contractDigest?: string;
  responseFence?: string;
  responseContractDigest?: string;
  verifyRevision?: string;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(bytes.length),
  });
  res.end(bytes);
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } });
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1_048_576) throw new Error("request exceeds 1 MiB");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export class RemoteWorkerServer {
  readonly server: Server;
  token: string;
  grant: Capability;
  delayExecuteMs: number;
  delayVerifyMs: number;
  heartbeatDisconnect: boolean;
  executeDisconnect: boolean;
  contractDigestOverride?: string;
  responseFenceOverride?: string;
  responseContractDigestOverride?: string;
  verifyRevisionOverride?: string;
  readonly fences = new Map<string, string>();
  readonly executions = new Map<string, { fence: string; contract_digest: string; deadline_at: number }>();
  readonly results = new Map<string, RemoteExecutionResponse>();
  readonly sockets = new Set<Socket>();
  executeRequests = 0;
  executeCalls = 0;
  heartbeats = 0;
  verifyCalls = 0;
  url = "";

  constructor(options: RemoteWorkerServerOptions) {
    this.token = options.token;
    this.grant = structuredClone(options.grant);
    this.delayExecuteMs = options.delayExecuteMs ?? 0;
    this.delayVerifyMs = options.delayVerifyMs ?? 0;
    this.heartbeatDisconnect = options.heartbeatDisconnect ?? false;
    this.executeDisconnect = options.executeDisconnect ?? false;
    this.contractDigestOverride = options.contractDigest;
    this.responseFenceOverride = options.responseFence;
    this.responseContractDigestOverride = options.responseContractDigest;
    this.verifyRevisionOverride = options.verifyRevision;
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((cause: unknown) => {
        if (!res.headersSent) error(res, 500, "internal", cause instanceof Error ? cause.message : String(cause));
        else res.destroy();
      });
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("remote fake server has no TCP address"));
          return;
        }
        this.url = "http://127.0.0.1:" + String(address.port);
        resolve();
      });
    });
  }

  setFence(runId: string, fence: string): void {
    this.fences.set(runId, fence);
  }

  setGrant(grant: Capability): void {
    this.grant = structuredClone(grant);
  }

  setContractDigest(digest?: string): void {
    this.contractDigestOverride = digest;
  }

  private authorized(req: IncomingMessage): boolean {
    return req.headers.authorization === "Bearer " + this.token;
  }

  private identity(
    res: ServerResponse,
    value: Record<string, unknown>,
    task?: RemoteVerifyRequest["task"] | RemoteExecutionEnvelope["task"],
    spec?: RemoteVerifyRequest["agent_spec"] | RemoteExecutionEnvelope["agent_spec"],
  ): boolean {
    const runId = value.run_id;
    const fence = value.fence;
    const digest = value.contract_digest;
    const deadline = value.deadline_at;
    if (typeof runId !== "string" || typeof fence !== "string" || typeof digest !== "string" ||
        typeof deadline !== "number" || !Number.isFinite(deadline)) {
      error(res, 400, "invalid_request", "missing execution identity");
      return false;
    }
    const known = this.executions.get(runId);
    const expectedFence = this.fences.get(runId);
    if (expectedFence !== undefined && expectedFence !== fence) {
      error(res, 409, "stale_fence", "execution fence is stale");
      return false;
    }
    if (known !== undefined && (known.fence !== fence || known.contract_digest !== digest)) {
      error(res, 409, "stale_fence", "heartbeat identity does not match the accepted execution");
      return false;
    }
    const expectedDigest = this.contractDigestOverride ??
      (task && spec ? remoteContractDigest(task, spec) : known?.contract_digest);
    if (expectedDigest === undefined) {
      error(res, 404, "not_found", "execution has not been accepted");
      return false;
    }
    if (digest !== expectedDigest) {
      error(res, 409, "contract_digest_mismatch", "execution contract digest changed");
      return false;
    }
    if (Date.now() > deadline) {
      error(res, 408, "deadline_exceeded", "remote deadline has passed");
      return false;
    }
    return true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      error(res, 401, "unauthorized", "missing or invalid capability token");
      return;
    }
    const value = object(await bodyOf(req));
    if (value === null || value.protocol_version !== REMOTE_PROTOCOL_VERSION) {
      error(res, 400, "invalid_request", "unsupported protocol");
      return;
    }
    if (req.url === "/v1/heartbeat" && req.method === "POST") {
      const heartbeat = value as unknown as RemoteHeartbeat;
      if (!this.identity(res, value)) return;
      this.heartbeats++;
      if (this.heartbeatDisconnect) {
        res.destroy();
        return;
      }
      json(res, 200, { ok: true, run_id: heartbeat.run_id });
      return;
    }
    if (req.url === "/v1/execute" && req.method === "POST") {
      const execution = value as unknown as RemoteExecutionEnvelope;
      this.executeRequests++;
      if (!execution.task || !execution.agent_spec || !this.identity(res, value, execution.task, execution.agent_spec)) return;
      this.executions.set(execution.run_id, {
        fence: execution.fence,
        contract_digest: execution.contract_digest,
        deadline_at: execution.deadline_at,
      });
      const denied = capabilityCovers(this.grant, execution.agent_spec.capability);
      if (denied) {
        error(res, 403, "capability_denied", denied);
        return;
      }
      const prior = this.results.get(execution.idempotency_key);
      if (prior) {
        json(res, 200, prior);
        return;
      }
      this.executeCalls++;
      if (this.executeDisconnect) {
        res.destroy();
        return;
      }
      if (this.delayExecuteMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayExecuteMs));
      }
      if (Date.now() > execution.deadline_at) {
        error(res, 408, "deadline_exceeded", "remote deadline has passed");
        return;
      }
      const result: ExecutionResult = {
        agent_id: "remote-producer-" + execution.run_id,
        summary: "remote complete",
        revision: "remote-revision-" + hash(execution.idempotency_key).slice(0, 16),
        artifacts: [],
        evidence: { answer: "remote-evidence" },
        spent_usd: 0,
      };
      const response: RemoteExecutionResponse = {
        protocol_version: REMOTE_PROTOCOL_VERSION,
        run_id: execution.run_id,
        fence: execution.fence,
        contract_digest: execution.contract_digest,
        duplicate: false,
        result,
      };
      this.results.set(execution.idempotency_key, response);
      json(res, 200, {
        ...response,
        ...(this.responseFenceOverride !== undefined ? { fence: this.responseFenceOverride } : {}),
        ...(this.responseContractDigestOverride !== undefined
          ? { contract_digest: this.responseContractDigestOverride }
          : {}),
      });
      return;
    }
    if (req.url === "/v1/verify" && req.method === "POST") {
      const verify = value as unknown as RemoteVerifyRequest;
      if (!verify.task || !verify.agent_spec || !verify.result || !this.identity(res, value, verify.task, verify.agent_spec)) return;
      this.verifyCalls++;
      if (this.delayVerifyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayVerifyMs));
      }
      const revision = this.verifyRevisionOverride ?? verify.result.revision;
      const response: RemoteVerifyResponse = {
        protocol_version: REMOTE_PROTOCOL_VERSION,
        run_id: verify.run_id,
        fence: verify.fence,
        contract_digest: verify.contract_digest,
        expected_revision: verify.result.revision,
        verification: {
          verdict: "pass",
          verifier_id: "remote-verifier",
          revision,
          checks: verify.task.contract.acceptance.map((check) => ({
            id: check.id,
            verdict: "pass",
            detail: "remote verifier checked acceptance",
          })),
          spent_usd: 0,
        },
      };
      json(res, 200, response);
      return;
    }
    error(res, 404, "not_found", "unknown remote endpoint");
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((cause) => {
        if (cause) reject(cause);
        else resolve();
      });
    });
  }
}

export async function startRemoteWorkerServer(options: RemoteWorkerServerOptions): Promise<RemoteWorkerServer> {
  const server = new RemoteWorkerServer(options);
  await server.start();
  return server;
}
