// 会话列表存储（§10.1 三区 shell 左栏）：会话目录扫描，JSONL 即会话——
// sessionsRoot() 下每个 *.jsonl 文件 = 一个会话，文件名 = 会话名。
// 新建/切换/重命名/删除；删除当前会话回退到最近一个（mtime 降序）。
// electron-free（root 由调用方传入：app 用 userData，验收脚本用临时目录），可 headless 单测。
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../events";
import { createEventLog, replay } from "../events";

export interface SessionInfo {
  /** 会话名 = 文件名（去 .jsonl 后缀）。 */
  id: string;
  mtimeMs: number;
  /** JSONL 行数（投影事件数 = 行数，验收口径）。 */
  lines: number;
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
      const raw = await readFile(p, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0).length;
      out.push({ id, mtimeMs: st.mtimeMs, lines });
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
      const events = await replay(p);
      const meta = events.find((e) => e.type === "session_meta");
      const parent = meta && meta.type === "session_meta" ? (meta.parent_session_id ?? null) : null;
      if (parentId !== undefined && parent !== parentId) continue;
      out.push({ id: name, parentId: parent, mtimeMs: st.mtimeMs, lines: events.length });
    } catch {
      // 竞态/坏文件：跳过
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** sidechat 事件（重放）。 */
export function readSidechatEvents(root: string, id: string): Promise<AgentEvent[]> {
  return replay(sidechatEventsPath(root, id));
}
