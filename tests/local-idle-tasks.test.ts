import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Scheduler, type TriggerExecutor } from "../src/main/scheduler";
import { replay } from "../src/events";
import { pathOf } from "../src/main/sessions";

let root: string;
let schedulers: Scheduler[];
let busy: boolean;
const input = { name: "闲时整理", prompt: "汇总本地资料", permissionTier: "workspace-write" };
const now = new Date("2026-11-05T08:00:00Z").getTime();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-idle-"));
  schedulers = [];
  busy = false;
});
afterEach(async () => {
  for (const scheduler of schedulers) scheduler.stop();
  await rm(root, { recursive: true, force: true });
});

async function start(
  runSession: TriggerExecutor,
  local: boolean | (() => boolean) = true,
  isIdleWorkspaceAvailable?: (workspace: string) => boolean,
) {
  const scheduler = new Scheduler({
    dataDir: root, sessionsDir: join(root, "sessions"), workspace: root,
    clock: () => now, jitterMs: () => 120_000, runSession,
    ...(local ? { isAgentBusy: typeof local === "function" ? local : () => busy } : {}),
    ...(isIdleWorkspaceAvailable === undefined ? {} : { isIdleWorkspaceAvailable }),
  });
  schedulers.push(scheduler);
  await scheduler.start();
  return scheduler;
}

it("persists queued and paused work, defers while foreground or scheduled work runs, then uses the scheduled executor once", async () => {
  let finishScheduled: (() => void) | undefined;
  const execute = vi.fn<TriggerExecutor>(async ({ message }) => {
    if (message.startsWith("regular")) await new Promise<void>((resolve) => { finishScheduled = resolve; });
    return { ok: true };
  });
  const first = await start(execute);
  expect(await first.enqueueIdleTask(input)).toEqual({ ok: true });
  expect(await first.enqueueIdleTask({ ...input, name: "取消我" })).toEqual({ ok: true });
  const [a, b] = (await first.idleTaskSnapshot()).tasks;
  expect(await first.updateIdleTask(a!.id, "pause")).toEqual({ ok: true });
  expect(await first.updateIdleTask(b!.id, "cancel")).toEqual({ ok: true });
  first.stop();

  const second = await start(execute);
  expect((await second.idleTaskSnapshot()).tasks.map((t) => t.status)).toEqual(["paused", "cancelled"]);
  busy = true;
  expect(await second.updateIdleTask(a!.id, "resume")).toEqual({ ok: true });
  await second.tick({ startup: true });
  expect(execute).not.toHaveBeenCalled();

  const regular = await second.upsert({ name: "普通任务", prompt: "regular", schedule: { kind: "daily", time: "08:00" } });
  if (!regular.ok) throw new Error(regular.errors.join());
  await second.runNow(regular.value.id);
  await vi.waitFor(() => expect(finishScheduled).toBeTypeOf("function"));
  busy = false;
  await second.tick();
  expect(execute).toHaveBeenCalledTimes(1);
  finishScheduled!();
  await vi.waitFor(async () => expect((await second.snapshot()).running).toBe(0));

  await second.tick();
  await vi.waitFor(async () => expect((await second.idleTaskSnapshot()).tasks[0]?.status).toBe("succeeded"));
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]?.[0]).toMatchObject({ mode: "default", message: expect.stringContaining("闲时任务") });
  const completed = (await second.idleTaskSnapshot()).tasks[0]!;
  expect(await replay(pathOf(join(root, "sessions"), completed.sessionId!))).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "automation_completed", status: "succeeded" })]),
  );
  second.stop();
  const restarted = await start(execute);
  await restarted.tick({ startup: true });
  expect(execute).toHaveBeenCalledTimes(2);
  expect((await restarted.idleTaskSnapshot()).tasks[0]?.status).toBe("succeeded");
});

