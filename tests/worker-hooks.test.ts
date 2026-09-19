// worker 与插件钩子引擎的接线（§9.10「worker 继承主会话插件启用集」+ §9.5 PreToolUse 在权限门前）。
// 为什么单独一组：worker 有 write_file / edit_file / 可写 shell，而它的 runLoop 调用从前**不传 hooks**
// ⇒ 用户在主会话装的拦截钩子（"禁改 migrations/"、密钥扫描、format-on-write）对并行 worker 一律不生效。
// 这与 W4a 修掉的「表里没有 verify 却能执行 verify」是同一形状：门装了不锁。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promisify } from "node:util";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { worktreePathFor } from "../src/agent/worktree";
import { HookEngine } from "../src/agent/plugins";
import type { HookPayload, HookRunResult } from "../src/agent/plugins/hooks";
import type { LoadedHookDef } from "../src/agent/plugins/types";

const exec = promisify(execFile);

let work: string;
let repo: string;
let logPath: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "dsh-worker-hooks-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...args: string[]): Promise<{ stdout: string }> => exec("git", args, { cwd: repo });
  await g("init");
  await g("config", "user.email", "hooks@test.local");
  await g("config", "user.name", "Hooks Test");
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

const REPORT = "## 结论\n- 完成。\n\n## 证据路径\n- README.md:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。";

/** 桩引擎：给出确定性 blocked=true（真引擎的阻断面在 hooks-input-contract 那组里测）。 */
function stubEngine(over: Partial<HookRunResult> = {}): { engine: HookEngine; calls: { event: string; payload: HookPayload }[] } {
  const calls: { event: string; payload: HookPayload }[] = [];
  const engine = {
    run: async (event: string, payload: HookPayload): Promise<HookRunResult> => {
      calls.push({ event, payload });
      return {
        blocked: false, additionalContext: "", errors: [], overflowFiles: [],
        droppedContextHandlers: [], ran: 1, skipped: 0, ...over,
      };
    },
    forWorkerMode: (): HookEngine => engine,
  } as unknown as HookEngine;
  return { engine, calls };
}

function makeOrch(
  model: (a: SpawnArgs) => unknown,
  workerHooks?: (mode: "read" | "write") => HookEngine | null,
): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: repo,
    parentMode: "default",
    emit: async (e): Promise<void> => { events.push(e); await createEventLog(logPath).append(e); },
    modelFor: model as never,
    ...(workerHooks ? { workerHooks } : {}),
  });
  return { orch, events };
}

const agentIdOf = (output: string): string => (JSON.parse(output) as { agent_id: string }).agent_id;
const toolResult = (events: AgentEvent[], callId: string): Extract<AgentEvent, { type: "tool_result" }> | undefined =>
  events.find((e) => e.type === "tool_result" && e.callId === callId) as Extract<AgentEvent, { type: "tool_result" }> | undefined;

/** 轮询等终态（定长 sleep 在重载下假红，见 agents.test.ts I1 那条）。 */
async function waitTerminal(events: AgentEvent[], timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (events.some((e) => e.type === "agent_result")) return;
    if (Date.now() > deadline) throw new Error("worker 未在预算内收束");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("worker 接插件钩子", () => {
  it("PreToolUse 阻断真的挡住 worker 的写：worktree 里不落盘，tool_result 带钩子理由", async () => {
    const { engine, calls } = stubEngine({ blocked: true, blockReason: "禁改 src/secret.ts" });
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([
        { type: "tool_call", id: "w1", name: "write_file", args: { path: "secret.ts", content: "leak" } },
        { type: "assistant_message", content: REPORT },
      ] as never),
      () => engine,
    );
    const agentId = agentIdOf((await orch.spawn({ mode: "write", task: "写文件" }, { callId: "s1" })).output);
    await waitTerminal(events);
    expect(toolResult(events, "w1")?.ok).toBe(false);
    expect(toolResult(events, "w1")?.output).toContain("禁改 src/secret.ts");
    await expect(readFile(join(worktreePathFor(repo, agentId), "secret.ts"), "utf8")).rejects.toBeTruthy();
    expect(calls.map((c) => c.event)).toContain("PreToolUse");
  });

  it("钩子拿到 agent_id = 该 worker 的 id 与模型实下的参数（§4.4 归因）", async () => {
    const { engine, calls } = stubEngine();
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([
        { type: "tool_call", id: "g1", name: "read_file", args: { path: "README.md" } },
        { type: "assistant_message", content: REPORT },
      ] as never),
      () => engine,
    );
    const agentId = agentIdOf((await orch.spawn({ mode: "read", task: "读文件" }, { callId: "s2" })).output);
    await waitTerminal(events);
    const pre = calls.find((c) => c.event === "PreToolUse");
    expect(pre?.payload.agent_id).toBe(agentId);
    expect(pre?.payload.tool_name).toBe("read_file");
    expect(pre?.payload.tool_args).toEqual({ path: "README.md" });
  });

  it("未接线（workerHooks 缺省）= 零行为：worker 照常写成功", async () => {
    const { orch, events } = makeOrch(() => scriptedWorkerModel([
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "ok.ts", content: "hi" } },
      { type: "assistant_message", content: REPORT },
    ] as never));
    const agentId = agentIdOf((await orch.spawn({ mode: "write", task: "写文件" }, { callId: "s3" })).output);
    await waitTerminal(events);
    expect(toolResult(events, "w1")?.ok).toBe(true);
    expect(await readFile(join(worktreePathFor(repo, agentId), "ok.ts"), "utf8")).toBe("hi");
  });

  it("编排器按 worker 档索取引擎视图（read worker 拿只读档，不继承主会话宽档）", async () => {
    const seen: string[] = [];
    const base = new HookEngine({ hooks: [], workspace: work, pluginDataRoot: work, mode: "auto" });
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([
        { type: "tool_call", id: "g1", name: "read_file", args: { path: "README.md" } },
        { type: "assistant_message", content: REPORT },
      ] as never),
      (mode) => { seen.push(mode); return base.forWorkerMode(mode); },
    );
    await orch.spawn({ mode: "read", task: "读文件" }, { callId: "s4" });
    await waitTerminal(events);
    expect(seen).toContain("read");
  });

  it("forWorkerMode(\"read\") 把引擎降成只读档：中等风险的钩子命令拒跑；\"write\" 沿用原档", () => {
    // chmod -R 命中威胁表 medium（非 high/critical）⇒ 宽档放行、只读档拒跑，正好做两侧的分水岭。
    const h: LoadedHookDef = {
      plugin: "p", pluginRoot: work, event: "PostToolUse",
      handler: { type: "command", command: "chmod -R 644 out" }, loaded: true,
    };
    const wide = new HookEngine({ hooks: [h], workspace: work, pluginDataRoot: work, mode: "auto" });
    expect(wide.gateHook(h)).toBeNull();
    expect(String(wide.forWorkerMode("read").gateHook(h))).toContain("只读档");
    expect(wide.forWorkerMode("write").gateHook(h)).toBeNull();
  });
});
