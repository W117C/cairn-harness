// 会话全文检索（2026-10-22 · 阶段 3）：core 层、electron-free、可 headless 单测。
//
// ============================ 三个 kind 的含义（整个文件最重要的一段）============================
//   ok         = **扫完了**：根目录里每个会话文件都完整读过一遍。matches 为空 ＝ **量过了、没有命中**。
//   partial    = **没扫完**：已给出的命中是真的（都来自扫过的字节），但**可能还有命中没被看到**。
//                调用方必须能说出口：「这些是我们找到的，但我们在字节帽处停了，可能还有」。
//   unavailable= **根本没量**：会话根读不到 / 不是目录 / 没有可用的索引。
//                它**绝不能**被渲染成「没有匹配」——那是把「没量到」说成「不存在」。
//
// 「**没量到 ≠ 没有**」是本文件的存在理由。一个只返回 `matches: []` 的搜索接口，
// 它的读者永远分不清「扫完了没命中」和「压根没扫」；所以三态是**类型层面**分开的（判别式联合），
// 不是靠文档约定。空结果只有一种合法形态：`kind: "ok"` + `matches: []`。
//
// ============================ 语料口径（可见性过滤）============================
// 语料 = **用户可见的对话正文**，只有三种事件（`VISIBLE_EVENT_KINDS`，唯一事实源）：
//   · user_message.content      —— 用户说的话
//   · assistant_message.content —— 助手的一条完整消息
//   · assistant_delta.text      —— 助手消息的**流式片段**，按 callId 合并成一条（一段回复不是 N 段）
// 明确**不在**语料里的：thinking_delta（模型自己的思考，用户看不见）、tool_call / tool_result（工具载荷）、
// agent_*（worker 子流内部）、usage、security_report、session_meta、compaction、goal_*、error 等一切其余事件。
// 判定只有一处（`isVisibleEventKind`），不许在下游再抄一份。
//
// ============================ 预算（为什么要有帽）============================
// 扫全部会话的全文是无界工作量。本模块给一条**总字节预算**（跨所有会话文件）＋一条**会话条数帽**：
// 预算用尽时结果退到 `partial`，**不是**静悄悄地变成一个看起来完整的答案。
//
// ============================ 不做的（留给 profiler 说话）============================
// 没有索引、没有倒排、没有增量缓存：这一版是**线性扫描 + 字节帽**。索引等 profiler 说话（台账 §3b E3）。
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readSessionView, resolveSessionChain, type AgentEvent, type EventRef, type SessionRef } from "../events";
import type { SessionMetadataRecord } from "./session-metadata";

// ---- 语料口径：可见事件种类（唯一事实源）----
/** 进语料的事件种类。**除这三种以外的一切事件都不进语料**（含 thinking_delta）。 */
export const VISIBLE_EVENT_KINDS = ["user_message", "assistant_message", "assistant_delta"] as const;
export type VisibleEventKind = (typeof VISIBLE_EVENT_KINDS)[number];

/** 可见判定（唯一判定点）。别处不许再抄一份「哪些事件算正文」。 */
export function isVisibleEventKind(type: string): type is VisibleEventKind {
  return (VISIBLE_EVENT_KINDS as readonly string[]).includes(type);
}

/** 一条可见消息（delta 已按 callId 合并）。 */
export interface VisibleMessage {
  kind: VisibleEventKind;
  text: string;
  /** 该消息在**所属文件**里的物理行号（来源引用）；纯函数语料没有来源时缺席。 */
  ref?: EventRef;
}

// ---- 预算与摘录的缺省值（文档化常量：别处不许再抄一份数字）----
/** 扫描预算缺省值：跨所有会话文件的总字节帽（8 MiB）。 */
export const DEFAULT_SEARCH_BUDGET_BYTES = 8 * 1024 * 1024;
/** 会话条数缺省帽：最多扫这么多 个会话文件。 */
export const DEFAULT_SEARCH_MAX_SESSIONS = 200;
/** 每个会话返回的摘录条数缺省上限（命中条数照实给，摘录有帽——`matchCount > snippets.length` 即被截断）。 */
export const DEFAULT_SEARCH_MAX_SNIPPETS = 5;
/** 单条摘录的字符上限（含省略号）。 */
export const SNIPPET_MAX_CHARS = 240;
/** 读文件时的分块大小（不整份读进内存）。 */
const READ_CHUNK_BYTES = 64 * 1024;

