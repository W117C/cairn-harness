import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CanaryController, type CanarySample } from "../src/main/evolution/canary";
import { ModuleRegistry } from "../src/main/evolution/registry";

const hooks = vi.hoisted(() => ({ beforeRemove: undefined as ((path: unknown) => Promise<void>) | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rm: async (...args: Parameters<typeof fs.rm>) => {
    await hooks.beforeRemove?.(args[0]);
    return fs.rm(...args);
  } };
});

function latch(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

it("two stale-lock contenders never enter the canary critical section together", async () => {
  const root = await mkdtemp(join(tmpdir(), "canary-lock-reclaim-"));
  const lockPath = join(root, ".agent", ".canary.lock");
  const removing = latch();
  const resumeRemove = latch();
  const holdCriticalSection = latch();
  const enteredA = latch();
  const enteredB = latch();
  let active = 0;
  let maxActive = 0;
  let firstRemove = true;
  let taskA: Promise<unknown> | undefined;
  let taskB: Promise<unknown> | undefined;
  try {
    await mkdir(join(root, ".agent"));
    await writeFile(lockPath, "2147483646");
    hooks.beforeRemove = async (path) => {
      if (path !== lockPath + ".reclaim" || !firstRemove) return;
      firstRemove = false;
      removing.release();
      await resumeRemove.promise;
    };
    const controllers = [enteredA, enteredB].map((entered) => {
      const registry = new ModuleRegistry(root, { knownGates: new Set(["typecheck"]) });
      const readIndex = registry.readIndex.bind(registry);
      vi.spyOn(registry, "readIndex").mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        entered.release();
        try {
          await holdCriticalSection.promise;
          return await readIndex();
        } finally { active -= 1; }
      });
      return new CanaryController({ registry, workspace: root });
    });
    const sample: CanarySample = { verifyOutcome: "green", costMeasurable: true, tokensPerBoundary: 1, spendAfterLastBoundary: 0 };
    taskA = controllers[0]!.tickAll(sample).catch((error: unknown) => error);
    await removing.promise;
    taskB = controllers[1]!.tickAll(sample).catch((error: unknown) => error);
    await Promise.race([enteredB.promise, taskB]);
    resumeRemove.release();
    await Promise.race([enteredA.promise, taskA]);
    expect(maxActive).toBe(1);
  } finally {
    resumeRemove.release();
    holdCriticalSection.release();
    await Promise.allSettled([taskA, taskB]);
    hooks.beforeRemove = undefined;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

it("release cannot delete a replacement lock path", async () => {
  const root = await mkdtemp(join(tmpdir(), "canary-lock-release-aba-"));
  const lockPath = join(root, ".agent", ".canary.lock");
  const entered = latch();
  const releaseCriticalSection = latch();
  let task: Promise<unknown> | undefined;
  try {
    await mkdir(join(root, ".agent"), { recursive: true });
    const registry = new ModuleRegistry(root, { knownGates: new Set(["typecheck"]) });
    const readIndex = registry.readIndex.bind(registry);
    vi.spyOn(registry, "readIndex").mockImplementation(async () => {
      entered.release();
      await releaseCriticalSection.promise;
      return await readIndex();
    });
    const controller = new CanaryController({ registry, workspace: root });
    const sample: CanarySample = { verifyOutcome: "green", costMeasurable: true, tokensPerBoundary: 1, spendAfterLastBoundary: 0 };
    task = controller.tickAll(sample).catch((error: unknown) => error);
    await entered.promise;
    await rm(lockPath, { force: true });
    await writeFile(lockPath, "2147483646", "utf8");
    releaseCriticalSection.release();
    await task;
    expect(await readFile(lockPath, "utf8")).toBe("2147483646");
  } finally {
    releaseCriticalSection.release();
    await Promise.allSettled([task]);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