it("recovers an interrupted claim without replaying and leaves the desktop queue alone in headless mode", async () => {
  const execute = vi.fn<TriggerExecutor>(async () => ({ ok: true }));
  const first = await start(execute);
  expect(await first.enqueueIdleTask({ ...input, permissionTier: "unsafe" })).toMatchObject({ ok: false });
  expect(await first.enqueueIdleTask(input)).toEqual({ ok: true });
  expect(await first.enqueueIdleTask({ ...input, name: "稍后执行" })).toEqual({ ok: true });
  const { tasks } = await first.idleTaskSnapshot();
  first.stop();
  await writeFile(join(root, "idle-tasks.json"), JSON.stringify({
    version: 1,
    tasks: [{ ...tasks[0], status: "running", runPid: 2_147_483_647 }, tasks[1]],
  }));
  const headless = await start(execute, false);
  await headless.tick({ startup: true });
  expect(execute).not.toHaveBeenCalled();
  headless.stop();

  const restarted = await start(execute);
  expect((await restarted.idleTaskSnapshot()).tasks[0]).toMatchObject({ status: "failed", error: "interrupted" });
  await restarted.tick({ startup: true });
  await vi.waitFor(async () => expect((await restarted.idleTaskSnapshot()).tasks[1]?.status).toBe("succeeded"));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[0].message).toContain("稍后执行");
});


it("checks foreground activity after the durable claim, defers safely, and cancels the active run through its signal", async () => {
  let gateChecks = 0;
  const execute = vi.fn<TriggerExecutor>(async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { ok: true };
  });
  const scheduler = await start(execute, () => ++gateChecks === 3);
  expect(await scheduler.enqueueIdleTask(input)).toEqual({ ok: true });
  await scheduler.tick({ startup: true });
  const pending = (await scheduler.idleTaskSnapshot()).tasks[0]!;
  expect(pending.status).toBe("queued");
  expect(execute).not.toHaveBeenCalled();

  await Promise.all([scheduler.tick(), scheduler.tick()]);
  expect(execute).toHaveBeenCalledTimes(1);
  expect((await scheduler.idleTaskSnapshot()).tasks[0]).toMatchObject({ status: "running", sessionId: pending.sessionId });
  // 运行中的任务不能暂停：这条同时是 src/main/scheduler.ts 那句能力断言的证人
  // （promise-recall-inventory 的欠证人帽要求用户可见的拒绝句都被点过一次）。
  expect(await scheduler.updateIdleTask(pending.id, "pause")).toEqual({ ok: false, error: "当前状态不支持此操作" });
  expect(await scheduler.updateIdleTask(pending.id, "cancel")).toEqual({ ok: true });
  await scheduler.whenIdle;
  expect(execute.mock.calls[0]?.[0].signal.aborted).toBe(true);
  expect((await scheduler.idleTaskSnapshot()).tasks[0]?.status).toBe("cancelled");
});

it("uses the registered project's own session root and defers tasks for removed projects", async () => {
  const a = join(root, "project-a");
  const b = join(root, "project-b");
  await mkdir(a); await mkdir(b);
  const projects = new Set([root, a, b]);
  const execute = vi.fn<TriggerExecutor>(async () => ({ ok: true }));
  const scheduler = await start(execute, true, (ws) => projects.has(ws));
  expect(await scheduler.enqueueIdleTask({ ...input, workspace: b }, a)).toMatchObject({ ok: false });
  expect(await scheduler.enqueueIdleTask(input, join(root, "unknown"))).toMatchObject({ ok: false });
  expect(await scheduler.enqueueIdleTask(input, a)).toEqual({ ok: true });
  const projectTask = (await scheduler.idleTaskSnapshot(a)).tasks[0]!;
  expect(await scheduler.idleTaskSnapshot(b)).toEqual({ workspace: b, tasks: [] });
  expect(await scheduler.updateIdleTask(projectTask.id, "cancel", b)).toMatchObject({ ok: false });
  projects.delete(a);
  await scheduler.tick({ startup: true });
  expect(execute).not.toHaveBeenCalled();
  projects.add(a);
  await scheduler.tick();
  await scheduler.whenIdle;
  expect(execute).toHaveBeenCalledTimes(1);
  const completed = (await scheduler.idleTaskSnapshot(a)).tasks[0]!;
  expect(completed.status).toBe("succeeded");
  const logPath = pathOf(join(a, ".agent", "sessions"), completed.sessionId!);
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ workspace: a, logPath });
  expect(await replay(logPath)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "automation_completed" })]));
});
