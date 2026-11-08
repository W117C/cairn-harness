// 运行时注入/实验分配 sidecar（Cairn Evolve · P2/P4）：装配缝写入，收束缝读取，Episode 带上 arm/propensity。
//
// 两条写入路径共用一份契约：
//  · 实验分配：experimentId 非空、arm=control/treatment，分析用；
//  · 基线注入：experimentId=null、arm=none，只为让 Episode 说出「注入了哪几条」——
//    观测账（confidence.observational / lastUsedAt）从这条归因读回。
//
// 为什么用 sidecar 而不是在会话中途追加 session_meta：session_meta 是会话身份记录，
// 中途追加会影响读侧对“首行身份”的假设；P2 先用独立文件，协议面迁移留到写入端统一接。
// 文件名用 sessionId 的哈希，避免会话名里的空格/斜杠变成路径；文件内保留原 sessionId 校验。

import { createHash } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { EpisodeArm, EpisodeAssignment } from "../../agent/evolve/episode";
import { writeFileAtomic } from "../../atomic-write";
import { evolveDirFor } from "./paths";
import { isRecord } from "../../is-record";

export const ASSIGNMENTS_DIR = "assignments";
export const POLICY_VERSION = "evolve-v1";

export interface AssignmentStamp {
  experimentId: string | null;
  arm: EpisodeArm;
  propensity: number | null;
  policyVersion: string;
  injectedExperienceIds: string[];
  injectedChars: number;
}

export function assignmentsDirFor(workspace: string): string {
  return join(evolveDirFor(workspace), ASSIGNMENTS_DIR);
}

export function assignmentPathFor(workspace: string, sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return join(assignmentsDirFor(workspace), key + ".json");
}

export interface AssignmentFile {
  v: 1;
  sessionId: string;
  ts: number;
  assignment: AssignmentStamp;
}

function isStamp(value: unknown): value is AssignmentStamp {
  if (!isRecord(value)) return false;
  if (value.experimentId !== null && typeof value.experimentId !== "string") return false;
  if (value.arm !== "none" && value.arm !== "control" && value.arm !== "treatment" && value.arm !== "shadow") return false;
  if (value.propensity !== null
    && (typeof value.propensity !== "number" || !Number.isFinite(value.propensity) || value.propensity < 0 || value.propensity > 1)) {
    return false;
  }
  if (typeof value.policyVersion !== "string" || value.policyVersion.length === 0) return false;
  if (!Array.isArray(value.injectedExperienceIds) || value.injectedExperienceIds.some((id) => typeof id !== "string")) return false;
  if (typeof value.injectedChars !== "number" || !Number.isInteger(value.injectedChars) || value.injectedChars < 0) return false;
  return true;
}

/** 写分配 sidecar（原子覆盖：同一会话重复装配按最后一次为准，臂由确定性 hash 保证不变）。 */
export async function writeAssignment(
  workspace: string,
  sessionId: string,
  stamp: AssignmentStamp,
  ts: number = Date.now(),
): Promise<string> {
  if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId 不能为空");
  if (!isStamp(stamp)) throw new Error("assignment stamp 形状不合法");
  const dir = assignmentsDirFor(workspace);
  await mkdir(dir, { recursive: true });
  const path = assignmentPathFor(workspace, sessionId);
  const file: AssignmentFile = { v: 1, sessionId, ts, assignment: stamp };
  await writeFileAtomic(path, JSON.stringify(file, null, 2) + "\n");
  return path;
}

/** 读分配 sidecar；缺失/坏档 = null（收束缝按“不在实验中”记，不编 arm）。 */
export async function readAssignment(workspace: string, sessionId: string): Promise<EpisodeAssignment | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(assignmentPathFor(workspace, sessionId), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || raw.sessionId !== sessionId || !isStamp(raw.assignment)) return null;
  return { ...raw.assignment, source: "sidecar" };
}

/** 每次装配先清旧档：同一会话重跑而实验已结束/候选失效时，旧臂不得带进新 Episode。 */
export async function clearAssignment(workspace: string, sessionId: string): Promise<void> {
  await unlink(assignmentPathFor(workspace, sessionId)).catch(() => undefined);
}