// ---- 语料装配：delta 按 callId 合并 ----
/**
 * 可见语料装配器（流式扫描与纯函数投影共用同一份实现 ⇒ 判定只有一处）。
 *
 * 合并规则（与 `src/agent/context.ts` 的 delta 缓冲同源，但**不**在 tool_* 处断段）：
 *   · `assistant_delta` 按 callId 累加：一段流式回复 = 一条消息（不是 N 条）。
 *   · 只有 `user_message` / `assistant_message` 会把待并的 delta 段落**定位**（flush）到消息列表里，
 *     保证次序（片段在前、随后的整条消息在后）。
 *   · 其余事件（thinking_delta / tool_* / usage / agent_* …）**既不进语料、也不打断合并**：
 *     模型思考与工具载荷插在两段流式片段中间时，跨它们的关键词仍能命中（callId 相同 ⇒ 同一条回复）。
 */
class VisibleCorpus {
  private readonly messages: VisibleMessage[] = [];
  private readonly deltaBuf = new Map<string, string>();
  private readonly deltaOrder: string[] = [];
  /** 每条 delta 组首段的来源（合并后的消息指向它）。 */
  private readonly deltaRef = new Map<string, EventRef | undefined>();

  push(event: AgentEvent, ref?: EventRef): void {
    if (event.type === "user_message" || event.type === "assistant_message") {
      this.flushDeltas();
      this.messages.push({ kind: event.type, text: event.content, ...(ref !== undefined ? { ref } : {}) });
      return;
    }
    if (event.type === "assistant_delta") {
      if (!this.deltaBuf.has(event.callId)) {
        this.deltaOrder.push(event.callId);
        this.deltaRef.set(event.callId, ref);
      }
      this.deltaBuf.set(event.callId, (this.deltaBuf.get(event.callId) ?? "") + event.text);
      return;
    }
    // 其余事件：不在语料面内（可见性过滤的唯一判定点在上面两处分支）。
  }

  /** 待并的 delta 段落落位（按首次出现次序）。 */
  private flushDeltas(): void {
    for (const callId of this.deltaOrder) {
      const ref = this.deltaRef.get(callId);
      this.messages.push({ kind: "assistant_delta", text: this.deltaBuf.get(callId) ?? "", ...(ref !== undefined ? { ref } : {}) });
    }
    this.deltaBuf.clear();
    this.deltaOrder.length = 0;
    this.deltaRef.clear();
  }

  finish(): VisibleMessage[] {
    this.flushDeltas();
    return this.messages;
  }
}

/** 事件序列 → 可见语料（纯函数，可不碰文件系统单测）。 */
export function visibleTextOf(events: readonly AgentEvent[]): VisibleMessage[] {
  const corpus = new VisibleCorpus();
  for (const event of events) corpus.push(event);
  return corpus.finish();
}

// ---- 关键词 ----
/**
 * 查询 → 关键词列表（**OR** 语义：任一关键词命中即命中）。
 * 空白分词；`"..."` / `'...'` 包住的是**短语**（必须连续出现，整体当一个关键词）。
 * 大小写不敏感由匹配面负责（这里保留原样，摘录里要显示原词）。
 */
export function keywordsOf(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const kw = raw.trim();
    if (kw === "") return;
    const key = kw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(kw);
  };
  let i = 0;
  while (i < query.length) {
    const ch = query[i]!;
    // 空白先跳过：**必须**在这里推进 i，否则「词首就是空白」时内层扫描一步不动 ⇒ 死循环
    // （词尾那个空白由内层扫描吃掉，词与词之间的空白只能靠这一支吃掉）。
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = query.indexOf(ch, i + 1);
      if (end > i) {
        push(query.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      i += 1; // 未闭合的引号：当作普通字符跳过
      continue;
    }
    let j = i;
    while (j < query.length && !/\s/.test(query[j]!)) j += 1;
    push(query.slice(i, j));
    i = j;
  }
  return out;
}

/** 文本命中的关键词（大小写不敏感；返回原样的关键词，摘录要用）。 */
export function matchKeywords(text: string, keywords: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    if (needle !== "" && lower.includes(needle)) hits.push(keyword);
  }
  return hits;
}

