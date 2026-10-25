// ADR 0005 的产品会话入口。raw replay / gym 的拷贝分叉仍由 log.ts 提供。
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { replay } from "./log";
import { effectiveEvents } from "./projection";
import { redactEventForLog } from "./redact";
import type { AgentEvent, SessionMetaEvent } from "./types";

export type SessionReplayErrorCode =
  | "session-missing" | "invalid-fork" | "boundary-out-of-range" | "fork-cycle" | "outside-session-root";

export class SessionReplayError extends Error {
  constructor(readonly code: SessionReplayErrorCode, message: string) {
    super(message);
    this.name = "SessionReplayError";
  }
}

export interface ReplaySessionOptions {
  /** 生产读入口应传入可信 sessions 根目录。检查 realpath 后的每个祖先，软链不能越界。
   *  缺省只适用于可信本地日志；不可直接用于附件或不可信导入日志。 */
  allowedRoot?: string;
}

/** 未收尾请求所在的下标（1-based 行号无关，纯位置）。
 *  配对按事件族 + agent_id + 调用 id 分域，不让 worker 的同名结果替主流收尾。 */
export function unfinishedIndexes(events: readonly AgentEvent[]): Set<number> {
  const pending = new Map<string, number[]>();
  for (const [index, event] of events.entries()) {
    let family: string;
    let id: string;
    let opens: boolean;
    switch (event.type) {
      case "tool_call": family = "tool"; id = event.id; opens = true; break;
      case "clarify_requested": family = "tool"; id = event.callId; opens = true; break;
      case "tool_result": family = "tool"; id = event.callId; opens = false; break;
      case "plan_proposed": family = "plan"; id = event.callId; opens = true; break;
      case "plan_approved": family = "plan"; id = event.callId; opens = false; break;
      case "approval_requested": family = "approval"; id = event.id; opens = true; break;
      case "approval_resolved": family = "approval"; id = event.id; opens = false; break;
      default: continue;
    }
    const key = JSON.stringify([family, (event as { agent_id?: string }).agent_id ?? null, id]);
    if (opens) pending.set(key, [...(pending.get(key) ?? []), index]);
    else pending.delete(key);
  }
  return new Set([...pending.values()].flat());
}

/** 仅在继承边界丢弃未收尾的请求；本会话自己的在飞请求照常保留。 */
function settledHistory(events: readonly AgentEvent[]): AgentEvent[] {
  const unfinished = unfinishedIndexes(events);
  return events.filter((_, index) => !unfinished.has(index));
}

function forkOf(events: readonly AgentEvent[]): SessionMetaEvent["fork"] {
  let fork: SessionMetaEvent["fork"];
  for (const [index, event] of events.entries()) {
    if (event.type !== "session_meta" || !Object.hasOwn(event, "fork")) continue;
    const value = event.fork;
    if (index !== 0 || !value || typeof value !== "object" ||
      typeof value.from_session_path !== "string" || !isAbsolute(value.from_session_path) ||
      (value.from_session_id !== undefined && (typeof value.from_session_id !== "string" || value.from_session_id.length === 0))) {
      throw new SessionReplayError("invalid-fork", "分叉血缘必须在首行 session_meta，父路径必须是绝对路径");
    }
    fork = value;
  }
  return fork;
}

function checkBoundary(boundary: number, count: number): void {
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > count) {
    throw new SessionReplayError("boundary-out-of-range", `分叉边界 ${String(boundary)} 越界（父文件 ${String(count)} 条事件）`);
  }
}

export interface SessionChainFile {
  /** realpath 后的物理文件。 */
  path: string;
  /** 文件名推出的会话 id（`<id>.jsonl`）。 */
  sessionId: string;
  /** 该文件 raw 事件（逐字，未投影）。 */
  raw: AgentEvent[];
  /** 作为某人的父时被继承的 raw 前缀长度；`undefined` = 本地文件（无边界）。 */
  boundary: number | undefined;
}

