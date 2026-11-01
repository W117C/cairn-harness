// 会话运行锁：同一份日志同时只允许一个 run 写。判据都是**盘上事实**（锁文件内容与存在性），
// pid 死活用注入的 isAlive，不依赖本机真实进程表。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireSessionRunLock, sessionRunLockHeld } from "../src/main/session-lock";

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "cairn-session-lock-"));
}

describe("会话运行锁", () => {
  it("首个持有者成功，第二个被拒并点名持有者 pid；释放后可再次获取", async () => {
    const dir = await tempDir();
    try {
      const logPath = join(dir, "s.jsonl");
      const first = await acquireSessionRunLock(logPath, { pid: 111, isAlive: () => true });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const lockText = await readFile(`${logPath}.lock`, "utf8");
      expect(JSON.parse(lockText)).toMatchObject({ pid: 111 });

      const second = await acquireSessionRunLock(logPath, { pid: 222, isAlive: () => true });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error).toContain("pid 111");

      await first.lock.release();
      await expect(readFile(`${logPath}.lock`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      const third = await acquireSessionRunLock(logPath, { pid: 333, isAlive: () => true });
      expect(third.ok).toBe(true);
      if (third.ok) await third.lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("持有者已死（崩溃遗留）⇒ 清掉旧锁并放行", async () => {
    const dir = await tempDir();
    try {
      const logPath = join(dir, "s.jsonl");
      await writeFile(`${logPath}.lock`, JSON.stringify({ pid: 999999, nonce: "dead", startedAt: "2026-01-01T00:00:00.000Z" }) + "\n", "utf8");
      const acquired = await acquireSessionRunLock(logPath, { pid: 42, isAlive: () => false });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      const text = await readFile(`${logPath}.lock`, "utf8");
      expect(JSON.parse(text)).toMatchObject({ pid: 42 });
      await acquired.lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("持有者被判活（EPERM 一类）⇒ 不抢写，拒绝", async () => {
    const dir = await tempDir();
    try {
      const logPath = join(dir, "s.jsonl");
      await writeFile(`${logPath}.lock`, JSON.stringify({ pid: 7, nonce: "x", startedAt: "2026-01-01T00:00:00.000Z" }) + "\n", "utf8");
      const acquired = await acquireSessionRunLock(logPath, { pid: 42, isAlive: () => true });
      expect(acquired.ok).toBe(false);
      if (!acquired.ok) expect(acquired.error).toContain("另一个进程");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("只读检查：活 pid 持有 ⇒ true；死 pid / 缺文件 / 坏内容 ⇒ false", async () => {
    const dir = await tempDir();
    try {
      const logPath = join(dir, "s.jsonl");
      expect(await sessionRunLockHeld(logPath), "缺文件不该算被占用").toBe(false);
      await writeFile(`${logPath}.lock`, JSON.stringify({ pid: process.pid, nonce: "x", startedAt: "2026-01-01T00:00:00.000Z" }) + "\n", "utf8");
      expect(await sessionRunLockHeld(logPath), "活进程持有却看不到 ⇒ 删除/改名会截断在跑的转录").toBe(true);
      await writeFile(`${logPath}.lock`, JSON.stringify({ pid: 2_147_483_647, nonce: "dead", startedAt: "2026-01-01T00:00:00.000Z" }) + "\n", "utf8");
      expect(await sessionRunLockHeld(logPath), "死 pid 算占用 ⇒ 崩溃遗留会永远挡住删除").toBe(false);
      await writeFile(`${logPath}.lock`, "{oops", "utf8");
      expect(await sessionRunLockHeld(logPath), "坏锁内容按无有效持有者处理（acquire 也会把它当陈旧锁清掉）").toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("释放只删自己的锁：内容被替换后不动别人的那一份", async () => {
    const dir = await tempDir();
    try {
      const logPath = join(dir, "s.jsonl");
      const acquired = await acquireSessionRunLock(logPath, { pid: 111, isAlive: () => true });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      const replaced = JSON.stringify({ pid: 222, nonce: "new", startedAt: "2026-01-01T00:00:00.000Z" }) + "\n";
      await writeFile(`${logPath}.lock`, replaced, "utf8");
      await acquired.lock.release();
      expect(await readFile(`${logPath}.lock`, "utf8")).toBe(replaced);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