/**
 * 摘录：命中词**可见**的一小段上下文（单行化 + 居中窗口 + 两端省略号）。
 * 命中词找不到时（理论上不会发生）返回单行化的开头。
 */
export function snippetOf(text: string, keyword: string, maxChars: number = SNIPPET_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const at = flat.toLowerCase().indexOf(keyword.toLowerCase());
  if (at < 0) return flat.length > maxChars ? flat.slice(0, maxChars) + "…" : flat;
  const half = Math.max(0, Math.floor((maxChars - keyword.length) / 2));
  let start = Math.max(0, at - half);
  let end = Math.min(flat.length, start + maxChars);
  start = Math.max(0, end - maxChars);
  const body = flat.slice(start, end);
  return (start > 0 ? "…" : "") + body + (end < flat.length ? "…" : "");
}

// ---- 结果形状 ----
/** 一条摘录：命中所在的消息种类 + 命中的关键词 + 上下文摘录。 */
export interface SessionSearchSnippet {
  /** 命中所在的消息种类（三种可见种类之一）。 */
  kind: VisibleEventKind;
  /** 命中的关键词（原样，便于界面高亮）。 */
  keyword: string;
  /** 上下文摘录（**含命中词**；长度有帽）。 */
  excerpt: string;
  /** 该消息在可见语料中的序号（0-based）。 */
  index: number;
  /** 命中的**来源**（所属文件 + 物理行号）；祖先命中时仍指父文件的行。 */
  ref?: EventRef;
}

/** 一个会话的聚合结果（**一个会话一条**，不是每条消息一条）。 */
export interface SessionSearchMatch {
  sessionId: string;
  /** 结果所属会话的精确来源（workspace + sessionId）：两个工作区同名 id 必须分得开。 */
  session: SessionRef;
  /** sidecar 标题。**缺席 = 没有 sidecar 记录（标题未知）**，不是「空标题」。 */
  title?: string;
  /** 命中消息条数（可见语料里命中任一关键词的消息数）。 */
  matchCount: number;
  /** 摘录（有帽：`maxSnippetsPerSession`；条数不足时 `matchCount > snippets.length`）。 */
  snippets: SessionSearchSnippet[];
  /** 该会话被读到的字节数。 */
  bytes: number;
  /** 该会话是否被**完整**读完。false = 被字节帽切断（`matchCount` 只是下界）。 */
  complete: boolean;
  /** 该会话里读不出来的行数（坏行）。>0 ⇒ 这一格的命中数也是下界。 */
  badLines: number;
}

/**
 * 检索结果的判别式联合——**三态在类型层面分开**（见文件头）。
 *  - ok：扫完了，matches 为空 ＝ 量过了没命中。
 *  - partial：**没扫完**。命中为真，但可能还有。必须能对用户说「可能还有」。
 *  - unavailable：**没量**。绝不能被读成「没有匹配」。
 */
export type SessionSearchResult =
  | {
      kind: "ok";
      matches: SessionSearchMatch[];
      /** 完整读过的会话数。 */
      scannedSessions: number;
      /** 实际读到的字节数。 */
      scannedBytes: number;
      /** 根目录里的会话文件总数（sidecar 文件扣除后；partial 时是上界）。 */
      totalSessions: number;
    }
  | {
      kind: "partial";
      matches: SessionSearchMatch[];
      scannedSessions: number;
      scannedBytes: number;
      totalSessions: number;
      /** 这次用的字节预算。 */
      budgetBytes: number;
      /**
       * 预算怎么用尽的：
       *   "bytes"   = 字节预算用尽（还有会话没扫）
       *   "sessions"= 会话条数帽用尽（还有会话没扫）
       *   "none"    = 预算没欠账，但**有会话读不出来 / 有坏行**（见 unreadableSessions / badLines）
       */
      budgetExhaustedAt: "sessions" | "bytes" | "none";
      /** 读不出来（权限/IO 错）的会话数。>0 ⇒ 这些会话的命中数是未知的。 */
      unreadableSessions: number;
      /** 坏行总数（JSON 解析不出来的行）。>0 ⇒ 那些行的内容没量到。 */
      badLines: number;
      /** 被字节帽切断（只读了一部分）的会话 id。 */
      truncatedSessions: string[];
    }
  | {
      kind: "unavailable";
      /** 机器可读的原因：root-missing / root-not-a-directory / root-unreadable / empty-query。 */
      reason: string;
      detail?: string;
    };

