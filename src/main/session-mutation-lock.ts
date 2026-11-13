// 会话根的短临界区：创建/删除/改名与运行锁恢复共用，避免各自检查后抢写。
import { open, readFile, realpath, stat, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { processLiveness } from "../process-liveness";

export const SESSION_MUTATION_LOCK = ".session-mutation.lock";

/** 进程内：同一规范会话根上的 mutation 串行（跨进程那一半是文件锁）。 */
const chains = new Map<string, Promise<void>>();
const lockHandles = new Map<string, FileHandle>();

/** 锁文件只认完整十进制 pid：`12abc` 不能被截成 12 去探活另一个进程。 */
export function parseMutationLockPid(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/u.test(text)) return null;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

async function acquireRootLock(root: string): Promise<void> {
  const lockPath = join(root, SESSION_MUTATION_LOCK);
  // 这是**短临界区**：另一个进程通常只持有几毫秒（建 run 锁 / 删改会话）。
  // 并发开 4 条不同会话时若一撞 EEXIST 就抛，只有第一个能跑起来——实测见
  // tests/session-lock-recovery.test.ts 的 shared=false 用例。活着就等，死了才报人工。
  const deadline = Date.now() + 2000;
  for (;;) {
    let handle: FileHandle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // TOCTOU 加固（CodeQL js/file-system-race，2026-11-13）：EEXIST 与读取之间锁文件可能被
      // 换掉（崩溃→重建），旧实现直接 readFile 会把**新持有者**的 pid 读进来判旧锁。
      // 句柄内读：内容与 fstat 出自同一个 open；路径 stat 对照句柄 inode，不一致 ⇒ 读取期间
      // 文件被换过，pid 按 unknown 处理（保守方向不变：不抢活人的锁，也绝不据假 pid 强拆）。
      const lockHandle = await open(lockPath, "r").catch(() => null);
      let raw = "";
      let handleIno: number | null = null;
      if (lockHandle !== null) {
        try {
          handleIno = (await lockHandle.stat()).ino;
          raw = await lockHandle.readFile("utf8");
        } catch {
          raw = "";
        }
      }
      const pathIno = await stat(lockPath).then((s) => s.ino).catch(() => null);
      await lockHandle?.close().catch(() => undefined);
      const pid = handleIno !== null && handleIno === pathIno ? parseMutationLockPid(raw) : null;
      const liveness = pid === null ? "unknown" : processLiveness(pid);
      // 只有 ESRCH 能证明持有者已退出；EPERM / 坏内容都按「还在」等多一个截止期，
      // 不能把「不归我管」误报成崩溃遗留，更不能据此抢走活人的临界区。
      if (liveness === "dead") {
        throw new Error(`会话根的锁是崩溃遗留的，需人工确认后删除：${lockPath}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          liveness === "alive"
            ? `会话根正被另一个进程占用（pid ${String(pid)}）：${lockPath}`
            : `会话根正被另一个进程占用：${lockPath}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    lockHandles.set(root, handle);
    await handle.writeFile(`${String(process.pid)}\n`);
    return;
  }
}

async function releaseRootLock(root: string): Promise<void> {
  const handle = lockHandles.get(root);
  lockHandles.delete(root);
  if (handle !== undefined) await handle.close().catch(() => undefined);
  await unlink(join(root, SESSION_MUTATION_LOCK)).catch(() => undefined);
}

/** 「算键 + 入链」这一步的队列：链键要等 `realpath`，而两次 `realpath` 的**回程顺序不受调用顺序保证**
 *  （2026-10-22 实测：`tests/session-reference-repository.test.ts` 的「进程内串行」3 次里红 1 次——
 *  旧实现先 `await realpath` 再读 `chains`，回程颠倒时后来的调用先入链，串行就此失守）。
 *  队列是在调用那一刻**同步**挂上去的，所以入链顺序 = 调用顺序，与文件系统回程快慢无关。 */
let reserveQueue: Promise<void> = Promise.resolve();

/** 在会话根的临界区里执行 `operation`：进程内串行 + 跨进程文件锁。 */
export async function withSessionMutation<T>(sessionsRoot: string, operation: () => Promise<T>): Promise<T> {
  const reserved = reserveQueue.then(async () => {
    const root = await realpath(sessionsRoot);
    const previous = chains.get(root) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const tail = previous.then(() => gate);
    chains.set(root, tail);
    return { root, previous, release, tail };
  });
  // 队列本身不许因为某一次 realpath 失败而卡死（调用方照旧收得到那一条 rejection）。
  reserveQueue = reserved.then(() => undefined, () => undefined);
  const { root, previous, release, tail } = await reserved;
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
