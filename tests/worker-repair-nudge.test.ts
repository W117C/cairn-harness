import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { Orchestrator } from "../src/agent/orchestrator";
import type { WorkerModel } from "../src/agent/worker-model";
import { HARNESS_VERIFY_CALL_ID } from "../src/agent/loop";

const exec = promisify(execFile);
const REPORT = "## 结论\n- 完成。\n\n## 证据路径\n- a.txt:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。";

let work = "";
let repo = "";
let logPath = "";
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "worker-repair-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...args: string[]): Promise<{ stdout: string }> => exec("git", args, { cwd: repo });
  await g("init");
  await g("config", "user.email", "repair@test.local");
  await g("config", "user.name", "Repair Test");
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

async function waitTerminal(events: AgentEvent[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (events.some((event) => event.type === "agent_result")) return;
    if (Date.now() > deadline) throw new Error("worker 未在预算内收束");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function run(options: { repair: boolean }): Promise<{ events: AgentEvent[]; requests: number; signals: string[][] }> {
  const events: AgentEvent[] = [];
  const signals: string[][] = [];
  let requests = 0;
  const model = (async function* (messages: unknown[]) {
    requests += 1;
    void messages;
    yield requests === 1
      ? { type: "tool_call", id: "w1", name: "write_file", args: { path: "a.txt", content: "x\n" } }
      : { type: "assistant_message", content: REPORT };
  }) as WorkerModel;
  model.scripted = true;
  const orch = new Orchestrator({
    logPath,
    workspace: repo,
    parentMode: "default",
    emit: async (event) => { events.push(event); },
    modelFor: () => model,
    workerVerify: () => ({
      maxAttempts: 3,
      surface: async () => true,
      run: async () => ({ ok: false, results: [{ command: "pnpm test", ok: false, output: "FAIL: 1 failed" }] }),
    }),
    ...(options.repair ? { workerAutoVerifyRepair: true } : {}),
    workerExperienceNudge: async ({ signals: got }) => {
      signals.push([...got]);
      return { note: "\n[exp-nudge] WORKER_REPAIR_LESSON", ids: ["exp_aaaaaaaaaaaaaaaa"] };
    },
  });
  const spawned = await orch.spawn({ mode: "write", task: "写一个文件" }, { callId: "w1" });
  expect(spawned.ok).toBe(true);
  await waitTerminal(events);
  return { events, requests, signals };
}

it("开启返修：worker 自动红多要一轮，回执带经验提醒与归因 ids", async () => {
  const { events, requests, signals } = await run({ repair: true });
  expect(requests).toBe(3);
  expect(signals[0]).toContain("verify:red");
  const auto = events.find((event) => event.type === "tool_result" && event.callId === HARNESS_VERIFY_CALL_ID);
  expect(auto?.type).toBe("tool_result");
  if (auto === undefined || auto.type !== "tool_result") throw new Error("unreachable");
  expect(auto.output).toContain("WORKER_REPAIR_LESSON");
  expect(auto.nudgeExperienceIds).toEqual(["exp_aaaaaaaaaaaaaaaa"]);
});

it("未开返修：worker 自动红只落证据，不再多要一轮", async () => {
  const { events, requests } = await run({ repair: false });
  expect(requests).toBe(2);
  const auto = events.find((event) => event.type === "tool_result" && event.callId === HARNESS_VERIFY_CALL_ID);
  expect(auto?.type).toBe("tool_result");
  if (auto === undefined || auto.type !== "tool_result") throw new Error("unreachable");
  expect(auto.output).not.toContain("WORKER_REPAIR_LESSON");
  expect(auto.nudgeExperienceIds).toBeUndefined();
});
