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
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { withSessionMutation } from "./session-mutation-lock";
import { isRecord } from "../is-record";
import { processLiveness } from "../process-liveness";

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

/** 进程启动时刻（epoch ms）。读不到返回 null（不据此判死，保持 fail-closed）。 */
type ProcessStartReader = (pid: number) => Promise<number | null>;

const execFileAsync = promisify(execFile);

/** macOS/Linux 的 `ps -o lstart=`；解析失败/进程不在 ⇒ null。 */
async function processStartedAt(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 2_000 });
    const parsed = Date.parse(stdout.trim());
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** PID 复用判据：锁写于 startedAt；若**当前**占用该 pid 的进程启动得比锁还晚，
 *  它不可能是写锁的那个进程（旧持有者已死，pid 被系统回收）。
 *  2 秒容差吸收 `ps` 的秒级取整与锁创建到落盘的间隔。 */
async function pidWasReused(holder: Partial<LockFile>, pid: number, readStart: ProcessStartReader): Promise<boolean> {
  if (typeof holder.startedAt !== "string") return false;
  const lockMs = Date.parse(holder.startedAt);
  if (!Number.isFinite(lockMs)) return false;
  const startMs = await readStart(pid);
  return startMs !== null && startMs > lockMs + 2_000;
}

/** 只读检查另一进程是否正持有这份日志的运行锁（供删除/改名这类写结构操作在动手前拦一下）。
 *  只剩规则与 acquire 一致：坏锁内容按「没有有效持有者」处理（acquire 会把它当陈旧锁清掉）；
 *  活 pid 但启动晚于锁 ⇒ PID 复用，按陈旧锁处理。 */
export async function sessionRunLockHeld(
  logPath: string,
  opts: { processStartedAt?: ProcessStartReader } = {},
): Promise<boolean> {
  const raw = await readLock(`${logPath}.lock`);
  if (raw === null) return false;
  const holder = readOwner(raw);
  const pid = ownerPid(holder);
  if (pid === null || processLiveness(pid) === "dead") return false;
  return !(await pidWasReused(holder, pid, opts.processStartedAt ?? processStartedAt));
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

export interface SessionRunLockOptions {
  pid?: number;
  isAlive?: (pid: number) => boolean;
  /** 测试注入：返回该 pid 的真实启动时刻；缺省用 `ps`。 */
  processStartedAt?: ProcessStartReader;
}

type Attempt =
  | { kind: "ok" }
  | { kind: "retry" }
  | { kind: "busy"; pid: number; startedAt: string | null };

export async function acquireSessionRunLock(
  logPath: string,
  opts: SessionRunLockOptions = {},
): Promise<SessionRunLockResult> {
  return withSessionMutation(dirname(logPath), () => acquireRunLock(logPath, opts));
}

async function acquireRunLock(
  logPath: string,
  opts: SessionRunLockOptions,
): Promise<SessionRunLockResult> {
  const path = `${logPath}.lock`;
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? ((holder) => processLiveness(holder) !== "dead");
  // 注入 isAlive 的调用方（判卷）自己定义"活着"；PID 复用检查只在真实进程表路径上生效，
  // 否则假 pid 会去撞测试机上的真实进程。要测复用就显式注入 processStartedAt。
  const readStart = opts.processStartedAt ?? (opts.isAlive === undefined ? processStartedAt : async () => null);
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
      if (holderPid !== null && isAlive(holderPid) && !(await pidWasReused(holder, holderPid, readStart))) {
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
