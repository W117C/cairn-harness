import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { closeAllEventLogs } from "../src/events";
import { Scheduler, appendJournalEntry, compactJournalIfLarge, readJournalFile, type JournalEntry } from "../src/main/scheduler";

const timing = vi.hoisted(() => ({
  afterRead: undefined as ((path: unknown, data: unknown) => Promise<void>) | undefined,
  beforeRename: undefined as ((path: unknown) => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof readFile>) => {
      const data = await fs.readFile(...args);
      await timing.afterRead?.(args[0], data);
      return data;
    },
    rename: async (...args: Parameters<typeof rename>) => {
      await timing.beforeRename?.(args[1]);
      return fs.rename(...args);
    },
  };
});

let dir: string;

afterEach(async () => {
  timing.afterRead = undefined;
  timing.beforeRename = undefined;
  await closeAllEventLogs();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const at = "2026-09-12T02:00:00.000Z";
const entry = (key: string): JournalEntry => ({
  task_id: "fixture", occurrence_key: key, due_at: at, decision: "triggered", at,
});

function barrier(): { reached: Promise<void>; release: () => void } {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { release = resolve; });
  return { reached, release };
}

it("陈旧锁的延迟回收不能抢走压缩者的新锁或抹掉并发追加", async () => {
  dir = await mkdtemp(join(tmpdir(), "scheduler-journal-lock-"));
  const file = join(dir, "automations-journal.jsonl");
  const lock = join(dir, "automations-journal.lock");
  // Different path keys bypass the in-process queue but address the same files.
  const alias = dir + sep + "." + sep + "automations-journal.jsonl";
  const deadPid = "1000000000";
  await writeFile(lock, deadPid);
  await writeFile(file, Array.from({ length: 10_001 }, (_, i) => JSON.stringify(entry(String(i)))).join("\n") + "\n");

  const staleRead = barrier();
  const resumeStale = barrier();
  const beforeRename = barrier();
  const resumeRename = barrier();
  const liveOwnerObserved = barrier();
  let pausedReader = false;
  timing.afterRead = async (path, data) => {
    if (path !== lock) return;
    if (String(data) === deadPid && !pausedReader) {
      pausedReader = true;
      staleRead.release();
      await resumeStale.reached;
    }
    if (String(data) === String(process.pid)) liveOwnerObserved.release();
  };
  timing.beforeRename = async (target) => {
    if (target !== file) return;
    beforeRename.release();
    await resumeRename.reached;
  };

  const append = appendJournalEntry(alias, entry("after-recovery"));
  let compact: Promise<number> | undefined;
  try {
    await Promise.race([staleRead.reached, append]);
    compact = compactJournalIfLarge(file);
    await Promise.race([beforeRename.reached, compact]);
    resumeStale.release();
    // A correct reclaimer sees the live owner. A racy one appends before rename.
    await Promise.race([liveOwnerObserved.reached, append]);
    resumeRename.release();
    await Promise.all([compact, append]);
    expect((await readJournalFile(file)).entries.at(-1)?.occurrence_key).toBe("after-recovery");
  } finally {
    resumeStale.release();
    resumeRename.release();
    await Promise.allSettled([append, compact]);
  }
});

it("调度日志续写保留没有末尾换行的已决记录", async () => {
  dir = await mkdtemp(join(tmpdir(), "scheduler-journal-tail-"));
  const file = join(dir, "automations-journal.jsonl");
  await writeFile(file, JSON.stringify(entry("first")));
  expect((await readJournalFile(file)).entries.map((row) => row.occurrence_key)).toEqual(["first"]);

  await appendJournalEntry(file, entry("second"));

  expect((await readJournalFile(file)).entries.map((row) => row.occurrence_key)).toEqual(["first", "second"]);
});

it("准入锁延迟回收不能让两个实例决定同一次触发", async () => {
  dir = await mkdtemp(join(tmpdir(), "scheduler-admission-lock-"));
  const file = join(dir, "automations-journal.jsonl");
  const lock = join(dir, "automations.lock");
  const deps = {
    dataDir: dir, sessionsDir: join(dir, "sessions"), workspace: dir,
    clock: () => Date.parse(at), jitterMs: () => 600_000,
    runSession: async () => ({ ok: true }),
  };
  const first = new Scheduler(deps);
  const second = new Scheduler(deps);
  const staleRead = barrier();
  const resumeStale = barrier();
  const journalRead = barrier();
  const resumeJournal = barrier();
  let firstRun: Promise<{ ok: boolean }> | undefined;
  let secondRun: Promise<{ ok: boolean }> | undefined;
  try {
    const task = await first.upsert({
      name: "并发触发", prompt: "读取变更",
      schedule: { kind: "daily", time: "09:30" }, timeZone: "Asia/Shanghai",
      permissionTier: "read-only",
    });
    if (!task.ok) throw new Error(task.errors.join());
    await writeFile(file, "");
    await second.start();

    const deadPid = "1000000000";
    await writeFile(lock, deadPid);
    let pausedStale = false;
    let pausedJournal = false;
    timing.afterRead = async (path, data) => {
      if (path === lock && String(data) === deadPid && !pausedStale) {
        pausedStale = true;
        staleRead.release();
        await resumeStale.reached;
      }
      if (path === file && !pausedJournal) {
        pausedJournal = true;
        journalRead.release();
        await resumeJournal.reached;
      }
    };
    secondRun = second.runNow(task.value.id);
    await Promise.race([staleRead.reached, secondRun]);
    firstRun = first.runNow(task.value.id);
    await Promise.race([journalRead.reached, firstRun]);
    resumeStale.release();
    const delayed = await secondRun;
    resumeJournal.release();
    expect((await firstRun).ok).toBe(true);
    expect(delayed.ok).toBe(false);
    expect((await readJournalFile(file)).entries).toHaveLength(1);
  } finally {
    resumeStale.release();
    resumeJournal.release();
    await Promise.allSettled([firstRun, secondRun]);
    await Promise.all([first.whenIdle, second.whenIdle]);
    first.stop();
    second.stop();
  }
});
