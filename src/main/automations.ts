// 定时任务模型（§12.2.1 实现定稿）：AutomationDefinition 七 kind 数据模型 + 四 kind 表单白名单。
// 校验 = zod 式严格 schema（未知字段拒绝、prompt 非空 ≤4k、interval ≥5min、IANA 时区规范化）。
// **zod 依赖说明**：任务书 §2.7 要求「校验走 zod」，但本轮白名单只允许 croner 一个新依赖
// （zod 在 pnpm 严格布局下只是 MCP SDK 的传递依赖，根包不可导入）——按判卷纪律以手写严格校验
// 实现同等保证（未知字段拒绝 / 字段类型与范围 / 判别联合），已写 BLOCKED.md 备案（M4a §1）。
// electron-free（纯数据 + 纯函数），可 headless 单测。
import { randomBytes } from "node:crypto";
import { isValidSessionName } from "./sessions";
import type { PermissionMode } from "../permissions/modes";

// ---- 七 kind 数据模型（表单与验收只暴露 once/interval/daily/weekly，§12.2.1 V1 收敛）----

export type AutomationKind = "once" | "interval" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

/** 四 kind 表单白名单（hourly/monthly/custom 数据模型保留，表单/工具表单面拒绝，P21 记 M4+）。 */
export const FORM_KINDS: readonly AutomationKind[] = ["once", "interval", "daily", "weekly"];

export type AutomationSchedule =
  | { kind: "once"; at: string }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; weekdays: number[]; time: string }
  | { kind: "monthly"; monthDay: number | "last"; time: string }
  | { kind: "custom"; everyDays: number; time: string };

export type AutomationTier = "read-only" | "workspace-write" | "danger-full-access";
export type AutomationCatchUp = "latest" | "skip";

export interface AutomationDefinition {
  /** ulid（任务书 §12.2.1；makeUlid 生成）。 */
  id: string;
  /** 唯一，用于会话标题（`${name} · 触发时刻`）与检索。 */
  name: string;
  /** 自包含任务说明；触发时原样成为新会话首条用户消息的核心。上限 4k 字符（持久化攻击面防线）。 */
  prompt: string;
  schedule: AutomationSchedule;
  timeZone: string;
  permissionTier: AutomationTier;
  /** 可绑定 provider/model；缺省用全局默认。 */
  model?: string;
  catchUp: AutomationCatchUp;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** croner 算出的缓存展示值，非事实源（事实源 = schedule + 锚点，每 tick 重算）。 */
  nextRunAt?: string;
}

/** prompt 上限（§12.2.5 注入防线：4k 字符 + 审批卡全文展示）。 */
export const MAX_PROMPT_CHARS = 4_000;
/** name 上限：会话标题 = name + " · YYYY-MM-DD HH:mm"（16 字符），合计须过 isValidSessionName ≤80。 */
export const MAX_NAME_CHARS = 40;
export const MIN_INTERVAL_MINUTES = 5;

// ---- ulid（零依赖实现：48bit 毫秒时间 + 80bit 随机，Crockford Base32）----

const ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastUlidTime = 0;
let lastUlidRandom: number[] = [];

/** ulid 生成（单调性：同一毫秒内随机位 +1，保证排序稳定）。 */
export function makeUlid(now = Date.now()): string {
  let time = now;
  // ULID 规范要求随机位密码学安全：Math.random() 可预测、非碰撞 resistant（扫描器真阳性
  // danger.weak_random）。改用 crypto.randomBytes——256 % 32 == 0，byte % 32 零偏差均匀映射到
  // Crockford Base32；单调性逻辑（同毫秒 +1 进位）不受影响。
  const random: number[] = [];
  for (const b of randomBytes(16)) random.push(b % 32);
  if (time === lastUlidTime) {
    for (let i = 15; i >= 0; i--) {
      random[i] = random[i]! + 1;
      if (random[i]! < 32) break;
      random[i] = 0; // 进位（16×32bit 随机位同毫秒溢出可忽略）
    }
  }
  lastUlidTime = time;
  lastUlidRandom = random;
  let timeChars = "";
  for (let i = 9; i >= 0; i--) {
    timeChars = ULID_ENCODING[time % 32]! + timeChars;
    time = Math.floor(time / 32);
  }
  return timeChars + random.map((r) => ULID_ENCODING[r]).join("");
}

export function isValidUlid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
}

// ---- 时区（DSH 同款：Intl resolvedOptions 规范化，非法拒绝）----

/** 系统时区（创建时缺省）。 */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** IANA 规范化：非法值抛 RangeError（调用方转校验错误）。 */
export function normalizeTimeZone(tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
}

/** 时区当前 UTC 偏移预览（表单展示用，如 "UTC+08:00"）。 */
export function timeZoneOffsetLabel(tz: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return name === "" || name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");
}

