// 会话列表存储（§10.1 三区 shell 左栏）：会话目录扫描，JSONL 即会话——
// sessionsRoot() 下每个 *.jsonl 文件 = 一个会话，文件名 = 会话名。
// 新建/切换/重命名/删除；删除当前会话回退到最近一个（mtime 降序）。
// electron-free（root 由调用方传入：app 用 userData，验收脚本用临时目录），可 headless 单测。
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../events";
import { createEventLog, replay } from "../events";
import { tmpPathFor, writeFileAtomic } from "../atomic-write";
import { parseRunAttachment, type RunAttachmentReference } from "./run-attachments";
import type { SessionMetadataRecord, SessionMetadataRepository } from "./session-metadata";

/** 文件事实始终来自 JSONL；sidecar 字段只在确有 metadata 时合并，老会话不会被伪造成默认记录。 */
export interface SessionInfo extends Partial<SessionMetadataRecord> {
  /** 会话名 = 文件名（去 .jsonl 后缀）。 */
  id: string;
  mtimeMs: number;
  /** JSONL 行数（投影事件数 = 行数，验收口径）。 */
  lines: number;
  /** M4a：定时会话徽标投影（首行 session_meta.origin="scheduled"，§12.2.6）。缺省 = 交互会话。 */
  origin?: "scheduled";
  automationId?: string;
  automationName?: string;
}

/** 首行 session_meta 的投影面（列表要的两件事都在第一行，无需碰文件体）。 */
interface HeadMeta {
  parentSessionId?: string | null;
  /** 定时徽标：判定与成形**只在一处**（SessionInfo 的 origin/automation* 由它整体摊平）。
   *  原先 listSessions 里还抄着第二份「origin === "scheduled" ⇒ 同三个字段」，两处任一改动就分叉，
   *  而判据看不出第一份被动过——那份副本的存在正是变异锚点当场抓出来的。 */
  badge?: { origin: "scheduled"; automationId?: string; automationName?: string };
}

/** 首行读取的探针与上限：1KB 一次读不到换行就续读，最多 64KB（超限视作无 meta）。 */
const HEAD_PROBE_BYTES = 1024;
const HEAD_MAX_BYTES = 64 * 1024;

/** 只读首行（旧实现固定 1024 字节：首行超过它就 JSON.parse 失败 ⇒ 徽标/父归属静默丢失）。
 *  逐段找 0x0A：换行字节不可能出现在 UTF-8 多字节序列内部，按字节找是安全的，
 *  拼齐一段再解码也就不存在截断半个字符的问题。读不到/坏首行 = null。 */
async function readHeadMeta(p: string): Promise<HeadMeta | null> {
  let fh;
  try {
    fh = await open(p, "r");
  } catch {
    return null;
  }
  try {
    const chunks: Buffer[] = [];
    let got = 0;
    let scanned = 0; // 已找过换行的字节数（避免每段重扫全串）
    while (got < HEAD_MAX_BYTES) {
      const buf = Buffer.alloc(Math.min(HEAD_PROBE_BYTES, HEAD_MAX_BYTES - got));
      const { bytesRead } = await fh.read(buf, 0, buf.length, got);
      if (bytesRead === 0) break;
      chunks.push(buf.subarray(0, bytesRead));
      got += bytesRead;
      const joined = Buffer.concat(chunks, got);
      const nl = joined.indexOf(0x0a, scanned);
      if (nl >= 0) {
        const firstLine = joined.subarray(0, nl).toString("utf8");
        return projectHeadLine(firstLine);
      }
      scanned = joined.length;
    }
    if (got === 0) return null;
    return projectHeadLine(Buffer.concat(chunks, got).toString("utf8")); // 无换行的整份就一行
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => undefined);
  }
}

