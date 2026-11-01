// 会话运行锁：同一份会话日志同时只允许一个 run 写。
// 实测缺陷（两条 CLI 同 --session 并发）：两轮的 user/assistant/tool 事件交错进同一份 JSONL，
// 两个进程都报成功，转录已不可读；事件 id 按 1-based 行号定义，交错后血缘/续跑判据全错。
//
// 锁 = `<logPath>.lock` 旁路文件，`wx`（O_EXCL）创建，内容 {pid, nonce, startedAt}：
//   · 持锁进程活着 → 拒绝，点名 pid 与开始时间；
//   · 获取/回收在会话根的短临界区内完成，避免两个清理者先后删掉新持有者的锁；
//   · 持锁进程已死（崩溃留下的）→ 删除旧锁，再重试；
//   · 释放只删自己写的那一份（nonce 对得上），不误删别人的锁。
// 进程被 SIGKILL 时锁会留下，由下一次获取按 pid 死活清理。
import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { withSessionMutation } from "./session-mutation-lock";
import { isRecord } from "../is-record";

async function readLock(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readOwner(raw: string): Partial<LockFile> {
  try {
    const holder: unknown = JSON.parse(raw);
    if (isRecord(holder)) {
      return holder as Partial<LockFile>;
    }
  } catch { /* 不完整或损坏的记录没有有效持有者。 */ }
  return {};
}

function ownerPid(holder: Partial<LockFile>): number | null {
  return typeof holder.pid === "number" && Number.isSafeInteger(holder.pid) && holder.pid > 0 ? holder.pid : null;
}

/** 只读检查另一进程是否正持有这份日志的运行锁（供删除/改名这类写结构操作在动手前拦一下）。
 *  只剩规则与 acquire 一致：坏锁内容按「没有有效持有者」处理（acquire 会把它当陈旧锁清掉）。 */
export async function sessionRunLockHeld(logPath: string): Promise<boolean> {
  const raw = await readLock(`${logPath}.lock`);
  if (raw === null) return false;
  const pid = ownerPid(readOwner(raw));
  return pid !== null && alive(pid);
}

export interface SessionRunLock {
  release: () => Promise<void>;
}

export type SessionRunLockResult =
  | { ok: true; lock: SessionRunLock }
  | { ok: false; error: string };

interface LockFile {
  pid: number;
  nonce: string;
  startedAt: string;
}

/** pid 是否还活着。EPERM = 进程在、只是不归我们管，按活着算（宁可拒，不抢写）。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type Attempt =
  | { kind: "ok" }
  | { kind: "retry" }
  | { kind: "busy"; pid: number; startedAt: string | null };

export async function acquireSessionRunLock(
  logPath: string,
  opts: { pid?: number; isAlive?: (pid: number) => boolean } = {},
): Promise<SessionRunLockResult> {
  return withSessionMutation(dirname(logPath), () => acquireRunLock(logPath, opts));
}

async function acquireRunLock(
  logPath: string,
  opts: { pid?: number; isAlive?: (pid: number) => boolean },
): Promise<SessionRunLockResult> {
  const path = `${logPath}.lock`;
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? alive;
  const nonce = randomUUID();
  const body = JSON.stringify({ pid, nonce, startedAt: new Date().toISOString() } satisfies LockFile) + "\n";

  const attempt = async (): Promise<Attempt> => {
    try {
      const fh = await open(path, "wx", 0o600);
      try {
        await fh.writeFile(body, "utf8");
      } finally {
        await fh.close();
      }
      return { kind: "ok" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raw = await readLock(path);
      if (raw === null) return { kind: "retry" }; // 对方刚好释放
      const holder = readOwner(raw);
      const holderPid = ownerPid(holder);
      if (holderPid !== null && isAlive(holderPid)) {
        return { kind: "busy", pid: holderPid, startedAt: typeof holder.startedAt === "string" ? holder.startedAt : null };
      }
      // 根级临界区覆盖检查、删除和下一次创建；内容比较本身不能代替互斥。
      const again = await readLock(path);
      if (again === raw) await unlink(path).catch(() => undefined);
      return { kind: "retry" };
    }
  };

  for (let i = 0; i < 3; i++) {
    const result = await attempt();
    if (result.kind === "ok") {
      let releasePromise: Promise<void> | undefined;
      return {
        ok: true,
        lock: {
          release: () => releasePromise ??= (async () => {
            const current = await readLock(path);
            if (current === body) await unlink(path).catch(() => undefined);
          })(),
        },
      };
    }
    if (result.kind === "busy") {
      const when = result.startedAt === null ? "" : `，开始于 ${result.startedAt}`;
      return {
        ok: false,
        error: `这份会话正被另一个进程运行（pid ${String(result.pid)}${when}）：等它结束再续跑，或换一条会话`,
      };
    }
  }
  return { ok: false, error: `无法获取会话运行锁：${path}（并发争抢未收敛）` };
}