// ---- 入口 ----
export interface SessionSearchOptions {
  /** 会话根目录（`<root>/<id>.jsonl`）。 */
  root: string;
  /** 查询串（空白分词；引号内是短语）。 */
  query: string;
  /** 跨所有会话文件的总字节预算（缺省 `DEFAULT_SEARCH_BUDGET_BYTES`）。 */
  budgetBytes?: number;
  /** 最多扫多少 个会话文件（缺省 `DEFAULT_SEARCH_MAX_SESSIONS`）。 */
  maxSessions?: number;
  /** 每个会话返回的摘录条数上限（缺省 `DEFAULT_SEARCH_MAX_SNIPPETS`）。 */
  maxSnippetsPerSession?: number;
  /** 已切好的关键词（给了就不再看 query）。 */
  keywords?: readonly string[];
  /** sidecar 标题来源（可选）。缺席的会话 ⇒ 结果里没有 title 字段（= 标题未知）。 */
  metadataById?: ReadonlyMap<string, SessionMetadataRecord>;
}

/** 检索：按可见语料做关键词 OR 匹配，**按会话聚合**，受字节预算约束。 */
export async function searchSessions(opts: SessionSearchOptions): Promise<SessionSearchResult> {
  const keywords = (opts.keywords ?? keywordsOf(opts.query)).map((k) => k.trim()).filter((k) => k !== "");
  if (keywords.length === 0) {
    // 空查询 = 没有可匹配的词。**这不是「没有匹配」**（那是扫完才知道的），是没量。
    return { kind: "unavailable", reason: "empty-query", detail: "查询里没有任何关键词" };
  }
  const budgetBytes = clampBudget(opts.budgetBytes);
  const maxSessions = clampCount(opts.maxSessions, DEFAULT_SEARCH_MAX_SESSIONS);
  const maxSnippets = clampCount(opts.maxSnippetsPerSession, DEFAULT_SEARCH_MAX_SNIPPETS);

  // ① 根目录：读不到 = 没量到（不是「零会话」）。
  let rootStat;
  try {
    rootStat = await stat(opts.root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      kind: "unavailable",
      reason: code === "ENOENT" ? "root-missing" : "root-unreadable",
      detail: errorText(error),
    };
  }
  if (!rootStat.isDirectory()) {
    return { kind: "unavailable", reason: "root-not-a-directory", detail: opts.root };
  }
  let names: string[];
  try {
    names = await readdir(opts.root);
  } catch (error) {
    return { kind: "unavailable", reason: "root-unreadable", detail: errorText(error) };
  }

  // ② 候选会话文件（按 mtime 降序：近的先扫，预算有限时先救近的）。
  const candidates: { id: string; path: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    const path = join(opts.root, name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(path)).mtimeMs;
    } catch {
      mtimeMs = 0; // 读不到元信息：仍然扫（读文件时再判一次）
    }
    candidates.push({ id, path, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));

  const workspace = workspaceOfSearchRoot(opts.root);
  let totalSessions = candidates.length;
  let scannedSessions = 0;
  let scannedBytes = 0;
  let sidecarFiles = 0;
  let unreadableSessions = 0;
  let badLines = 0;
  let budgetExhaustedAt: "sessions" | "bytes" | "none" = "none";
  const truncatedSessions: string[] = [];
  const matches: SessionSearchMatch[] = [];

  for (const candidate of candidates) {
    if (scannedSessions >= maxSessions) {
      budgetExhaustedAt = "sessions";
      break;
    }
    if (scannedBytes >= budgetBytes) {
      budgetExhaustedAt = "bytes";
      break;
    }
    const sessionRef: SessionRef = { workspace, sessionId: candidate.id };
    const outcome = await hasForkHead(candidate.path)
      ? await scanSessionView(opts.root, sessionRef, budgetBytes - scannedBytes)
      : await scanSessionFile(candidate.path, budgetBytes - scannedBytes, sessionRef);
    if (outcome.kind === "error") {
      unreadableSessions += 1;
      continue;
    }
    scannedBytes += outcome.bytes;
    if (outcome.sidecar) {
      // UI sidecar（pins/feedback）不是会话：读了首行就认出，不当会话计。
      sidecarFiles += 1;
      totalSessions -= 1;
      continue;
    }
    scannedSessions += 1;
    badLines += outcome.badLines;
    if (!outcome.complete) {
      // 被字节帽切断：这个会话的命中数只是下界。
      truncatedSessions.push(candidate.id);
    }
    const hit = aggregateMatch(sessionRef, outcome, keywords, maxSnippets, opts.metadataById);
    if (hit !== null) matches.push(hit);
    if (!outcome.complete) {
      // 预算在这一份上用完了：后面的一律没扫。
      budgetExhaustedAt = "bytes";
      break;
    }
  }

  const incomplete =
    budgetExhaustedAt !== "none" || unreadableSessions > 0 || badLines > 0 || truncatedSessions.length > 0;
  if (!incomplete) {
    return { kind: "ok", matches, scannedSessions, scannedBytes, totalSessions };
  }
  return {
    kind: "partial",
    matches,
    scannedSessions,
    scannedBytes,
    totalSessions,
    budgetBytes,
    budgetExhaustedAt,
    unreadableSessions,
    badLines,
    truncatedSessions,
  };
}