function projectHeadLine(firstLine: string): HeadMeta | null {
  let meta: {
    type?: string; origin?: string;
    automation_id?: string; automation_name?: string; parent_session_id?: string;
  };
  try {
    meta = JSON.parse(firstLine) as typeof meta;
  } catch {
    return null; // 半写/坏首行
  }
  if (!meta || meta.type !== "session_meta") return null;
  return {
    parentSessionId: typeof meta.parent_session_id === "string" ? meta.parent_session_id : null,
    ...(meta.origin === "scheduled"
      ? {
          badge: {
            origin: "scheduled" as const,
            ...(typeof meta.automation_id === "string" ? { automationId: meta.automation_id } : {}),
            ...(typeof meta.automation_name === "string" ? { automationName: meta.automation_name } : {}),
          },
        }
      : {}),
  };
}

// ---- 行数增量计数 ----
// 旧实现为拿一个行数把每个会话整份 readFile + split + filter（还要再开一次读首行）
// ⇒ 列表 = O(盘上总字节)，且每次刷新反复付。JSONL 是 append-only 的（events/log.ts 的 A5 段
// 用同一条前提做增量重放缓存），所以按 (ino, size) 记住上次数到哪、只读追加段即可。
// 口径与旧写法逐字一致：非空（trim 后）的换行分隔段计数，**含未换行的尾段**（崩溃半写行）。
interface LineCountEntry {
  ino: number;
  size: number; // 已计入 closed/tail 的字节水位（尾段过长时会退回上一个换行处）
  closed: number; // 已收尾的非空段数
  tail: string; // 未收尾的尾段（"" = 文件正好以换行结尾）
}
const lineCounts = new Map<string, LineCountEntry>();
const LINE_COUNT_MAX = 64; // 与 replayCache 同族：有界，满了按插入序淘汰
const TAIL_KEEP_MAX = 4096; // 尾段超过这个长度就不缓存它（下次从上个换行重读，宁多扫一次）

function countNonEmpty(segments: string[]): number {
  let n = 0;
  for (const s of segments) if (s.trim().length > 0) n++;
  return n;
}

/** 拆「已收尾段 + 尾段」，并按尾段是否可缓存决定新的字节水位。 */
function foldSegments(prevClosed: number, text: string, endSize: number, ino: number): { entry: LineCountEntry; lines: number } {
  const parts = text.split("\n");
  const tail = parts.pop() ?? "";
  const closed = prevClosed + countNonEmpty(parts);
  const lines = closed + (tail.trim().length > 0 ? 1 : 0); // 未收尾尾段照样如实计 1（与旧口径同）
  if (tail.length > TAIL_KEEP_MAX) {
    // 尾段留不住：水位退回上一个换行，下次从那里重读再判一次（宁多扫一次，不守一个可能巨大的旧尾段）
    return { entry: { ino, size: endSize - Buffer.byteLength(tail, "utf8"), closed, tail: "" }, lines };
  }
  return { entry: { ino, size: endSize, closed, tail }, lines };
}

function rememberLineCount(p: string, entry: LineCountEntry): void {
  if (lineCounts.size >= LINE_COUNT_MAX && !lineCounts.has(p)) {
    const oldest = lineCounts.keys().next().value;
    if (oldest !== undefined) lineCounts.delete(oldest);
  }
  lineCounts.set(p, entry);
}

/** 一个会话文件的行数：未变则复用，长大只读追加段，首次/换 inode/被截断才整份扫。 */
async function countSessionLines(p: string, st: { ino: number; size: number }): Promise<number> {
  const cached = lineCounts.get(p);
  if (cached && cached.ino === st.ino && cached.size === st.size) {
    return cached.closed + (cached.tail.trim().length > 0 ? 1 : 0);
  }
  if (cached && cached.ino === st.ino && cached.size < st.size) {
    const fh = await open(p, "r");
    try {
      const len = st.size - cached.size;
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(buf, 0, len, cached.size);
      const { entry, lines } = foldSegments(cached.closed, cached.tail + buf.subarray(0, bytesRead).toString("utf8"), cached.size + bytesRead, st.ino);
      rememberLineCount(p, entry);
      return lines;
    } finally {
      await fh.close().catch(() => undefined);
    }
  }
  const raw = await readFile(p, "utf8"); // 首访/重建/截断：整份扫一次（此后只走上面两支）
  const { entry, lines } = foldSegments(0, raw, st.size, st.ino);
  rememberLineCount(p, entry);
  return lines;
}

