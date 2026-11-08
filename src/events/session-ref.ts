// 跨文件来源引用（ADR 0005 产品接入）：一个事件属于**哪个工作区、哪个会话、哪个物理行**。
// 键一律用 JSON 元组——不用分隔符拼接：`"a:b"+"c"` 与 `"a"+"b:c"` 必须分得开。

export interface EventRef {
  /** 经可信注册根解析的规范工作区路径。 */
  workspace: string;
  /** 该工作区中实际拥有这一行的会话 id（文件名去 `.jsonl`）。 */
  sessionId: string;
  /** 该会话文件里的 1-based 物理行号。 */
  eventId: number;
}

export type SessionRef = Pick<EventRef, "workspace" | "sessionId">;

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** 形状校验：workspace / sessionId 非空，eventId 为正安全整数（0 与负数不是行号）。 */
export function isSessionRef(value: unknown): value is SessionRef {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<SessionRef>;
  return nonEmptyString(v.workspace) && nonEmptyString(v.sessionId);
}

export function isEventRef(value: unknown): value is EventRef {
  if (!isSessionRef(value)) return false;
  const id = (value as Partial<EventRef>).eventId;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

export function sessionRefKey(ref: SessionRef): string {
  return JSON.stringify([ref.workspace, ref.sessionId]);
}

export function eventRefKey(ref: EventRef): string {
  return JSON.stringify([ref.workspace, ref.sessionId, ref.eventId]);
}

export function sameSession(a: SessionRef, b: SessionRef): boolean {
  return a.workspace === b.workspace && a.sessionId === b.sessionId;
}

export function sameEventRef(a: EventRef, b: EventRef): boolean {
  return sameSession(a, b) && a.eventId === b.eventId;
}