// ---- 严格校验（zod 式：判别联合 + 未知字段拒绝；错误全量返回）----

export interface ValidateOptions {
  /** 表单面（设置页表单 / agent 工具 create）：只接受四 kind 白名单。缺省 false（数据模型七 kind 全收）。 */
  form?: boolean;
  /** 更新面（update 合并后校验）：跳过 name 唯一性以外的必填缺省（合并由调用方完成后再进来）。 */
  now?: Date;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** 校验器认的全部顶层字段。导出是给判卷层对账用的：模型面上出现的字段名必须在这里，
 *  否则模型照规格写出来的定义会被 `${k} 是未知字段` 拒掉（规格与实现各写一份时的必然下场）。 */
export const KNOWN_TOP_FIELDS = new Set([
  "id", "name", "prompt", "schedule", "timeZone", "permissionTier", "model", "catchUp", "enabled", "createdAt", "updatedAt", "nextRunAt",
]);

function validateSchedule(raw: unknown, errors: string[], form: boolean): AutomationSchedule | null {
  if (!isPlainObject(raw)) {
    errors.push("schedule 必须是对象");
    return null;
  }
  const kind = raw.kind;
  const allowed = form ? FORM_KINDS : (["once", "interval", "hourly", "daily", "weekly", "monthly", "custom"] as const);
  if (typeof kind !== "string" || !(allowed as readonly string[]).includes(kind)) {
    errors.push(
      form
        ? `schedule.kind 只接受表单四 kind（${FORM_KINDS.join("/")}）`
        : "schedule.kind 必须是七 kind 之一（once/interval/hourly/daily/weekly/monthly/custom）",
    );
    return null;
  }
  const perKind = new Map<string, string[]>([
    ["once", ["kind", "at"]],
    ["interval", ["kind", "everyMinutes"]],
    ["hourly", ["kind", "minute"]],
    ["daily", ["kind", "time"]],
    ["weekly", ["kind", "weekdays", "time"]],
    ["monthly", ["kind", "monthDay", "time"]],
    ["custom", ["kind", "everyDays", "time"]],
  ]);
  const fields = perKind.get(kind)!;
  for (const k of Object.keys(raw)) {
    if (!fields.includes(k)) errors.push(`schedule.${k} 是未知字段（${kind} 只接受 ${fields.join("/")}）`);
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const timeOk = typeof raw.time === "string" && TIME_RE.test(raw.time);
  switch (kind) {
    case "once": {
      if (typeof raw.at !== "string" || Number.isNaN(Date.parse(raw.at))) {
        errors.push("schedule.at 必须是可解析的 ISO 时间串");
        return null;
      }
      return { kind: "once", at: raw.at };
    }
    case "interval": {
      const m = num(raw.everyMinutes);
      if (m === null || m < MIN_INTERVAL_MINUTES) {
        errors.push(`schedule.everyMinutes 必须是 ≥ ${String(MIN_INTERVAL_MINUTES)} 的整数（分钟）`);
        return null;
      }
      return { kind: "interval", everyMinutes: m };
    }
    case "hourly": {
      const m = num(raw.minute);
      if (m === null || m < 0 || m > 59) {
        errors.push("schedule.minute 必须是 0-59 整数");
        return null;
      }
      return { kind: "hourly", minute: m };
    }
    case "daily": {
      if (!timeOk) {
        errors.push("schedule.time 必须是 HH:mm（00:00-23:59）");
        return null;
      }
      return { kind: "daily", time: raw.time as string };
    }
    case "weekly": {
      if (!timeOk) {
        errors.push("schedule.time 必须是 HH:mm（00:00-23:59）");
        return null;
      }
      const wd = raw.weekdays;
      if (
        !Array.isArray(wd) ||
        wd.length === 0 ||
        !wd.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6) ||
        new Set(wd).size !== wd.length
      ) {
        errors.push("schedule.weekdays 必须是 0-6（0=周日）非空去重数组");
        return null;
      }
      return { kind: "weekly", weekdays: [...(wd as number[])].sort((a, b) => a - b), time: raw.time as string };
    }
    case "monthly": {
      if (!timeOk) {
        errors.push("schedule.time 必须是 HH:mm（00:00-23:59）");
        return null;
      }
      const md = raw.monthDay;
      const okDay = (typeof md === "number" && Number.isInteger(md) && md >= 1 && md <= 31) || md === "last";
      if (!okDay) {
        errors.push('schedule.monthDay 必须是 1-31 整数或 "last"');
        return null;
      }
      return { kind: "monthly", monthDay: md as number | "last", time: raw.time as string };
    }
    case "custom": {
      if (!timeOk) {
        errors.push("schedule.time 必须是 HH:mm（00:00-23:59）");
        return null;
      }
      const d = num(raw.everyDays);
      if (d === null || d < 1 || d > 365) {
        errors.push("schedule.everyDays 必须是 1-365 整数（天）");
        return null;
      }
      return { kind: "custom", everyDays: d, time: raw.time as string };
    }
  }
  return null;
}

export type ValidationResult =
  | { ok: true; value: AutomationDefinition }
  | { ok: false; errors: string[] };

/**
 * 严格校验（zod 式 parse）：未知字段拒绝（顶层 + schedule 内）、prompt 非空 ≤4k、name 会话名安全 ≤40、
 * interval ≥5min、IANA 时区规范化（非法拒绝）、枚举收窄。返回全量错误清单（fail-loud）。
 */
export function validateAutomation(raw: unknown, opts: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ["定时任务定义必须是对象"] };
  for (const k of Object.keys(raw)) {
    if (!KNOWN_TOP_FIELDS.has(k)) errors.push(`${k} 是未知字段`);
  }
  // id：create 面可缺省（调用方生成）；在场必须是 ulid
  if (raw.id !== undefined && !isValidUlid(raw.id)) errors.push("id 必须是 ulid");
  // name：会话标题安全（与 sessions.isValidSessionName 同源约束，短一些给 " · 时刻" 留位）
  if (typeof raw.name !== "string" || raw.name.length < 1 || raw.name.length > MAX_NAME_CHARS) {
    errors.push(`name 必须是 1-${String(MAX_NAME_CHARS)} 字符的字符串`);
  } else if (!isValidSessionName(raw.name) || raw.name.includes("·")) {
    errors.push("name 含非法字符（会话名约束：无路径分隔符/控制符/点，且不含间隔符 ·）");
  }
  // prompt：非空 ≤4k（持久化攻击面防线，§12.2.5）
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length === 0) {
    errors.push("prompt 必须是非空字符串");
  } else if (raw.prompt.length > MAX_PROMPT_CHARS) {
    errors.push(`prompt 超过 ${String(MAX_PROMPT_CHARS)} 字符上限（当前 ${String(raw.prompt.length)}）`);
  }
  const schedule = validateSchedule(raw.schedule, errors, opts.form === true);
  // timeZone：IANA 规范化（非法拒绝）；缺省 = 系统时区
  let timeZone = systemTimeZone();
  if (raw.timeZone !== undefined) {
    if (typeof raw.timeZone !== "string" || raw.timeZone.trim() === "") {
      errors.push("timeZone 必须是非空 IANA 字符串");
    } else {
      try {
        timeZone = normalizeTimeZone(raw.timeZone);
      } catch {
        errors.push(`timeZone 非法（IANA 解析失败）: ${JSON.stringify(raw.timeZone)}`);
      }
    }
  }
  const tier = raw.permissionTier ?? "read-only";
  if (tier !== "read-only" && tier !== "workspace-write" && tier !== "danger-full-access") {
    errors.push("permissionTier 必须是 read-only / workspace-write / danger-full-access");
  }
  const catchUp = raw.catchUp ?? "latest";
  if (catchUp !== "latest" && catchUp !== "skip") {
    errors.push("catchUp 必须是 latest / skip");
  }
  if (raw.model !== undefined && (typeof raw.model !== "string" || raw.model.trim() === "")) {
    errors.push("model 必须是非空字符串（缺省 = 全局默认）");
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") errors.push("enabled 必须是布尔");
  for (const k of ["createdAt", "updatedAt"] as const) {
    if (raw[k] !== undefined && (typeof raw[k] !== "string" || Number.isNaN(Date.parse(raw[k] as string)))) {
      errors.push(`${k} 必须是 ISO 时间串`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const now = opts.now ?? new Date();
  const value: AutomationDefinition = {
    id: typeof raw.id === "string" ? raw.id : makeUlid(now.getTime()),
    name: raw.name as string,
    prompt: raw.prompt as string,
    schedule: schedule as AutomationSchedule,
    timeZone,
    permissionTier: tier as AutomationTier,
    catchUp: catchUp as AutomationCatchUp,
    enabled: raw.enabled === undefined ? true : (raw.enabled as boolean),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now.toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now.toISOString(),
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(typeof raw.nextRunAt === "string" ? { nextRunAt: raw.nextRunAt } : {}),
  };
  return { ok: true, value };
}

/** 档位 → 审批档（PermissionMode，§11.7.2 对表）：只读→read-only；workspace-write→default（逐次审批）；danger-full-access→auto。 */
export function tierToMode(tier: AutomationTier): PermissionMode {
  if (tier === "read-only") return "read-only";
  if (tier === "danger-full-access") return "auto";
  return "default";
}

/** 审批卡红字判定：workspace-write 及以上档位 → 审批卡标注「将无人值守执行」（§12.2.5）。 */
export function isUnattendedTier(tier: AutomationTier): boolean {
  return tier !== "read-only";
}
