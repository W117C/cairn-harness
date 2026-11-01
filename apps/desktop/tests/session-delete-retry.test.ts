// 删除运行中会话的「先停再删」口径（2026-10-31）：核心锁错误只在预算内重试；其余错误立即抛。
import { describe, expect, it } from "vitest";
import {
  DELETE_RUNNING_POLL_MS,
  DELETE_RUNNING_WAIT_MS,
  deleteSessionWaitingForRun,
  isRunningDeleteError,
  shouldRetryDelete,
} from "../src/renderer/state/session-delete";
import { readRendererFile } from "./helpers/app-surface";

describe("isRunningDeleteError：只认「还在跑」类错误", () => {
  it("核心原文/英文兜底命中；其他失败不命中", () => {
    expect(isRunningDeleteError(new Error("删除失败：会话正在运行，先停止再删除: s1"))).toBe(true);
    expect(isRunningDeleteError("Session is running; stop it first")).toBe(true);
    expect(isRunningDeleteError(new Error("ENOENT: no such file"))).toBe(false);
    expect(isRunningDeleteError(undefined)).toBe(false);
  });
});

describe("deleteSessionWaitingForRun：锁释放前有界重试", () => {
  it("预算内锁错误重试到成功；间隔固定、成功后不再等", async () => {
    let calls = 0;
    let now = 0;
    const sleeps: number[] = [];
    const result = await deleteSessionWaitingForRun(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("会话正在运行，先停止再删除: s1");
        return { currentSession: null };
      },
      "s1",
      () => now,
      async (ms) => { sleeps.push(ms); now += ms; },
    );
    expect(result).toEqual({ currentSession: null });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([DELETE_RUNNING_POLL_MS, DELETE_RUNNING_POLL_MS]);
  });

  it("非运行类错误立即抛出、一次都不重试", async () => {
    let calls = 0;
    let slept = 0;
    await expect(deleteSessionWaitingForRun(
      async () => { calls += 1; throw new Error("会话不存在: s1"); },
      "s1",
      () => 0,
      async () => { slept += 1; },
    )).rejects.toThrow("会话不存在");
    expect(calls).toBe(1);
    expect(slept).toBe(0);
  });

  it("超出预算仍被占用 ⇒ 抛出最后一条锁错误（不无限等）", async () => {
    let now = 0;
    let calls = 0;
    await expect(deleteSessionWaitingForRun(
      async () => { calls += 1; throw new Error("会话正在运行，先停止再删除: s1"); },
      "s1",
      () => now,
      async (ms) => { now += ms; },
    )).rejects.toThrow("会话正在运行");
    expect(now).toBeGreaterThanOrEqual(DELETE_RUNNING_WAIT_MS);
    expect(shouldRetryDelete(now)).toBe(false);
    expect(calls).toBeGreaterThan(1);
  });
});

describe("接线：确认时带运行态、执行时先停再删", () => {
  it("sessions.ts 先取消再重试删除，成功后清运行旗", () => {
    const sessions = readRendererFile("state/sessions.ts");
    expect(sessions).toContain("runningSet.current.has(runKey(s.workspace, s.id))");
    expect(sessions).toContain("{ ...s, running: true }");
    expect(sessions).toContain("window.agent.runCancel(id, workspace ?? undefined)");
    expect(sessions).toContain("deleteSessionWaitingForRun(endSessionDelete, id)");
    expect(sessions).toContain("runningSet.current.delete(key)");
  });

  it("确认卡按运行态换文案与按钮；确认会带上目标会话", () => {
    const scrims = readRendererFile("panes/ConfirmScrims.tsx");
    expect(scrims).toContain("deleteConfirm.running === true");
    expect(scrims).toContain("该会话正在运行：确认后会先停止本轮，再删除。");
    expect(scrims).toContain("停止并删除");
    expect(scrims).toContain("doDeleteSession(target.id, target)");
  });
});