/** 会话名合法性：可打印、无路径分隔符、不为点、长度 1–80（renderer IPC 是信任边界，fail-closed）。 */
export function isValidSessionName(name: string): boolean {
  return typeof name === "string" && /^[^/\\\u0000-\u001f.]{1,80}$/.test(name) && name.trim() === name && name.length > 0;
}

function sessionPath(root: string, id: string): string {
  if (!isValidSessionName(id)) throw new Error(`非法会话名: ${JSON.stringify(id)}`);
  return join(root, id + ".jsonl");
}

/** 发送队列 sidecar：未执行的用户消息不是 agent 业务事件，不写进 JSONL；独立原子 JSON
 *  随会话文件同生命周期（rename/delete 跟随），重启后由 main 读回、显式恢复发送。 */
export interface SessionQueueEntry {
  text: string;
  attachments: RunAttachmentReference[];
}

interface SessionQueueState {
  version: 1;
  items: SessionQueueEntry[];
}

const SESSION_QUEUE_VERSION = 1 as const;
const SESSION_QUEUE_MAX_ITEMS = 100;
const SESSION_QUEUE_MAX_TEXT = 100_000;
const SESSION_QUEUE_MAX_TOTAL_TEXT = 1_000_000;
const SESSION_QUEUE_MAX_ATTACHMENTS = 32;

export class SessionQueueCorruptError extends Error {
  constructor(filePath: string, reason: string) {
    super(`发送队列损坏，已拒绝覆盖: ${filePath} (${reason})`);
    this.name = "SessionQueueCorruptError";
  }
}

function queuePath(root: string, id: string): string {
  return sessionPath(root, id).replace(/\.jsonl$/, ".queue.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSessionQueueEntry(raw: unknown, index: number): SessionQueueEntry {
  if (!isRecord(raw)) throw new Error(`发送队列第 ${String(index + 1)} 条不是对象`);
  const unknown = Object.keys(raw).filter((key) => key !== "text" && key !== "attachments");
  if (unknown.length > 0) throw new Error(`发送队列第 ${String(index + 1)} 条未知字段: ${unknown.join(", ")}`);
  if (typeof raw.text !== "string" || raw.text.trim() === "" || raw.text.length > SESSION_QUEUE_MAX_TEXT) {
    throw new Error(`发送队列第 ${String(index + 1)} 条 text 非法（非空且 ≤${String(SESSION_QUEUE_MAX_TEXT)} 字符）`);
  }
  if (!Array.isArray(raw.attachments) || raw.attachments.length > SESSION_QUEUE_MAX_ATTACHMENTS) {
    throw new Error(`发送队列第 ${String(index + 1)} 条 attachments 非法（数组且 ≤${String(SESSION_QUEUE_MAX_ATTACHMENTS)} 条）`);
  }
  const attachments: RunAttachmentReference[] = [];
  for (const rawAttachment of raw.attachments) {
    const parsed = parseRunAttachment(rawAttachment);
    if (!parsed.ok) throw new Error(`发送队列第 ${String(index + 1)} 条 attachments: ${parsed.error}`);
    attachments.push(parsed.value);
  }
  return { text: raw.text, attachments };
}

function validateSessionQueueItems(raw: unknown): SessionQueueEntry[] {
  if (!Array.isArray(raw) || raw.length > SESSION_QUEUE_MAX_ITEMS) {
    throw new Error(`发送队列条目非法（数组且 ≤${String(SESSION_QUEUE_MAX_ITEMS)} 条）`);
  }
  const items = raw.map((entry, index) => validateSessionQueueEntry(entry, index));
  const total = items.reduce((n, item) => n + item.text.length, 0);
  if (total > SESSION_QUEUE_MAX_TOTAL_TEXT) {
    throw new Error(`发送队列总文本过长（≤${String(SESSION_QUEUE_MAX_TOTAL_TEXT)} 字符）`);
  }
  return items;
}

function validateSessionQueueState(raw: unknown): SessionQueueState {
  if (!isRecord(raw) || raw.version !== SESSION_QUEUE_VERSION || !Object.prototype.hasOwnProperty.call(raw, "items")) {
    throw new Error("根对象/version/items 结构非法");
  }
  return { version: SESSION_QUEUE_VERSION, items: validateSessionQueueItems(raw.items) };
}

/** 读发送队列；缺文件 = 空队列。损坏或非法结构 fail-visible，绝不静默清空。 */
export async function readSessionQueue(root: string, id: string): Promise<SessionQueueEntry[]> {
  const p = queuePath(root, id);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new SessionQueueCorruptError(p, error instanceof Error ? error.message : String(error));
  }
  try {
    return validateSessionQueueState(raw).items;
  } catch (error) {
    throw new SessionQueueCorruptError(p, error instanceof Error ? error.message : String(error));
  }
}