// ---- 扫描一个会话文件（有界：分块读、到预算就停）----
interface FileScanOk {
  kind: "ok";
  messages: VisibleMessage[];
  bytes: number;
  /** 整份读完？false = 被字节帽切断。 */
  complete: boolean;
  /** 坏行数。 */
  badLines: number;
  /** 这是 UI sidecar（不是会话）。 */
  sidecar: boolean;
}
type FileScan = FileScanOk | { kind: "error"; error: string };

async function scanSessionFile(path: string, maxBytes: number, ref: SessionRef): Promise<FileScan> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch (error) {
    return { kind: "error", error: errorText(error) };
  }
  try {
    const decoder = new TextDecoder("utf-8");
    const corpus = new VisibleCorpus();
    let pending = "";
    let position = 0;
    let bytes = 0;
    let badLines = 0;
    let contentLines = 0;
    let lineNo = 0;
    let truncated = false;
    for (;;) {
      const remaining = maxBytes - bytes;
      if (remaining <= 0) {
        truncated = true; // 预算用尽（宁可说「可能还有」，也不假装读完）
        break;
      }
      const want = Math.min(READ_CHUNK_BYTES, remaining);
      const buf = Buffer.allocUnsafe(want);
      const { bytesRead } = await fh.read(buf, 0, want, position);
      if (bytesRead === 0) break; // EOF
      position += bytesRead;
      bytes += bytesRead;
      pending += decoder.decode(buf.subarray(0, bytesRead), { stream: true });
      let nl = pending.indexOf("\n");
      while (nl >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        lineNo += 1;
        const verdict = consumeLine(line, contentLines, corpus, { workspace: ref.workspace, sessionId: ref.sessionId, eventId: lineNo });
        if (verdict === "sidecar") {
          return { kind: "ok", messages: [], bytes, complete: false, badLines, sidecar: true };
        }
        if (verdict === "bad") badLines += 1;
        if (verdict !== "empty") contentLines += 1;
        nl = pending.indexOf("\n");
      }
      if (bytesRead < want) break; // 短读 = 读到文件尾
    }
    if (!truncated) {
      // 尾段（文件最后一行没有换行）：它是完整的一行，要算。
      const tail = pending + decoder.decode();
      lineNo += 1;
      const verdict = consumeLine(tail, contentLines, corpus, { workspace: ref.workspace, sessionId: ref.sessionId, eventId: lineNo });
      if (verdict === "bad") badLines += 1;
    }
    return { kind: "ok", messages: corpus.finish(), bytes, complete: !truncated, badLines, sidecar: false };
  } catch (error) {
    return { kind: "error", error: errorText(error) };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** 吃掉一行：判它是不是可见语料、是不是坏行、是不是 UI sidecar。 */
function consumeLine(
  rawLine: string,
  contentLinesBefore: number,
  corpus: VisibleCorpus,
  ref: EventRef,
): "empty" | "ok" | "bad" | "sidecar" {
  const line = rawLine.trim();
  if (line === "") return "empty";
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return "bad"; // 坏行：读不出来 ⇒ 那一行的内容没量到（计数上报，不当命中）
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "bad";
  const record = parsed as Record<string, unknown>;
  if (typeof record["type"] !== "string") {
    // 没有事件类型 ⇒ 不是事件行。UI sidecar（pins/feedback）就长这样：
    // 首行是这种形状 ⇒ 整个文件不是会话（与会话同扩展名，靠**首行形状**区分，不靠文件名）。
    if (contentLinesBefore === 0 && isUiSidecarRecord(record)) return "sidecar";
    return "bad";
  }
  corpus.push(parsed as AgentEvent, ref);
  return "ok";
}

/** UI sidecar 形状（与 `src/main/sessions.ts` 的同名判定同式：首行无 type、有 sessionId + eventId）。 */
function isUiSidecarRecord(record: Record<string, unknown>): boolean {
  return (
    typeof record["type"] !== "string" &&
    typeof record["sessionId"] === "string" &&
    typeof record["eventId"] === "number"
  );
}

/** 一个会话的聚合（命中消息计数 + 有界的摘录）。没有命中 ⇒ null。 */
function aggregateMatch(
  session: SessionRef,
  scan: FileScanOk,
  keywords: readonly string[],
  maxSnippets: number,
  metadataById: ReadonlyMap<string, SessionMetadataRecord> | undefined,
): SessionSearchMatch | null {
  const sessionId = session.sessionId;
  let matchCount = 0;
  const snippets: SessionSearchSnippet[] = [];
  scan.messages.forEach((message, index) => {
    const hits = matchKeywords(message.text, keywords);
    if (hits.length === 0) return;
    matchCount += 1;
    if (snippets.length >= maxSnippets) return;
    const keyword = hits[0]!;
    snippets.push({
      kind: message.kind, keyword, excerpt: snippetOf(message.text, keyword), index,
      ...(message.ref !== undefined ? { ref: message.ref } : {}),
    });
  });
  if (matchCount === 0) return null;
  const record = metadataById?.get(sessionId);
  return {
    sessionId,
    session,
    ...(record !== undefined ? { title: record.title } : {}),
    matchCount,
    snippets,
    bytes: scan.bytes,
    complete: scan.complete,
    badLines: scan.badLines,
  };
}

/** 会话根 → 工作区（`<ws>/.agent/sessions`）；非标准布局退回根本身。 */
function workspaceOfSearchRoot(root: string): string {
  return basename(root) === "sessions" && basename(dirname(root)) === ".agent" ? dirname(dirname(root)) : root;
}

/** 首行是不是指针分叉的 session_meta（只读首块，不整份读）。 */
async function hasForkHead(path: string): Promise<boolean> {
  const fh = await open(path, "r").catch(() => null);
  if (fh === null) return false;
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const first = buf.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
    try {
      const value = JSON.parse(first) as { type?: unknown; fork?: unknown };
      return value.type === "session_meta" && value.fork !== undefined;
    } catch { return false; }
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** 分叉会话：按来源视图取料（父前缀 + 本地有效历史），预算按整条链的 raw 字节记。 */
async function scanSessionView(root: string, session: SessionRef, maxBytes: number): Promise<FileScan | FileScanOk> {
  let chain;
  try {
    chain = await resolveSessionChain(join(root, session.sessionId + ".jsonl"), undefined, root);
  } catch (error) {
    return { kind: "error", error: errorText(error) };
  }
  let bytes = 0;
  for (const file of chain) bytes += (await stat(file.path).catch(() => ({ size: 0 }))).size;
  if (bytes > maxBytes) {
    // 预算不足以读完这条父链：这个会话只是**没量完**，不是零命中。
    return { kind: "ok", messages: [], bytes: Math.max(0, maxBytes), complete: false, badLines: 0, sidecar: false };
  }
  try {
    const view = await readSessionView(session, root);
    const corpus = new VisibleCorpus();
    for (const entry of view.entries) corpus.push(entry.event, entry.ref);
    return { kind: "ok", messages: corpus.finish(), bytes, complete: true, badLines: 0, sidecar: false };
  } catch (error) {
    return { kind: "error", error: errorText(error) };
  }
}

// ---- 小工具 ----
function clampBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SEARCH_BUDGET_BYTES;
  return Math.max(1, Math.floor(value));
}

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
