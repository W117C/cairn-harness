// 候选档案（sidecar）：候选的**证据面**，不是权威。账本仍是 registry.jsonl；
// 这里只回答「这个版本从哪来、改了什么字节、在哪批任务上花了多少、为什么被杀」。
//
// 完整性以 contentDigest 为准（排序后逐文件 sha256）。`signedBy` 只是产出管线身份戳
// （evolution-plane.ts 的 EVOLUTION_PIPELINE_V1），不能当完整性证明。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
import { isBundleId, isBundleVersion } from "./manifest";

export const CANDIDATE_RECORD_SCHEMA = 1 as const;

export type CandidateEvalStatus = "pending" | "passed" | "failed" | "unmeasurable" | "rolled-back";
export type CandidateDecision = "pending" | "promote" | "keep-old";

export interface CandidateRun {
  runId: string;
  taskId: string;
  split: "search" | "validation";
  /** null = 没有可判证据（不许折成 false）。 */
  ok: boolean | null;
  costUsd: number | null;
  tokens: number | null;
  durationMs: number | null;
  artifactDigest: string | null;
  failureReason: string | null;
}

export interface CandidateRecord {
  schema: typeof CANDIDATE_RECORD_SCHEMA;
  id: string;
  version: string;
  parentVersion: string | null;
  contentDigest: string;
  generator: {
    kind: "model" | "human" | "handwritten-demo" | "scripted";
    model: string | null;
    tools: string[];
    params?: Record<string, unknown>;
  };
  taskSet: { id: string; version: string; digest: string };
  env: { commit: string | null; node: string; configDigest: string | null };
  runs: CandidateRun[];
  evaluation: { status: CandidateEvalStatus; decision: CandidateDecision; reason: string | null };
  approvals: { approvedBy: string; at: string } | null;
  rollbackTo: string | null;
  createdAt: string;
}

export class CandidateRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateRecordError";
  }
}

const RECORD_FIELDS = new Set([
  "schema", "id", "version", "parentVersion", "contentDigest", "generator",
  "taskSet", "env", "runs", "evaluation", "approvals", "rollbackTo", "createdAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableFinite(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new CandidateRecordError(`${field} 须为非负有限数或 null`);
  }
  return value;
}

function isoString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new CandidateRecordError(`${field} 须为 ISO 时间字符串`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CandidateRecordError(`${field} 不是规范 ISO 时间：${JSON.stringify(value)}`);
  }
  return value;
}

/** 排序后逐文件 sha256（路径与内容都进摘要；同一组文件与顺序无关）。 */
export function digestFiles(files: Readonly<Record<string, string>>): string {
  const h = createHash("sha256");
  for (const rel of Object.keys(files).sort()) {
    h.update(rel);
    h.update("\0");
    h.update(files[rel]!);
    h.update("\0");
  }
  return "sha256:" + h.digest("hex");
}