async function resolveChainInner(
  path: string, boundary: number | undefined, active: Set<string>, allowedRoot: string | undefined, out: SessionChainFile[],
): Promise<void> {
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SessionReplayError("session-missing", `会话文件缺失：${path}`);
    }
    throw error;
  }
  if (allowedRoot !== undefined) {
    const child = relative(allowedRoot, canonical);
    if (child === ".." || child.startsWith(".." + sep) || isAbsolute(child)) {
      throw new SessionReplayError("outside-session-root", `会话父链超出允许目录：${canonical}`);
    }
  }
  if (active.has(canonical)) throw new SessionReplayError("fork-cycle", `会话父链成环：${canonical}`);
  active.add(canonical);
  try {
    const raw = await replay(canonical);
    if (boundary !== undefined) checkBoundary(boundary, raw.length);
    const fork = forkOf(raw);
    // 边界以父文件 raw 行号为准；即使边界为 0，也验证整条血缘（不能靠空前缀掩盖缺失父文件或环）。
    if (fork !== undefined) {
      await resolveChainInner(fork.from_session_path, fork.boundary_event_id, active, allowedRoot, out);
    }
    out.push({ path: canonical, sessionId: basename(canonical, ".jsonl"), raw, boundary });
  } finally {
    active.delete(canonical);
  }
}

/** 血缘链（根祖先 → 本地）：每份文件的 raw、物理路径与继承边界。
 *  与 `replaySession` 共用同一份验证（软链/越界/环/边界/坏血缘），不复制解析算法。 */
export async function resolveSessionChain(
  path: string, boundary: number | undefined, allowedRoot?: string,
): Promise<SessionChainFile[]> {
  const root = allowedRoot === undefined ? undefined : await realpath(allowedRoot);
  const out: SessionChainFile[] = [];
  await resolveChainInner(path, boundary, new Set(), root, out);
  return out;
}

/** 父前缀 + 本地有效历史。输出是投影，数组下标不是任何文件的 raw 事件 id。
 *  raw 游标、回退、压缩等带行号的操作必须继续对各自原文件定位。 */
async function resolveSession(path: string, boundary: number | undefined, allowedRoot?: string): Promise<AgentEvent[]> {
  const chain = await resolveSessionChain(path, boundary, allowedRoot);
  const inherited: AgentEvent[] = [];
  for (const file of chain.slice(0, -1)) {
    inherited.push(...effectiveEvents(file.boundary === undefined ? file.raw : file.raw.slice(0, file.boundary)));
  }
  const local = chain[chain.length - 1]!;
  const own = effectiveEvents(local.boundary === undefined ? local.raw : local.raw.slice(0, local.boundary));
  if (own.length === 0) return [];
  return [...settledHistory(inherited), ...own];
}

/** 父前缀 + 本地有效历史（公开入口）。 */
export async function replaySession(path: string, options: ReplaySessionOptions = {}): Promise<AgentEvent[]> {
  return resolveSession(path, undefined, options.allowedRoot);
}

export interface PointerForkResult {
  sessionDir: string;
  eventsPath: string;
  /** 指针文件仅一行 session_meta；不是合成历史的事件数。 */
  count: 1;
}

/** 创建产品指针分叉。先验证父链，目标采用排他创建，已有转录绝不覆盖。
 *  boundaryEventId 为父文件 raw 行号（含）；0 明确表示有父但不继承事件。 */
export async function forkSessionPointer(
  sessionPath: string, boundaryEventId: number, targetDir: string, fromSessionId?: string,
): Promise<PointerForkResult> {
  await resolveSession(sessionPath, boundaryEventId);
  if (fromSessionId !== undefined && (typeof fromSessionId !== "string" || fromSessionId.length === 0)) {
    throw new SessionReplayError("invalid-fork", "父会话 id 不能是空串");
  }
  const parentPath = await realpath(sessionPath);
  const sessionDir = resolve(targetDir);
  const eventsPath = join(sessionDir, "events.jsonl");
  const meta: SessionMetaEvent & { ts: number } = {
    type: "session_meta", ts: Date.now(),
    fork: { from_session_path: parentPath, boundary_event_id: boundaryEventId, ...(fromSessionId === undefined ? {} : { from_session_id: fromSessionId }) },
  };
  await mkdir(sessionDir, { recursive: true });
  await writeFile(eventsPath, JSON.stringify(redactEventForLog(meta)) + "\n", { flag: "wx" });
  return { sessionDir, eventsPath, count: 1 };
}
