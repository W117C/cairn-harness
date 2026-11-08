// 会话游标：**不透明**、**fail-closed** 的续跑指针（ADR 0005）。
//
// 什么是游标：一条「继续这条会话，从哪儿接着」的指针。它带三样东西——会话身份、位置、种类。
// 它是**不透明**的：调用方只该把它当一串字符传来传去，不该解析它、不该拼它。
//
// 为什么 fail-closed（这一族规则的整个要点）：
// 坏游标**不许**被换成另一个位置（旧实现的默认回落是"接着上一轮"——那会把续跑接到
// **另一个**状态上，模型看着一段不是它自己写的历史继续干，且日志里查不出断点）。
// 四种错法各有各的码：
//   · `malformed`        —— 解不开 / 校验和不符 / 版本不对（手改过的游标在这一类里）。
//   · `unsupported-kind` —— 解得开、校验也对，但种类不是本实现支持的那几种。
//   · `session-mismatch` —— 游标属于**另一个**会话（拿 A 的游标续 B）。
//   · `out-of-range`     —— 位置越界（超出这条会话的事件数，或 < 1）。
// 任何一种都**抛**，不许兜底、不许改写、不许"就近取一个"。
import { createHash } from "node:crypto";
import type { AgentEvent } from "../events";

/** 游标的分型码。 */
export type CursorErrorCode = "malformed" | "unsupported-kind" | "session-mismatch" | "out-of-range";

/** 游标错误：**坏游标必须炸**，不许静默换一个位置顶上。 */
export class CursorError extends Error {
  readonly code: CursorErrorCode;
  constructor(code: CursorErrorCode, message: string) {
    super(message);
    this.name = "CursorError";
    this.code = code;
  }
}

/** 本实现支持的游标种类（新增一种 = 新增一个分支，不是改这个集合）。 */
export const CURSOR_KINDS = ["session"] as const;
export type CursorKind = (typeof CURSOR_KINDS)[number];

/** 游标协议版本：版本不对 ⇒ `malformed`（不许"尽力而为地"解析旧版）。 */
export const CURSOR_VERSION = 1;

/** 解出来的游标（内容面，调用方只看这几个字段）。 */
export interface SessionCursor {
  kind: CursorKind;
  /** 游标所属会话 id（与日志路径的会话身份同一口径）。 */
  sessionId: string;
  /** 位置：1-based 事件 id，**含**该条（续跑时该条属于重放范围）。 */
  eventId: number;
  /** 协议版本。 */
  version: number;
}

/** 游标载荷（线上格式 = base64url(JSON)）。 */
interface CursorPayload {
  v: number;
  kind: string;
  sid: string;
  eid: number;
  /** 载荷的短校验和（防手改/防截断）。 */
  c: string;
}

/** 载荷的规范化串（校验和的输入）：键序固定 ⇒ 同一份载荷必得同一个校验和。 */
function canonical(p: Omit<CursorPayload, "c">): string {
  return JSON.stringify([p.v, p.kind, p.sid, p.eid]);
}

/** 短校验和：sha256 前 8 个 hex 字符（32 位足够挡住手改与传输截断，且不喧宾夺主）。 */
function checksum(p: Omit<CursorPayload, "c">): string {
  return createHash("sha256").update(canonical(p)).digest("hex").slice(0, 8);
}

/**
 * 编码游标 → 不透明字符串。
 *
 *  载荷 = `{v, kind, sid, eid, c}` 的紧凑 JSON，base64url 后成串。
 *  **不透明**是契约：调用方不许自己拼载荷（拼出来的没有校验和 ⇒ 一律 `malformed`）。
 */
