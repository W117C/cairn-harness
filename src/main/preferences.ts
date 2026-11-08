/**
 * 偏好备份（2026-10-30 · 第 809 页）。
 *
 * 只搬运「界面与行为偏好」：主题 / 字号 / 权限档 / 预算 / 开关。**不搬** provider、model、workspace、
 * currentSession、onboarded、layout——那些是身份、项目路径或窗口状态，跨机导入会把人带到别人的
 * 工作区，或让新机器误以为已经完成首启。
 *
 * 导入是严格校验：每个已知键类型/枚举/范围不对就整份拒绝（不做「坏的跳过、好的生效」的半套），
 * 未知键忽略并回报——这样新版本导出的备份在旧版本上不会整份失败。
 */
import { readFile, stat } from "node:fs/promises";
import {
  DEFAULT_SETTINGS,
  LOCALES,
  PERMISSION_MODES,
  SAFE_MODES,
  TEXT_SIZES,
  THEMES,
  UI_SIZES,
  type AppSettings,
} from "./settings";
import { isRecord } from "../is-record";

export const PREFERENCES_FORMAT = "cairn-preferences-v1";
export const PREFERENCES_MAX_BYTES = 64 * 1024;

export type PreferenceKey =
  | "theme" | "locale" | "textSize" | "uiSize" | "mode" | "safeMode"
  | "autoMemory" | "subagentTools" | "notifyOnComplete" | "telemetry"
  | "maxBudgetUsd" | "budgetPricePerMTok" | "scheduleConcurrencyCap"
  | "routingBandit" | "routingCascade" | "actionFusion" | "promptCache"
  | "requestMetering" | "observationPack" | "evidenceReceipts" | "economicCompaction"
  | "impactAnalysis" | "autoVerify" | "autoVerifyRepair" | "planRequiredByDefault"
  | "keepAwake" | "windowVibrancy" | "ctrlTabCycle" | "updateManifestUrl";

export type PreferencePatch = Partial<Pick<AppSettings, PreferenceKey>>;

const BOOLEAN_KEYS = [
  "autoMemory", "subagentTools", "notifyOnComplete", "telemetry",
  "routingBandit", "routingCascade", "actionFusion", "promptCache",
  "requestMetering", "observationPack", "evidenceReceipts", "economicCompaction",
  "impactAnalysis", "autoVerify", "autoVerifyRepair", "planRequiredByDefault",
  "keepAwake", "windowVibrancy", "ctrlTabCycle",
] as const;

const ENUM_KEYS = {
  theme: THEMES,
  locale: LOCALES,
  textSize: TEXT_SIZES,
  uiSize: UI_SIZES,
  mode: PERMISSION_MODES,
  safeMode: SAFE_MODES,
} as const;

const NUMBER_KEYS = ["maxBudgetUsd", "budgetPricePerMTok", "scheduleConcurrencyCap"] as const;

export const PREFERENCE_KEYS: readonly PreferenceKey[] = [
  ...Object.keys(ENUM_KEYS) as PreferenceKey[],
  ...BOOLEAN_KEYS,
  ...NUMBER_KEYS,
  "updateManifestUrl",
];

/** 从完整设置里挑出可搬运的那部分（导出与校验共用同一张键表）。 */
export function pickPreferences(settings: AppSettings): PreferencePatch {
  const out: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) out[key] = settings[key];
  return out as PreferencePatch;
}

export interface PreferencesExport {
  format: typeof PREFERENCES_FORMAT;
  appVersion: string;
  exportedAt: string;
  preferences: PreferencePatch;
}

/** 恢复默认偏好时要用的 patch（与导出的键表同一份，身份/项目/会话/布局仍不碰）。 */
export function defaultPreferences(): PreferencePatch {
  return pickPreferences(DEFAULT_SETTINGS);
}

export function buildPreferencesExport(settings: AppSettings, appVersion: string, exportedAt: string): PreferencesExport {
  return { format: PREFERENCES_FORMAT, appVersion, exportedAt, preferences: pickPreferences(settings) };
}

export type PreferencesImport = { ok: true; patch: PreferencePatch; ignored: string[] } | { ok: false; error: string };

/** 严格解析一份偏好备份：坏值整份拒绝；未知键忽略并回报。 */
export function parsePreferencesImport(raw: unknown): PreferencesImport {
  if (!isRecord(raw)) return { ok: false, error: "不是 JSON 对象" };
  if (raw.format !== PREFERENCES_FORMAT) return { ok: false, error: "不是 Cairn 偏好备份（format 不匹配）" };
  const preferences = raw.preferences;
  if (!isRecord(preferences)) return { ok: false, error: "备份里没有 preferences 对象" };
  const patch: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(preferences)) {
    if (!(PREFERENCE_KEYS as readonly string[]).includes(key)) { ignored.push(key); continue; }
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== "boolean") return { ok: false, error: `${key} 必须是布尔值` };
      patch[key] = value;
      continue;
    }
    if (key in ENUM_KEYS) {
      const allowed = ENUM_KEYS[key as keyof typeof ENUM_KEYS] as readonly unknown[];
      if (!allowed.includes(value)) return { ok: false, error: `${key} 不在允许取值内` };
      patch[key] = value;
      continue;
    }
    if (key === "updateManifestUrl") {
      if (typeof value !== "string" || value.length > 2048) return { ok: false, error: "updateManifestUrl 必须是不超过 2048 字的字符串" };
      if (value !== "") {
        let parsed: URL;
        try { parsed = new URL(value); } catch { return { ok: false, error: "updateManifestUrl 不是合法 URL" }; }
        if (parsed.protocol !== "https:") return { ok: false, error: "updateManifestUrl 必须是 https" };
      }
      patch[key] = value;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, error: `${key} 必须是非负数字` };
    }
    if (key === "scheduleConcurrencyCap" && (!Number.isInteger(value) || value < 1 || value > 8)) {
      return { ok: false, error: "scheduleConcurrencyCap 必须是 1–8 的整数" };
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "备份里没有可导入的偏好" };
  return { ok: true, patch: patch as PreferencePatch, ignored };
}

/** 读一份偏好文件（大小上限 64 KiB），解析并严格校验。 */
export async function readPreferencesFile(file: string): Promise<PreferencesImport> {
  let text: string;
  try {
    const info = await stat(file);
    if (!info.isFile()) return { ok: false, error: "选择的不是文件" };
    if (info.size > PREFERENCES_MAX_BYTES) return { ok: false, error: `偏好备份过大（上限 ${String(PREFERENCES_MAX_BYTES)} 字节）` };
    text = await readFile(file, "utf8");
  } catch (err) {
    return { ok: false, error: `读取偏好备份失败：${err instanceof Error ? err.message : String(err)}` };
  }
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; } catch { return { ok: false, error: "不是合法 JSON" }; }
  return parsePreferencesImport(raw);
}
