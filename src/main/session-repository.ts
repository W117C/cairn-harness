// 会话归属与「按会话根串行」的统一入口（指针接入 Task 3）。
//
// 两件事在这里收敛：
//   ① **精确寻址**：两个已登记工作区可能各有一个同名会话；只给 id 时必须唯一才认，歧义就报错
//      （绝不「扫到第一个就继续」——那是把别的项目的日志当真）。
//   ② **根级临界区**：依赖检查与破坏性 mutation（改名/删除/创建指针）必须在同一个锁里完成，
//      否则「检查时没有子会话、检查完又被建了一个」会把父日志改成断链。进程内用 promise 链串行，
//      跨进程（CLI + desktop）用会话根里的 `.session-mutation.lock`（O_EXCL）。锁被活人占着或
//      崩溃遗留时**显式报错并给出锁路径**，不凭超时自动删锁。
import { open, readFile, realpath, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { SessionRef } from "../events";
import { isSessionInRoot } from "./sessions";

export const SESSION_MUTATION_LOCK = ".session-mutation.lock";

export interface ResolveSessionInput {
  sessionId: string;
  /** 显式工作区（已登记根的规范路径）；缺省时要求 id 在登记根里唯一。 */
  workspace?: string;
}

/** 会话 id → 精确来源。`allowedWorkspaces` 必须是可信注册根（调用方已规范化）。 */
export async function resolveSessionRef(
  input: ResolveSessionInput,
  allowedWorkspaces: readonly string[],
): Promise<SessionRef> {
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    throw new Error("会话 id 不能是空串");
  }
  const roots: { workspace: string; root: string }[] = [];
  for (const workspace of allowedWorkspaces) {
    const canonical = await realpath(workspace).catch(() => null);
    if (canonical === null) continue;
    roots.push({ workspace: canonical, root: join(canonical, ".agent", "sessions") });
  }
  if (input.workspace !== undefined) {
    const target = await realpath(input.workspace).catch(() => null);
    const hit = target === null ? undefined : roots.find((r) => r.workspace === target);
    if (hit === undefined) throw new Error(`工作区未登记：${input.workspace}`);
    if (!(await isSessionInRoot(hit.root, input.sessionId))) {
      throw new Error(`会话不存在：${input.sessionId} @ ${hit.workspace}`);
    }
    return { workspace: hit.workspace, sessionId: input.sessionId };
  }
  const hits: string[] = [];
  for (const r of roots) if (await isSessionInRoot(r.root, input.sessionId)) hits.push(r.workspace);
  if (hits.length === 0) throw new Error(`会话不存在：${input.sessionId}`);
  if (hits.length > 1) {
    throw new Error(`会话 id 在多个工作区同时存在（${hits.join("、")}），必须显式指定 workspace：${input.sessionId}`);
  }
  return { workspace: hits[0]!, sessionId: input.sessionId };
}

/** 进程内：同一规范会话根上的 mutation 串行（跨进程那一半是文件锁）。 */
const chains = new Map<string, Promise<void>>();
const lockHandles = new Map<string, FileHandle>();

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireRootLock(root: string): Promise<void> {
  const lockPath = join(root, SESSION_MUTATION_LOCK);
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raw = await readFile(lockPath, "utf8").catch(() => "");
    const pid = Number.parseInt(raw.trim(), 10);
    const alive = Number.isSafeInteger(pid) && pid > 0 && processAlive(pid);
    throw new Error(
      alive
        ? `会话根正被另一个进程占用（pid ${String(pid)}）：${lockPath}`
        : `会话根的锁是崩溃遗留的，需人工确认后删除：${lockPath}`,
    );
  }
  lockHandles.set(root, handle);
  await handle.writeFile(`${String(process.pid)}\n`);
}

async function releaseRootLock(root: string): Promise<void> {
  const handle = lockHandles.get(root);
  lockHandles.delete(root);
  if (handle !== undefined) await handle.close().catch(() => undefined);
  await unlink(join(root, SESSION_MUTATION_LOCK)).catch(() => undefined);
}

/** 在会话根的临界区里执行 `operation`：进程内串行 + 跨进程文件锁。 */
export async function withSessionMutation<T>(sessionsRoot: string, operation: () => Promise<T>): Promise<T> {
  const root = await realpath(sessionsRoot);
  const previous = chains.get(root) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const tail = previous.then(() => gate);
  chains.set(root, tail);
  await previous.catch(() => undefined);
  try {
    await acquireRootLock(root);
    try {
      return await operation();
    } finally {
      await releaseRootLock(root);
    }
  } finally {
    release();
    if (chains.get(root) === tail) chains.delete(root);
  }
}
