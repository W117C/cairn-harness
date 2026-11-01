import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";
import { isSessionPreferenceString } from "./session-metadata";

export interface SessionPreferences { model?: string; thinking?: string }
export interface SessionPreferencesPatch { model?: string | null; thinking?: string | null }

export const sessionPreferencesPath = (logPath: string): string => `${logPath}.prefs.json`;

/** null = 没有独立偏好（可按归属决定是否沿用旧记录）；{} = 明确跟随默认，不回落旧记录。 */
export async function readSessionPreferences(logPath: string): Promise<SessionPreferences | null> {
  const path = sessionPreferencesPath(logPath);
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("根对象非法");
    const record = raw as Record<string, unknown>;
    if (record.version !== 1 || Object.keys(record).some((key) => !["version", "model", "thinking"].includes(key))) {
      throw new Error("version/字段非法");
    }
    if (record.model !== undefined && !isSessionPreferenceString(record.model, 200)) throw new Error("model 非法");
    if (record.thinking !== undefined && !isSessionPreferenceString(record.thinking, 40)) throw new Error("thinking 非法");
    return { ...(record.model !== undefined ? { model: record.model as string } : {}),
      ...(record.thinking !== undefined ? { thinking: record.thinking as string } : {}) };
  } catch (error) {
    throw new Error(`会话偏好损坏，已拒绝覆盖: ${path}（${error instanceof Error ? error.message : String(error)}）`);
  }
}

/** 调用方持有会话根的 mutation 锁；旧记录只在首写且归属明确时作为初值，不改旧文件。 */
export async function writeSessionPreferences(
  logPath: string, patch: SessionPreferencesPatch, legacy: SessionPreferences = {},
): Promise<void> {
  const current = await readSessionPreferences(logPath);
  const next: SessionPreferences = current ?? {
    ...(legacy.model !== undefined ? { model: legacy.model } : {}),
    ...(legacy.thinking !== undefined ? { thinking: legacy.thinking } : {}),
  };
  for (const key of ["model", "thinking"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else {
      if (!isSessionPreferenceString(value, key === "model" ? 200 : 40)) throw new Error(`会话 ${key} 非法`);
      next[key] = value;
    }
  }
  await writeFileAtomic(sessionPreferencesPath(logPath), JSON.stringify({ version: 1, ...next }) + "\n");
}
