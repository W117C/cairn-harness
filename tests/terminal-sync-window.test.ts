// 终态**收尾窗口**的同步点判据（#45 实测抓到的竞态，不是假想）。
// finishInner 开头就置 finished=true，但 done 分支在此之后还要 await git diff + 安全流水 + 数次 emit
// 才挂 lastResult / 放行等待方。落在这段窗口里的读取方若只看 finished，拿到的是「done + result 空」：
// sequencer 会把交出绿证据的那一档判成失败环（级联因此白烧一档再误报整链 failed——本文件写成测前
// 实测复现过一次），join 会把报告记成空串冒充已知。判据改成 terminalResolved 后两头都诚实。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import type { JoinPayloadBody } from "../src/agent/orchestrator-join";

const exec = promisify(execFile);

let work = "";
let repo = "";
let logPath = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "terminal-window-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
  // write mode 要真 git 仓库（worktree / 合并出口）；只读那两条用例不碰它
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...a: string[]): Promise<{ stdout: string }> => exec("git", a, { cwd: repo });
  await g("init");
  await g("config", "user.email", "window@test.local");
  await g("config", "user.name", "Window Test");
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(25);
  }
  return pred();
}

const REPORT = "改了什么：只读评审。为什么：验收同步点。验证方式：读事件流。风险：低。";

describe("终态收尾窗口：已收敛的判据是 terminalResolved", () => {
  it("join 落在窗口内 ⇒ 回执说 running + timedOut 点名；不说 done + 空报告", async () => {
    const events: AgentEvent[] = [];
    let workerId = "";
    const windowRef: { join?: Promise<JoinPayloadBody> } = {};
    let holdOnce = false;
    const orch: Orchestrator = new Orchestrator({
      logPath,
      workspace: work,
      parentMode: "default",
      emit: async (e) => {
        events.push(e);
        if (e.type === "agent_spawned") workerId = (e as { agent_id: string }).agent_id;
        if (e.type === "agent_result" && !holdOnce) {
          // 把 agent_result 的 emit 按住 ⇒ 制造出「finished 已真、lastResult 未挂」那段窗口；
          // 窗口正中叫一次 join（20ms 必超时），它报什么就是这段代码的诚实度读数。
          holdOnce = true;
          windowRef.join = orch.waitForAgents([workerId], 20);
          await sleep(220);
        }
        await createEventLog(logPath).append(e);
      },
      modelFor: (_a: SpawnArgs) => scriptedWorkerModel([
        { type: "assistant_message", content: REPORT },
      ] as unknown as Parameters<typeof scriptedWorkerModel>[0]),
    });
    const p = orch.spawn({ mode: "pipeline", stages: [{ role: "review", task: "评审一下" }] }, { callId: "win-1" });
    expect(await waitFor(() => events.some((e) => e.type === "approval_requested"))).toBe(true);
    const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
    expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
    expect((await p).ok).toBe(true);
    // 等窗口真的打开（emit 按住 agent_result 那一刻才叫的 join），否则断的是「还没开始跑」
    expect(await waitFor(() => windowRef.join !== undefined)).toBe(true);
    const inWindow = await windowRef.join!;
    expect(inWindow.timedOut).toEqual([workerId]); // 未收敛的点名进 timedOut（超时不算失败，但必须说没等到）
    expect(inWindow.rows[0]?.status).toBe("running"); // 窗口内它**还没**可报的终态值
    expect(inWindow.rows.some((r) => r.status === "done" && r.summary === "")).toBe(false); // done + 空报告 = 把不可知记成已知

    // 窗口关上后同一件事必须有真报告——证明这不是「永远读不到」，只是不许在备好前抢读
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    await orch.waitAll(20_000);
    const settled = await orch.waitForAgents([workerId], 500);
    expect(settled.timedOut).toEqual([]);
    expect(settled.rows[0]?.status).toBe("done");
    expect(settled.rows[0]?.summary).toContain("只读评审");
  }, 60_000);

  it("收尾中途 emit 抛 ⇒ 等待方照旧被放行（宁可这环红，不许整链永挂）", async () => {
    const events: AgentEvent[] = [];
    let boom = false;
    const orch: Orchestrator = new Orchestrator({
      logPath,
      workspace: work,
      parentMode: "default",
      emit: async (e) => {
        events.push(e);
        if (e.type === "agent_result" && !boom) {
          // 模拟落盘失败 / 窗口已销毁：agent_result 是 lastResult 挂上前的最后一次 await，
          // 它一抛 terminalResolved 就永远停在 false——旧写法下等待方再无返回（这条等待没有超时，
          // cancelAgent 又因 finished 已真而拒绝），整链不出终态、worktree 也清不掉。
          boom = true;
          throw new Error("simulated append failure");
        }
        await createEventLog(logPath).append(e);
      },
      modelFor: () => scriptedWorkerModel([
        { type: "assistant_message", content: REPORT },
      ] as unknown as Parameters<typeof scriptedWorkerModel>[0]),
    });
    const p = orch.spawn({ mode: "pipeline", stages: [{ role: "review", task: "评审一下" }] }, { callId: "boom-1" });
    expect(await waitFor(() => events.some((e) => e.type === "approval_requested"))).toBe(true);
    const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
    expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
    expect((await p).ok).toBe(true);
    // 判据是「这条红在超时之前真的到了」，不是「没崩」——没崩而一直挂着正是这次修复要杀的形状。
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")))).toBe(true);
  }, 60_000);

  it("收尾窗口里叫合并 ⇒ 拒绝：窗口内 lastFindings 还空着，gate 档会被「无 findings」假通过", async () => {
    const events: AgentEvent[] = [];
    let workerId = "";
    let mergeAttempt: { ok: boolean; error?: string } | null = null;
    let holdOnce = false;
    const orch: Orchestrator = new Orchestrator({
      logPath,
      workspace: repo,
      parentMode: "default",
      safeMode: "gate", // 合并准入的二次确认档：critical|high 未 force 必须拒
      emit: async (e) => {
        events.push(e);
        if (e.type === "agent_spawned") workerId = (e as { agent_id: string }).agent_id;
        if (e.type === "agent_result" && !holdOnce) {
          holdOnce = true;
          // 窗口正中叫合并。旧写法（读 finished）会一路放过：此时安全流水还没跑完，
          // lastFindings 仍是空数组 ⇒ gate 看到的是「零条高危」= 假通过，改动被系统代为 commit 并进主树。
          mergeAttempt = await orch.mergeWorker(workerId);
          await sleep(120);
        }
        await createEventLog(logPath).append(e);
      },
      modelFor: () => scriptedWorkerModel([
        { type: "tool_call", id: "w1", name: "write_file", args: { path: "x.txt", content: "改动\n" } },
        { type: "assistant_message", content: REPORT },
      ] as unknown as Parameters<typeof scriptedWorkerModel>[0]),
    });
    const p = orch.spawn({ mode: "pipeline", stages: [{ role: "implement", task: "写一个文件" }] }, { callId: "merge-win-1" });
    expect(await waitFor(() => events.some((e) => e.type === "approval_requested"))).toBe(true);
    const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
    expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
    expect((await p).ok).toBe(true);
    expect(await waitFor(() => mergeAttempt !== null)).toBe(true);
    expect(mergeAttempt!.ok).toBe(false);
    expect(mergeAttempt!.error ?? "").toContain("尚未收敛");
    // 窗口关上之后再叫就该被受理（拒绝只该发生在值没备好的那一段）
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    await orch.waitAll(20_000);
  }, 60_000);
});