/** 原子写发送队列；空数组删文件，避免空 sidecar 长期留在目录里。 */
export async function writeSessionQueue(root: string, id: string, entries: readonly SessionQueueEntry[]): Promise<void> {
  const items = validateSessionQueueItems(entries);
  const p = queuePath(root, id);
  if (items.length === 0) {
    await rm(p, { force: true });
    return;
  }
  const state: SessionQueueState = { version: SESSION_QUEUE_VERSION, items };
  await writeFileAtomic(p, JSON.stringify(state, null, 2) + "\n");
}

/** 重命名会话时同步迁移队列 sidecar；源不存在 = false（幂等），目标冲突显式拒绝。 */
async function moveSessionQueue(root: string, fromId: string, toId: string): Promise<boolean> {
  const from = queuePath(root, fromId);
  const to = queuePath(root, toId);
  const sourceExists = await stat(from).then(() => true, (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  });
  if (!sourceExists) return false;
  const targetExists = await stat(to).then(() => true, (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  });
  if (targetExists) throw new Error(`目标会话队列已存在: ${toId}`);
  await rename(from, to);
  return true;
}

/** 扫描会话目录：mtime 降序（最近在上），行数 = 非空行数。
 *  metadataById 只做已存在 sidecar 的合并；缺失键不会补造 pinned/archived/projectId/时间。 */