export function digestText(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

export function candidateRecordPathFor(workspace: string, id: string, version: string): string {
  if (!isBundleId(id)) throw new CandidateRecordError(`id 非法：${JSON.stringify(id)}`);
  if (!isBundleVersion(version)) throw new CandidateRecordError(`version 非法：${JSON.stringify(version)}`);
  return join(workspace, "modules", "candidates", id, version + ".json");
}

function parseRun(value: unknown, at: string): CandidateRun {
  if (!isRecord(value)) throw new CandidateRecordError(`${at} 不是对象`);
  const split = value.split;
  if (split !== "search" && split !== "validation") throw new CandidateRecordError(`${at}.split 非法`);
  if (!nonEmpty(value.runId) || !nonEmpty(value.taskId)) throw new CandidateRecordError(`${at} 缺 runId/taskId`);
  if (value.ok !== null && typeof value.ok !== "boolean") throw new CandidateRecordError(`${at}.ok 须为布尔或 null`);
  const artifactDigest = value.artifactDigest;
  if (artifactDigest !== null && (typeof artifactDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(artifactDigest))) {
    throw new CandidateRecordError(`${at}.artifactDigest 须为 sha256 摘要或 null`);
  }
  if (!nullableString(value.failureReason)) throw new CandidateRecordError(`${at}.failureReason 须为字符串或 null`);
  return {
    runId: value.runId,
    taskId: value.taskId,
    split,
    ok: value.ok,
    costUsd: nullableFinite(value.costUsd, at + ".costUsd"),
    tokens: nullableFinite(value.tokens, at + ".tokens"),
    durationMs: nullableFinite(value.durationMs, at + ".durationMs"),
    artifactDigest,
    failureReason: value.failureReason,
  };
}

/** fail-closed 解析：未知字段、缺字段、坏类型一律抛；档案读坏不许折成「没有候选」。 */
export function parseCandidateRecord(value: unknown): CandidateRecord {
  if (!isRecord(value)) throw new CandidateRecordError("候选档案不是 JSON 对象");
  for (const key of Object.keys(value)) {
    if (!RECORD_FIELDS.has(key)) throw new CandidateRecordError(`候选档案有未知字段：${key}`);
  }
  if (value.schema !== CANDIDATE_RECORD_SCHEMA) throw new CandidateRecordError(`候选档案 schema 取值不在合同内：${JSON.stringify(value.schema)}`);
  if (!nonEmpty(value.id) || !isBundleId(value.id)) throw new CandidateRecordError("候选档案 id 非法");
  if (!nonEmpty(value.version) || !isBundleVersion(value.version)) throw new CandidateRecordError("候选档案 version 非法");
  if (value.parentVersion !== null && (typeof value.parentVersion !== "string" || !isBundleVersion(value.parentVersion))) {
    throw new CandidateRecordError("候选档案 parentVersion 须为合法版本或 null");
  }
  if (typeof value.contentDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.contentDigest)) {
    throw new CandidateRecordError("候选档案 contentDigest 须为 sha256 摘要");
  }
  if (!isRecord(value.generator)) throw new CandidateRecordError("候选档案 generator 不是对象");
  const kind = value.generator.kind;
  if (kind !== "model" && kind !== "human" && kind !== "handwritten-demo" && kind !== "scripted") {
    throw new CandidateRecordError("候选档案 generator.kind 非法");
  }
  if (!nullableString(value.generator.model)) throw new CandidateRecordError("候选档案 generator.model 须为字符串或 null");
  if (!Array.isArray(value.generator.tools) || !value.generator.tools.every((t) => typeof t === "string")) {
    throw new CandidateRecordError("候选档案 generator.tools 须为字符串数组");
  }
  if (value.generator.params !== undefined && !isRecord(value.generator.params)) {
    throw new CandidateRecordError("候选档案 generator.params 须为对象");
  }
  if (!isRecord(value.taskSet) || !nonEmpty(value.taskSet.id) || !nonEmpty(value.taskSet.version) || !nonEmpty(value.taskSet.digest)) {
    throw new CandidateRecordError("候选档案 taskSet 须含 id/version/digest");
  }
  if (!isRecord(value.env) || !nullableString(value.env.commit) || !nonEmpty(value.env.node) || !nullableString(value.env.configDigest)) {
    throw new CandidateRecordError("候选档案 env 须含 commit/node/configDigest");
  }
  if (!Array.isArray(value.runs)) throw new CandidateRecordError("候选档案 runs 须为数组");
  const runs = value.runs.map((r, i) => parseRun(r, `runs[${String(i)}]`));
  if (!isRecord(value.evaluation)) throw new CandidateRecordError("候选档案 evaluation 不是对象");
  const status = value.evaluation.status;
  if (status !== "pending" && status !== "passed" && status !== "failed" && status !== "unmeasurable" && status !== "rolled-back") {
    throw new CandidateRecordError("候选档案 evaluation.status 非法");
  }
  const decision = value.evaluation.decision;
  if (decision !== "pending" && decision !== "promote" && decision !== "keep-old") {
    throw new CandidateRecordError("候选档案 evaluation.decision 非法");
  }
  if (!nullableString(value.evaluation.reason)) throw new CandidateRecordError("候选档案 evaluation.reason 须为字符串或 null");
  if (value.approvals !== null) {
    if (!isRecord(value.approvals) || !nonEmpty(value.approvals.approvedBy)) throw new CandidateRecordError("候选档案 approvals 须含 approvedBy");
    isoString(value.approvals.at, "approvals.at");
  }
  if (value.rollbackTo !== null && (typeof value.rollbackTo !== "string" || !isBundleVersion(value.rollbackTo))) {
    throw new CandidateRecordError("候选档案 rollbackTo 须为合法版本或 null");
  }
  isoString(value.createdAt, "createdAt");
  return {
    schema: CANDIDATE_RECORD_SCHEMA,
    id: value.id,
    version: value.version,
    parentVersion: value.parentVersion as string | null,
    contentDigest: value.contentDigest,
    generator: {
      kind,
      model: value.generator.model as string | null,
      tools: [...(value.generator.tools as string[])],
      ...(value.generator.params !== undefined ? { params: value.generator.params as Record<string, unknown> } : {}),
    },
    taskSet: {
      id: value.taskSet.id,
      version: value.taskSet.version,
      digest: value.taskSet.digest,
    },
    env: {
      commit: value.env.commit as string | null,
      node: value.env.node,
      configDigest: value.env.configDigest as string | null,
    },
    runs,
    evaluation: {
      status,
      decision,
      reason: value.evaluation.reason as string | null,
    },
    approvals: value.approvals === null
      ? null
      : { approvedBy: value.approvals.approvedBy as string, at: value.approvals.at as string },
    rollbackTo: value.rollbackTo as string | null,
    createdAt: value.createdAt as string,
  };
}

export async function readCandidateRecord(
  workspace: string,
  id: string,
  version: string,
): Promise<CandidateRecord | null> {
  const path = candidateRecordPathFor(workspace, id, version);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseCandidateRecord(JSON.parse(raw) as unknown);
}

/** 原子写 sidecar（父目录自动建）。 */
export async function writeCandidateRecord(workspace: string, record: CandidateRecord): Promise<string> {
  const parsed = parseCandidateRecord(record);
  const path = candidateRecordPathFor(workspace, parsed.id, parsed.version);
  await writeFileAtomic(path, JSON.stringify(parsed, null, 2) + "\n");
  return path;
}