export function encodeCursor(input: { sessionId: string; eventId: number; kind?: CursorKind }): string {
  const kind = input.kind ?? "session";
  const p: Omit<CursorPayload, "c"> = {
    v: CURSOR_VERSION,
    kind,
    sid: input.sessionId,
    eid: input.eventId,
  };
  const payload: CursorPayload = { ...p, c: checksum(p) };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * 解码游标 → 内容面。**只解形状**：会话不匹配与位置越界需要上下文（正在续哪条会话、有几条事件），
 * 那两项由 `forkPointFromCursor` / 带上下文的 `decodeCursor` 判。
 *
 * 抛：`CursorError`，码为 `malformed` 或 `unsupported-kind`。
 */
export function decodeCursor(raw: string, ctx?: { sessionId?: string; eventCount?: number }): SessionCursor {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]+$/.test(raw) || Buffer.from(raw, "base64url").toString("base64url") !== raw) {
    throw new CursorError("malformed", "游标为空串（坏游标必须炸，不许回落成别的位置）");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new CursorError("malformed", "游标解不开（不是 base64url JSON）");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CursorError("malformed", "游标载荷不是对象");
  }
  const p = parsed as Partial<CursorPayload>;
  if (p.v !== CURSOR_VERSION) {
    throw new CursorError("malformed", `游标版本不支持：${JSON.stringify(p.v)}（本实现只认 ${String(CURSOR_VERSION)}）`);
  }
  if (typeof p.kind !== "string" || typeof p.sid !== "string" || typeof p.eid !== "number" || typeof p.c !== "string") {
    throw new CursorError("malformed", "游标字段形状不对");
  }
  const body = { v: p.v, kind: p.kind, sid: p.sid, eid: p.eid };
  if (checksum(body) !== p.c) {
    throw new CursorError("malformed", "游标校验和不符（被手改过或传输中损坏）");
  }
  if (!Number.isSafeInteger(p.eid)) {
    throw new CursorError("malformed", `游标位置不是正整数：${JSON.stringify(p.eid)}`);
  }
  if (p.eid < 1) {
    throw new CursorError("out-of-range", `游标位置必须 ≥ 1：${String(p.eid)}`);
  }
  if (p.sid.length === 0) {
    throw new CursorError("malformed", "游标会话 id 为空串");
  }
  if (!(CURSOR_KINDS as readonly string[]).includes(p.kind)) {
    throw new CursorError("unsupported-kind", `游标种类不支持：${JSON.stringify(p.kind)}（本实现支持 ${CURSOR_KINDS.join("、")}）`);
  }
  const cursor: SessionCursor = { kind: p.kind as CursorKind, sessionId: p.sid, eventId: p.eid, version: p.v };
  // 带上下文时顺手把「会话不匹配」「位置越界」也判掉（不许留给调用方自己糊弄过去）。
  if (ctx?.sessionId !== undefined && cursor.sessionId !== ctx.sessionId) {
    throw new CursorError("session-mismatch", `游标属于会话 ${cursor.sessionId}，不是要续的 ${ctx.sessionId}`);
  }
  if (ctx?.eventCount !== undefined && (cursor.eventId > ctx.eventCount || cursor.eventId < 1)) {
    throw new CursorError("out-of-range", `游标位置 ${cursor.eventId} 越界（该会话共 ${ctx.eventCount} 条事件）`);
  }
  return cursor;
}

/** 游标给出的分叉点（= 复用的最后一条事件 id，1-based，含）。 */
export interface CursorForkPoint {
  /** 复用的最后一条事件 id（含）。 */
  lastIncluded: number;
}

/**
 * 游标 → 分叉点。会话不匹配 ⇒ `session-mismatch`；位置越界 ⇒ `out-of-range`。
 *
 * **`eventId` 是含的**：游标指向的那条事件**属于**重放范围
 * （与 ACP 的 `session/resume` 的 `replayFrom` 同一口径：指针所在的那一条不被丢掉）。
 *
 * 不许在此处"就近兜底"：坏游标必须炸，绝不退成"最后一条"或"第 0 条"。
 */
export function forkPointFromCursor(
  events: readonly AgentEvent[],
  cursor: SessionCursor,
  sessionId: string,
): CursorForkPoint {
  if (!cursor || typeof cursor !== "object" || cursor.version !== CURSOR_VERSION ||
      typeof cursor.kind !== "string" || typeof cursor.sessionId !== "string" || cursor.sessionId.length === 0) {
    throw new CursorError("malformed", "结构化游标的版本或字段形状不对");
  }
  if (!(CURSOR_KINDS as readonly string[]).includes(cursor.kind)) {
    throw new CursorError("unsupported-kind", `游标种类不支持：${cursor.kind}`);
  }
  if (cursor.sessionId !== sessionId) {
    throw new CursorError("session-mismatch", `游标属于会话 ${cursor.sessionId}，不是要续的 ${sessionId}`);
  }
  if (!Number.isSafeInteger(cursor.eventId) || cursor.eventId < 1 || cursor.eventId > events.length) {
    throw new CursorError(
      "out-of-range",
      `游标位置 ${String(cursor.eventId)} 越界（该会话共 ${String(events.length)} 条事件）`,
    );
  }
  return { lastIncluded: cursor.eventId };
}

/**
 * 游标 → 重放范围（**含** `eventId` 那条）。
 * 越界/不匹配同上，抛。
 */
export function replayFromCursor(
  events: readonly AgentEvent[],
  cursor: SessionCursor,
  sessionId: string,
): AgentEvent[] {
  const fp = forkPointFromCursor(events, cursor, sessionId);
  return events.slice(0, fp.lastIncluded);
}