export async function listSessions(
  root: string,
  metadataById?: ReadonlyMap<string, SessionMetadataRecord>,
): Promise<SessionInfo[]> {
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return []; // 目录不存在 = 零会话
  }
  const out: SessionInfo[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    const p = join(root, name);
    try {
      const st = await stat(p);
      if (!st.isFile()) continue;
      const lines = await countSessionLines(p, st); // 未变即复用计数，不再整份读文件体
      const meta = await readHeadMeta(p); // 只读首行（旧实现在此之上还要整份 readFile 数行）
      const organization = metadataById?.get(id);
      out.push({
        id,
        mtimeMs: st.mtimeMs,
        lines,
        ...(meta?.badge ?? {}), // 徽标整体摊平：判定与字段成形都在 projectHeadLine，这里不再重判一遍
        ...(organization
          ? {
              title: organization.title,
              pinned: organization.pinned,
              archived: organization.archived,
              ...(organization.projectId !== undefined ? { projectId: organization.projectId } : {}),
              createdAt: organization.createdAt,
              updatedAt: organization.updatedAt,
            }
          : {}),
      });
    } catch {
      // 竞态删除/不可读：跳过，不出现在列表
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** 新建会话：名字缺省 = 时间戳；撞名自动加序号。可选 sidecar 写入失败时回滚空 JSONL。 */
export async function createSession(
  root: string,
  name?: string,
  metadata?: Pick<SessionMetadataRepository, "create">,
): Promise<string> {
  const base = name?.trim() || `会话 ${new Date().toLocaleString("sv-SE").replace(/[T]/g, " ").slice(0, 16)}`;
  if (!isValidSessionName(base)) throw new Error(`非法会话名: ${JSON.stringify(name)}`);
  let id = base;
  for (let i = 2; ; i++) {
    try {
      await stat(join(root, id + ".jsonl"));
      id = `${base} (${String(i)})`;
    } catch {
      break;
    }
  }
  await mkdir(root, { recursive: true });
  const file = join(root, id + ".jsonl");
  await writeFile(file, "", "utf8"); // 空文件：JSONL 即会话，0 行 = 空投影
  // 新会话不许继承上一个同名会话的待发队列：JSONL 被外部删掉（CLI/手工/崩溃半写）而
  // sidecar 留在盘上时，同名字会被 createSession 复用 ⇒ 别人的待发消息会变成新会话的第一句。
  // 队列属于那条已被删掉的会话，不随名字传承——这里显式清掉，不留孤儿也不让它易主。
  await rm(queuePath(root, id), { force: true }).catch(() => undefined);
  if (metadata) {
    try {
      await metadata.create(id, id);
    } catch (error) {
      await rm(file, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  return id;
}

/** 读取会话事件（重放投影）。 */
export function readSessionEvents(root: string, id: string): Promise<AgentEvent[]> {
  return replay(sessionPath(root, id));
}

/** 会话文件路径（runAgent 会话模式的 logPath）。 */
export function pathOf(root: string, id: string): string {
  return sessionPath(root, id);
}

/** 重命名：文件重命名（内容逐字不变，重放无损）；sidecar 跟随迁移，失败则回滚文件名。 */
export async function renameSession(
  root: string,
  oldId: string,
  newName: string,
  metadata?: Pick<SessionMetadataRepository, "rename">,
): Promise<string> {
  if (!isValidSessionName(newName)) throw new Error(`非法会话名: ${JSON.stringify(newName)}`);
  const from = sessionPath(root, oldId);
  const to = sessionPath(root, newName);
  await stat(from); // 不存在 → 抛错（fail loud）
  try {
    await stat(to);
    throw new Error(`目标会话名已存在: ${newName}`);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("目标会话名已存在")) {
      // 目标不存在 = 期望路径；其余错误（含 stat ENOENT）继续
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    } else {
      throw err;
    }
  }
  await rename(from, to);
  let queueMoved = false;
  try {
    queueMoved = await moveSessionQueue(root, oldId, newName);
    if (metadata) await metadata.rename(oldId, newName, newName);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (queueMoved) {
      try {
        await moveSessionQueue(root, newName, oldId);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await rename(to, from);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `重命名会话失败且回滚不完整: ${oldId}`);
    }
    throw error;
  }
  return newName;
}

/** 硬删除：只触及 sessions root 内已校验的单个 JSONL；metadata 一并清理，任一步失败都回滚暂存文件。 */
export async function deleteSession(
  root: string,
  id: string,
  metadata?: Pick<SessionMetadataRepository, "find" | "remove" | "restore">,
): Promise<void> {
  const source = sessionPath(root, id);
  const staged = tmpPathFor(source);
  const queueSource = queuePath(root, id);
  const queueStaged = tmpPathFor(queueSource);
  await rename(source, staged); // 先原子移出列表；清理失败可原名恢复
  let queueStagedExists = false;
  try {
    try {
      await rename(queueSource, queueStaged);
      queueStagedExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } catch (error) {
    await rename(staged, source).catch(() => undefined);
    throw error;
  }
  let record: SessionMetadataRecord | undefined;
  try {
    record = metadata ? await metadata.find(id) : undefined;
    if (record && metadata) await metadata.remove(id);
    await rm(staged, { force: false });
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (record && metadata) {
      try {
        await metadata.restore(record);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await rename(staged, source);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (queueStagedExists) {
      try {
        await rename(queueStaged, queueSource);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `删除会话失败且回滚不完整: ${id}`);
    }
    throw error;
  }
  // JSONL 已确认删除后，队列暂存文件是纯清理面；失败不把已完成的删除反签成失败。
  if (queueStagedExists) await rm(queueStaged, { force: true }).catch(() => undefined);
}

/** 空会话文件存在性检查。 */
export async function sessionExists(root: string, id: string): Promise<boolean> {
  try {
    await stat(sessionPath(root, id));
    return true;
  } catch {
    return false;
  }
}

// ---- M2f：sidechat 会话（独立 JSONL 文件组）----
// 主会话仍是 sessionsRoot/<id>.jsonl；sidechat 落在 sessionsRoot/sidechats/<id>/events.jsonl
// —— 每个 sidechat 一个目录（文件组），主会话列表扫描只看 *.jsonl 故不受污染。
// 首行 session_meta{kind:"sidechat", parent_session_id} 即会话类型标记。

export const SIDECHAT_DIR = "sidechats";

export function sidechatRoot(root: string): string {
  return join(root, SIDECHAT_DIR);
}

export function sidechatDir(root: string, id: string): string {
  if (!isValidSessionName(id)) throw new Error(`非法 sidechat 名: ${JSON.stringify(id)}`);
  return join(sidechatRoot(root), id);
}

/** sidechat 的事件文件（独立 JSONL）。 */
export function sidechatEventsPath(root: string, id: string): string {
  return join(sidechatDir(root, id), "events.jsonl");
}

/** 新建 sidechat 会话：建目录 + 空 events.jsonl + 首行 session_meta（kind/parent）。 */
export async function createSidechatSession(root: string, parentSessionId: string, name?: string): Promise<string> {
  const base = name?.trim() || `sidechat ${new Date().toLocaleString("sv-SE").replace(/[T]/g, " ").slice(0, 16)}`;
  if (!isValidSessionName(base)) throw new Error(`非法 sidechat 名: ${JSON.stringify(name)}`);
  let id = base;
  for (let i = 2; ; i++) {
    try {
      await stat(sidechatDir(root, id));
      id = `${base} (${String(i)})`;
    } catch {
      break;
    }
  }
  await mkdir(sidechatDir(root, id), { recursive: true });
  await writeFile(sidechatEventsPath(root, id), "", "utf8");
  await createEventLog(sidechatEventsPath(root, id)).append({
    type: "session_meta",
    kind: "sidechat",
    parent_session_id: parentSessionId,
  });
  return id;
}

export interface SidechatInfo {
  id: string;
  parentId: string | null;
  mtimeMs: number;
  /** 非空 JSONL 行数（与 SessionInfo.lines 同口径。旧实现报的是「解析成功的事件数」，
   *  两者只在文件含空行/坏行时分叉）。 */
  lines: number;
}

/** 扫描 sidechat 会话（可按父会话过滤）；mtime 降序。 */
export async function listSidechatSessions(root: string, parentId?: string): Promise<SidechatInfo[]> {
  let names: string[] = [];
  try {
    names = await readdir(sidechatRoot(root));
  } catch {
    return [];
  }
  const out: SidechatInfo[] = [];
  for (const name of names) {
    try {
      const st = await stat(join(sidechatRoot(root), name));
      if (!st.isDirectory()) continue;
      const p = sidechatEventsPath(root, name);
      // 父归属就在首行 session_meta ⇒ 只读头即可过滤。旧实现为了同一件事把**每个** sidechat 全量
      // 重放解析，再丢掉不匹配的那些——过滤条件越窄，白读的越多。
      const parent = (await readHeadMeta(p))?.parentSessionId ?? null;
      if (parentId !== undefined && parent !== parentId) continue;
      const lines = await countSessionLines(p, await stat(p));
      out.push({ id: name, parentId: parent, mtimeMs: st.mtimeMs, lines });
    } catch {
      // 竞态/不可读：跳过，不出现在列表
      // ⚠️ 一处口径变化（随之而来的取舍）：旧实现在这里 catch 的是 replay 的「中段坏行」抛错，
      //  ⇒ 那种 sidechat 从列表里**静默消失**；现在它照样列出（行数是真的），打开时仍由
      // readSidechatEvents 显式失败。列表可见但打不开，比凭空少一条更容易被发现了去查。
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** sidechat 事件（重放）。 */
export function readSidechatEvents(root: string, id: string): Promise<AgentEvent[]> {
  return replay(sidechatEventsPath(root, id));
}
