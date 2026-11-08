import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSessionRunLock, sessionRunLockHeld } from "../src/main/session-lock";
import { SESSION_MUTATION_LOCK } from "../src/main/session-repository";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cairn-lock-recovery-"));
  roots.push(root);
  return root;
}

describe("session run lock recovery", () => {
  it.each(["null", "true", "42", '"lock"', "[]", '{"pid":0}', '{"pid":-1}'])(
    "recovers malformed owner %s without throwing or probing a process group",
    async (raw) => {
      const path = join(await tempRoot(), "s.jsonl");
      await writeFile(`${path}.lock`, raw);
      expect(await sessionRunLockHeld(path)).toBe(false);
      const acquired = await acquireSessionRunLock(path);
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      expect(await sessionRunLockHeld(path)).toBe(true);
      expect(JSON.parse(await readFile(`${path}.lock`, "utf8"))).toMatchObject({ pid: process.pid });
      await acquired.lock.release();
    },
  );

  it("does not reclaim a run lock while another process owns the root mutation lock", async () => {
    const root = await tempRoot();
    const path = join(root, "s.jsonl");
    const stale = JSON.stringify({ pid: 2_147_483_647, nonce: "dead" });
    await writeFile(`${path}.lock`, stale);
    await writeFile(join(root, SESSION_MUTATION_LOCK), `${String(process.pid)}\n`);
    await expect(acquireSessionRunLock(path)).rejects.toThrow(/会话根.*占用/);
    expect(await readFile(`${path}.lock`, "utf8")).toBe(stale);
  });

  it("does not treat an unreadable lock path as an unlocked session", async () => {
    const path = join(await tempRoot(), "s.jsonl");
    await mkdir(`${path}.lock`);
    await expect(sessionRunLockHeld(path)).rejects.toMatchObject({ code: "EISDIR" });
    await expect(acquireSessionRunLock(path)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("admits exactly one writer when concurrent calls recover a stale lock", async () => {
    const root = await tempRoot();
    for (let round = 0; round < 12; round++) {
      const path = join(root, `${String(round)}.jsonl`);
      await writeFile(`${path}.lock`, JSON.stringify({ pid: 2_147_483_647, nonce: "dead" }));
      const results = await Promise.all(Array.from({ length: 12 }, () => acquireSessionRunLock(path)));
      const holders = results.filter((result) => result.ok);
      try {
        expect(holders, `round ${String(round)}`).toHaveLength(1);
        expect(await sessionRunLockHeld(path)).toBe(true);
      } finally {
        await Promise.all(holders.map((holder) => holder.lock.release()));
      }
      expect(await sessionRunLockHeld(path)).toBe(false);
    }
  });

  it.each([
    { shared: true, expectedWriters: 1 },
    { shared: false, expectedWriters: 4 },
  ])("cross-process recovery: shared=$shared admits $expectedWriters writers", async ({ shared, expectedWriters }) => {
    const root = await tempRoot();
    const paths = Array.from({ length: 4 }, (_, index) => join(root, shared ? "shared.jsonl" : `${String(index)}.jsonl`));
    const script = join(root, "worker.mjs");
    const moduleUrl = new URL("../src/main/session-lock.ts", import.meta.url).href;
    for (const path of new Set(paths)) {
      await writeFile(`${path}.lock`, JSON.stringify({ pid: 2_147_483_647, nonce: "dead" }));
    }
    await writeFile(script, `
      import { acquireSessionRunLock } from ${JSON.stringify(moduleUrl)};
      let held;
      setTimeout(() => process.exit(2), 10000).unref();
      process.on("message", async (message) => {
        if (message === "go") {
          try {
            held = await acquireSessionRunLock(process.argv[2]);
            process.send({ kind: "result", ok: held.ok, pid: process.pid });
          } catch (error) {
            process.send({ kind: "result", ok: false, error: error.message });
          }
        } else if (message === "release") {
          if (held?.ok) await held.lock.release();
          process.disconnect();
        }
      });
      process.send({ kind: "ready" });
    `);
    const workers = paths.map((path) => {
      const child = fork(script, [path], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let ready!: (value: boolean) => void;
      let report!: (value: { ok: boolean; pid?: number }) => void;
      const started = new Promise<boolean>((resolve) => { ready = resolve; });
      const result = new Promise<{ ok: boolean; pid?: number }>((resolve) => { report = resolve; });
      child.on("message", (message: { kind?: string; ok?: boolean; pid?: number }) => {
        if (message.kind === "ready") ready(true);
        if (message.kind === "result") report({ ok: message.ok === true, ...(message.pid !== undefined ? { pid: message.pid } : {}) });
      });
      child.on("error", () => { ready(false); report({ ok: false }); });
      const closed = new Promise<void>((resolve) => child.on("close", () => {
        ready(false); report({ ok: false }); resolve();
      }));
      return { child, started, result, closed };
    });
    try {
      expect(await Promise.all(workers.map((worker) => worker.started))).toEqual([true, true, true, true]);
      for (const { child } of workers) child.send("go");
      const winners = (await Promise.all(workers.map((worker) => worker.result))).filter((result) => result.ok);
      expect(winners).toHaveLength(expectedWriters);
      if (shared) expect(JSON.parse(await readFile(`${paths[0]!}.lock`, "utf8"))).toMatchObject({ pid: winners[0]?.pid });
      for (const path of new Set(paths)) expect(await sessionRunLockHeld(path)).toBe(true);
    } finally {
      for (const { child } of workers) if (child.connected) child.send("release");
      await Promise.all(workers.map((worker) => worker.closed));
    }
    for (const path of new Set(paths)) expect(await sessionRunLockHeld(path)).toBe(false);
  }, 15_000);
});
