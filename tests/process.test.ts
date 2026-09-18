// M0 复盘 P1-1 / P1-2 回归：
//  P1-1 —— 子进程曾继承 process.env，而主进程把 BYOK key 写进 process.env.M0_API_KEY，
//          模型写的命令一条 `env` 就能把明文 key 读进事件流。
//  P1-2 —— 超时只 kill 直接子进程（bash），孙进程（pnpm/tsc）留孤儿；且孙进程持有 stdout 时
//          'close' 永不触发 → 调用方的 Promise 永久挂起。
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killGroup, sanitizedEnv, spawnTracked } from "../src/tools/process";

describe("sanitizedEnv（P1-1）", () => {
  it("剥除密钥类变量，只留白名单", () => {
    process.env.M0_API_KEY = "should-be-stripped";
    process.env.SOME_PASSWORD = "x";
    try {
      const env = sanitizedEnv();
      expect(env.M0_API_KEY).toBeUndefined();
      expect(env.SOME_PASSWORD).toBeUndefined();
      expect(env.PATH).toBeDefined();
      expect(env.HOME).toBeDefined();
      expect(env.NODE_ENV).toBeUndefined();
    } finally {
      delete process.env.M0_API_KEY;
      delete process.env.SOME_PASSWORD;
    }
  });

  it("传 tmpDir 时覆盖 TMPDIR（沙箱路径写收敛）", () => {
    expect(sanitizedEnv("/some/tmp").TMPDIR).toBe("/some/tmp");
  });

  it("密钥读不进子进程（端到端）", async () => {
    process.env.M0_API_KEY = "SUPER-SECRET-KEY";
    try {
      const out = await new Promise<string>((resolve) => {
        let buf = "";
        const h = spawnTracked("bash", ["-c", "echo KEY=[$M0_API_KEY]"], {
          cwd: process.cwd(),
          env: sanitizedEnv(),
          timeoutMs: 10_000,
          onTimeout: () => resolve("timeout"),
        });
        h.child.stdout?.on("data", (d: Buffer) => { buf += d.toString("utf8"); });
        h.child.on("close", () => { h.dispose(); resolve(buf); });
      });
      expect(out).not.toContain("SUPER-SECRET-KEY");
      expect(out.trim()).toBe("KEY=[]");
    } finally {
      delete process.env.M0_API_KEY;
    }
  });
});

describe("spawnTracked / killGroup（P1-2）", () => {
  it("超时主动收束，不等 'close'（孙进程持有 stdout 也不挂起）", async () => {
    const t0 = Date.now();
    // `sleep 30 &` 的孙进程继承 stdout 管道 → 只杀 bash 时 'close' 永不触发
    const why = await new Promise<string>((resolve) => {
      const h = spawnTracked("bash", ["-c", "sleep 30 & sleep 30"], {
        cwd: process.cwd(),
        env: sanitizedEnv(),
        timeoutMs: 500,
        onTimeout: () => resolve("timeout-forced-settle"),
      });
      h.child.on("close", () => resolve("close"));
    });
    expect(why).toBe("timeout-forced-settle");
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, 15_000);

  it("killGroup 收掉整棵进程树（孙进程不留孤儿）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-pg-"));
    const pidFile = join(dir, "grandchild.pid");
    try {
      const h = spawnTracked("bash", ["-c", `sleep 30 & echo $! > ${pidFile}; wait`], {
        cwd: dir,
        env: sanitizedEnv(),
        timeoutMs: 30_000,
        onTimeout: () => {},
      });
      for (let i = 0; i < 60 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(pidFile)).toBe(true);
      const grandchild = Number(readFileSync(pidFile, "utf8").trim());
      expect(Number.isFinite(grandchild)).toBe(true);

      killGroup(h.child);
      h.dispose();

      let alive = true;
      for (let i = 0; i < 40 && alive; i++) {
        await new Promise((r) => setTimeout(r, 50));
        try {
          process.kill(grandchild, 0);
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
  it("超时后整棵进程树被杀（孙进程不留孤儿、不泄漏）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-pg-to-"));
    const pidFile = join(dir, "grandchild.pid");
    try {
      const h = spawnTracked("bash", ["-c", `sleep 30 & echo $! > ${pidFile}; wait`], {
        cwd: dir,
        env: sanitizedEnv(),
        timeoutMs: 400,
        onTimeout: () => {},
      });
      for (let i = 0; i < 60 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(pidFile)).toBe(true);
      const grandchild = Number(readFileSync(pidFile, "utf8").trim());
      expect(Number.isFinite(grandchild)).toBe(true);
      // 超时触发后 killGroup 必须收掉孙进程（不依赖 'close'）
      let alive = true;
      for (let i = 0; i < 100 && alive; i++) {
        await new Promise((r) => setTimeout(r, 50));
        try {
          process.kill(grandchild, 0);
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
      h.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

});
