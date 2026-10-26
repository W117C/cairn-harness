import { createHash } from "node:crypto";
import type {
  AgentSpec,
  ArtifactRef,
  Capability,
  ContextPacket,
  ExecutionResult,
  FlowTask,
  VerificationResult,
} from "./types";

export const REMOTE_PROTOCOL_VERSION = 1 as const;

export type RemoteErrorCode =
  | "unauthorized"
  | "capability_denied"
  | "contract_digest_mismatch"
  | "stale_fence"
  | "deadline_exceeded"
  | "invalid_request"
  | "not_found"
  | "internal";

export class RemoteProtocolError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RemoteProtocolError";
  }
}

export class RemoteExecutionUncertainError extends Error {
  readonly code = "disconnected";
  readonly needsYou = true;

  constructor(message = "remote execution connection was lost; confirm the executor stopped before retrying") {
    super(message);
    this.name = "RemoteExecutionUncertainError";
  }
}

export interface RemoteExecutionEnvelope {
  protocol_version: typeof REMOTE_PROTOCOL_VERSION;
  run_id: string;
  agent_id: string;
  fence: string;
  contract_digest: string;
  idempotency_key: string;
  deadline_at: number;
  heartbeat_ms: number;
  capability: Capability;
  task: FlowTask;
  agent_spec: AgentSpec;
  context: ContextPacket;
}

export interface RemoteExecutionResponse {
  protocol_version: typeof REMOTE_PROTOCOL_VERSION;
  run_id: string;
  fence: string;
  contract_digest: string;
  duplicate: boolean;
  result: ExecutionResult;
}

export interface RemoteHeartbeat {
  protocol_version: typeof REMOTE_PROTOCOL_VERSION;
  run_id: string;
  fence: string;
  contract_digest: string;
  idempotency_key: string;
  deadline_at: number;
}

export interface RemoteVerifyRequest {
  protocol_version: typeof REMOTE_PROTOCOL_VERSION;
  run_id: string;
  fence: string;
  contract_digest: string;
  deadline_at: number;
  task: FlowTask;
  agent_spec: AgentSpec;
  result: ExecutionResult;
}

export interface RemoteVerifyResponse {
  protocol_version: typeof REMOTE_PROTOCOL_VERSION;
  run_id: string;
  fence: string;
  contract_digest: string;
  expected_revision: string;
  verification: VerificationResult;
}

export interface RemoteErrorResponse {
  error: {
    code: RemoteErrorCode;
    message: string;
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function remoteContractDigest(task: FlowTask, spec: AgentSpec): string {
  return hash([task, spec]);
}

export function remoteIdempotencyKey(input: {
  plan_id: string;
  version: number;
  task_id: string;
  run_id: string;
  contract_idempotency_key?: string;
}): string {
  return input.contract_idempotency_key ??
    hash([input.plan_id, input.version, input.task_id, input.run_id]);
}

function scopeCovers(grant: string, requested: string): boolean {
  if (grant === "." || grant === "**" || grant === requested) return true;
  const root = grant.endsWith("/**") ? grant.slice(0, -3) : grant;
  return !/[?*[\]{}]/.test(root) && requested.startsWith(root + "/");
}

function allScopesCovered(grant: readonly string[], requested: readonly string[]): boolean {
  return requested.every((scope) => grant.some((allowed) => scopeCovers(allowed, scope)));
}

const SHELL_RANK: Record<Capability["shell"], number> = { none: 0, read: 1, sandboxed: 2 };
const GIT_RANK: Record<Capability["git"], number> = { none: 0, read: 1, commit: 2, merge: 3 };
const EFFECT_RANK: Record<Capability["external_effects"], number> = { none: 0, allowlist: 1 };

/** The remote side can only narrow the approved agent capability, never widen it. */
export function capabilityCovers(grant: Capability, requested: Capability): string | null {
  if (requested.tools.some((tool) => !grant.tools.includes(tool))) return "tool capability exceeds remote grant";
  if (!allScopesCovered(grant.fs_read, requested.fs_read)) return "read scope exceeds remote grant";
  if (!allScopesCovered(grant.fs_write, requested.fs_write)) return "write scope exceeds remote grant";
  if (requested.network.some((host) => !grant.network.includes(host))) return "network capability exceeds remote grant";
  if (SHELL_RANK[requested.shell] > SHELL_RANK[grant.shell]) return "shell capability exceeds remote grant";
  if (GIT_RANK[requested.git] > GIT_RANK[grant.git]) return "git capability exceeds remote grant";
  if (EFFECT_RANK[requested.external_effects] > EFFECT_RANK[grant.external_effects]) return "external effect capability exceeds remote grant";
  return null;
}

export function parseRemoteError(value: unknown, status: number): RemoteProtocolError {
  const payload = value !== null && typeof value === "object" ? value as Partial<RemoteErrorResponse> : {};
  const code = payload.error?.code;
  const allowed: RemoteErrorCode[] = [
    "unauthorized",
    "capability_denied",
    "contract_digest_mismatch",
    "stale_fence",
    "deadline_exceeded",
    "invalid_request",
    "not_found",
    "internal",
  ];
  if (typeof code === "string" && allowed.includes(code as RemoteErrorCode)) {
    return new RemoteProtocolError(
      code as RemoteErrorCode,
      typeof payload.error?.message === "string" ? payload.error.message : code,
      status,
    );
  }
  return new RemoteProtocolError("internal", "remote worker returned an invalid error response", status);
}

export function assertArtifactRefs(value: unknown): asserts value is ArtifactRef[] {
  if (!Array.isArray(value)) throw new RemoteProtocolError("internal", "remote artifacts are not an array");
  for (const artifact of value) {
    if (!artifact || typeof artifact !== "object" || typeof (artifact as { id?: unknown }).id !== "string" ||
        !["file", "blob", "json", "url"].includes((artifact as { kind?: string }).kind ?? "")) {
      throw new RemoteProtocolError("internal", "remote artifact is malformed");
    }
  }
}
