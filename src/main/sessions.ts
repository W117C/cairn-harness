// 会话列表存储（§10.1 三区 shell 左栏）：会话目录扫描，JSONL 即会话——
// sessionsRoot() 下每个 *.jsonl 文件 = 一个会话，文件名 = 会话名。
// 新建/切换/重命名/删除；删除当前会话回退到最近一个（mtime 降序）。
// electron-free（root 由调用方传入：app 用 userData，验收脚本用临时目录），可 headless 单测。
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../events";
import { createEventLog, replay } from "../events";

export interface SessionInfo {
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
  origin?: "scheduled";
  automationId?: string;
  automationName?: string;
  parentSessionId?: string | null;
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
          origin: "scheduled" as const,
          ...(typeof meta.automation_id === "string" ? { automationId: meta.automation_id } : {}),
          ...(typeof meta.automation_name === "string" ? { automationName: meta.automation_name } : {}),
        }
      : {}),
  };
}

// ---- 行数增量计数 ----
// 旧实现为拿一个行数把每个会话整份 readFile + split + filter（还要再开一次读首行）
// ⇒ 列表 = O(盘上总字节)，且每次刷新反复付。JSONL 是 append-only 的（events/index.ts 的 A5 段
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

/** 扫描会话目录：mtime 降序（最近在上），行数 = 非空行数。 */
export async function listSessions(root: string): Promise<SessionInfo[]> {
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
      out.push({
        id,
        mtimeMs: st.mtimeMs,
        lines,
        ...(meta?.origin === "scheduled"
          ? {
              origin: "scheduled" as const,
              ...(meta.automationId ? { automationId: meta.automationId } : {}),
              ...(meta.automationName ? { automationName: meta.automationName } : {}),
            }
          : {}),
      });
    } catch {
      // 竞态删除/不可读：跳过，不出现在列表
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** 新建会话：名字缺省 = 时间戳；撞名自动加序号。返回会话名。 */
export async function createSession(root: string, name?: string): Promise<string> {
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
  await writeFile(join(root, id + ".jsonl"), "", "utf8"); // 空文件：JSONL 即会话，0 行 = 空投影
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

/** 重命名：文件重命名（内容逐字不变，重放无损）。 */
export async function renameSession(root: string, oldId: string, newName: string): Promise<string> {
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
  return newName;
}

/** 删除会话文件（任务 4 验收要求；只删 sessions root 内的单个 .jsonl，路径已校验）。 */
export async function deleteSession(root: string, id: string): Promise<void> {
  await rm(sessionPath(root, id), { force: false });
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
