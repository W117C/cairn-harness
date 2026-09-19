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

const REPORT = "## 结论\n- 完成。\n\n## 证据路径\n- README.md:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。"; // docs-check:allow 夹具正文：worker 报告里的 file:line 证据路径，不是本仓文档的指针

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

/** 轮询等一个条件成立（同 waitTerminal：定长 sleep 在重载下假红）。 */
async function waitFor(cond: () => boolean, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return true;
    if (Date.now() > deadline) return false;
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

// §9.5 SubagentStart / SubagentStop：此前只有枚举、无生产者（agent_type 因此也从没有生产者填过它）。
// 这两条事件的价值全在"回执有人接"：SubagentStart 的 stdout 要进 worker 的上下文，
// SubagentStop 要能让审计钩子在终态事件落流后看到产出。只 run 一下不接 = 收下即丢。
describe("worker 生命周期发 Subagent 事件", () => {
  it("SubagentStart 的 additionalContext 真的进模型收到的 system 块（不是发完就丢）", async () => {
    const captures: { role: string; content: string }[][] = [];
    const { engine, calls } = stubEngine({ additionalContext: "本仓库禁改 migrations/ 目录" });
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([
        { type: "assistant_message", content: REPORT },
      ] as never, captures as never),
      () => engine,
    );
    const agentId = agentIdOf((await orch.spawn({ mode: "read", task: "调研" }, { callId: "sub-1" })).output);
    await waitTerminal(events);
    const start = calls.find((c) => c.event === "SubagentStart");
    expect(start?.payload.agent_id).toBe(agentId);
    const sys = captures[0]?.filter((m) => m.role === "system").map((m) => m.content).join("\n") ?? "";
    expect(sys).toContain("本仓库禁改 migrations/ 目录");
    expect(sys).toContain("[SubagentStart hook]"); // 标明这段是钩子给的，不是任务书里的
  });

  it("两条事件各恰好一次，且 SubagentStop 晚于 agent_result 落流（审计钩子要看得见产出）", async () => {
    const seen: { event: string; hadResult: boolean }[] = [];
    let eventsRef: AgentEvent[] = [];
    const engine = {
      run: async (event: string): Promise<HookRunResult> => {
        if (event === "SubagentStart" || event === "SubagentStop") {
          seen.push({ event, hadResult: eventsRef.some((e) => e.type === "agent_result") });
        }
        return {
          blocked: false, additionalContext: "", errors: [], overflowFiles: [],
          droppedContextHandlers: [], ran: 1, skipped: 0,
        };
      },
      forWorkerMode: (): HookEngine => engine as unknown as HookEngine,
    } as unknown as HookEngine;
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([{ type: "assistant_message", content: REPORT }] as never),
      () => engine,
    );
    eventsRef = events;
    await orch.spawn({ mode: "read", task: "调研" }, { callId: "sub-2" });
    await waitTerminal(events);
    await orch.waitAll(8_000);
    expect(seen.filter((s) => s.event === "SubagentStart").length).toBe(1);
    const stops = seen.filter((s) => s.event === "SubagentStop");
    expect(stops.length).toBe(1);
    expect(stops[0]?.hadResult).toBe(true);
  });

  it("普通 spawn 没有角色名 ⇒ agent_type 整键缺席（拿空串伪造一个类型是伪造输入）", async () => {
    const { engine, calls } = stubEngine();
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([{ type: "assistant_message", content: REPORT }] as never),
      () => engine,
    );
    await orch.spawn({ mode: "read", task: "调研" }, { callId: "sub-3" });
    await waitTerminal(events);
    const start = calls.find((c) => c.event === "SubagentStart");
    expect(start).toBeDefined();
    expect("agent_type" in (start?.payload ?? {})).toBe(false);
  });

  it("流水线 stage 的 worker 带 agent_type = 角色名（§9.5 的 matcher 字段有值可配）", async () => {
    const { engine, calls } = stubEngine();
    const { orch, events } = makeOrch(
      () => scriptedWorkerModel([{ type: "assistant_message", content: "## 结论\n审阅完成。\nverdict: pass" }] as never),
      () => engine,
    );
    const spawned = orch.spawn({ mode: "pipeline", stages: [{ role: "review", task: "审 README" }] }, { callId: "sub-4" });
    expect(await waitFor(() => events.some((e) => e.type === "approval_requested"))).toBe(true);
    const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
    expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
    expect((await spawned).ok).toBe(true);
    expect(await waitFor(() => calls.some((c) => c.event === "SubagentStop"))).toBe(true);
    const types = calls.filter((c) => c.event === "SubagentStart").map((c) => c.payload.agent_type);
    expect(types).toContain("review");
  });
});
