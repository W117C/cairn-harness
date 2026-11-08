import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { writeFileAtomic } from "../atomic-write";
import { isRecord } from "../is-record";
import { isValidUlid, validateAutomation, type AutomationTier } from "./automations";
import { isValidSessionName } from "./sessions";

export interface IdleTaskInput {
  name: string;
  prompt: string;
  permissionTier: AutomationTier;
}

export type IdleTaskAction = "pause" | "resume" | "cancel";
const statuses = ["queued", "paused", "running", "succeeded", "failed", "cancelled"] as const;
export type IdleTaskStatus = (typeof statuses)[number];

export interface IdleTask extends IdleTaskInput {
  id: string;
  status: IdleTaskStatus;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  error?: string;
}

export interface IdleTaskSnapshot {
  workspace: string;
  tasks: IdleTask[];
}

export interface StoredIdleTask extends IdleTask {
  workspace?: string;
  runPid?: number;
}

export type IdleTaskResult = { ok: boolean; error?: string };

export function createIdleTask(input: unknown, now: Date): { task: IdleTask } | { error: string } {
  if (!isRecord(input) || Object.keys(input).some((k) => !["name", "prompt", "permissionTier"].includes(k))) {
    return { error: "闲时任务只接受名称、提示词和权限档" };
  }
  const v = validateAutomation({ ...input, schedule: { kind: "once", at: now.toISOString() } }, { now });
  if (!v.ok) return { error: v.errors.join("；") };
  const { id, name, prompt, permissionTier, timeZone, createdAt, updatedAt } = v.value;
  return { task: { id, name, prompt, permissionTier, timeZone, createdAt, updatedAt, status: "queued" } };
}

function isStoredIdleTask(task: unknown): task is StoredIdleTask {
  if (!isRecord(task) || !isValidUlid(task.id)
    || !statuses.includes(task.status as IdleTaskStatus)
    || (task.sessionId !== undefined && (typeof task.sessionId !== "string" || !isValidSessionName(task.sessionId)))
    || (task.error !== undefined && typeof task.error !== "string")
    || (task.workspace !== undefined && (typeof task.workspace !== "string" || !isAbsolute(task.workspace)))
    || (task.runPid !== undefined && (typeof task.runPid !== "number" || !Number.isSafeInteger(task.runPid) || task.runPid < 1))
    || (task.status === "running" && task.runPid === undefined)
    || typeof task.createdAt !== "string" || typeof task.updatedAt !== "string" || typeof task.timeZone !== "string"
    || typeof task.permissionTier !== "string") return false;
  return validateAutomation({
    id: task.id, name: task.name, prompt: task.prompt, permissionTier: task.permissionTier,
    timeZone: task.timeZone, createdAt: task.createdAt, updatedAt: task.updatedAt,
    schedule: { kind: "once", at: task.createdAt },
  }).ok;
}

export async function readIdleTasks(path: string): Promise<StoredIdleTask[]> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.tasks) || !raw.tasks.every(isStoredIdleTask)
      || new Set(raw.tasks.map((task) => task.id)).size !== raw.tasks.length) {
      throw new Error("文件结构无效");
    }
    return raw.tasks;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("闲时任务无法读取：" + (err instanceof Error ? err.message : String(err)));
  }
}

export function saveIdleTasks(path: string, tasks: StoredIdleTask[]): Promise<void> {
  return writeFileAtomic(path, JSON.stringify({ version: 1, tasks }));
}
