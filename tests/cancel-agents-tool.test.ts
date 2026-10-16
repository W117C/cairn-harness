// 判卷 · 让 agent 自己撤自己派出去的活（能力 4「动态调整」/ 能力 8「可接管」的机器面）
//
// 两条实测出来的形状，这一笔一起闭：
//  ① `orchestrator-join.ts` 的超时提示**命令**模型「可再 wait 或 cancelAgent」，而 `cancelAgent` 是
//     TS 方法名、模型面上没有这个工具 ⇒ 文案在给一扇不存在的门（本仓点过名的撒谎形状：
//     「工具拒绝语还在承诺一扇不存在的门」）。取消此前只有人（IPC 面板）能按 ⇒ 派错的活只能干等它跑完。
//  ② spawn 回执只说"派成功了"，不说在途几个、上限几个 ⇒ 「还要不要再拆一个」只能凭感觉，
//     撞上 MAX_CONCURRENT_WORKERS 才知道有闸。
// 参数非法一律 throw ToolError（与 wait_for_agents / impact_query 同形，由 loop 在边界转 ok:false）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, type SpawnArgs, type WorkerModel } from "../src/agent/orchestrator";
import { MAX_CONCURRENT_WORKERS, WORKER_FORBIDDEN_TOOLS } from "../src/agent/orchestrator-config";
import { gateToolSpecs } from "../src/agent/session-provider";
import { workerToolSpecs } from "../src/agent/worker-shell-tools";
import { renderJoinPayload } from "../src/agent/orchestrator-join";
import { CANCEL_AGENTS_TOOL, createCancelAgentsTool, type CancelAgentsHost } from "../src/tools/cancel_agents";

const REPORT = "## 结论\n- 做完了。\n\n## 证据路径\n- a.ts:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。";

/** 卡住的 worker 模型：放行 gate 之前不产出 ⇒ 测试期间它一定还在途，撤得动。 */
function blockingModel(gate: Promise<void>): WorkerModel {
  const model: WorkerModel = async function* () {
    await gate;
    yield { type: "assistant_message", content: REPORT } as never;
  };
  model.scripted = true; // 冻结回放不拨号不付钱：价格面应当缺席，不报 $0
  return model;
}

let work = "";
let logPath = "";
/** spawn 时 worker 拿到的模型会 await 这一条；测试据此把 worker 卡在途。 */
let gate: Promise<void> = Promise.resolve();

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "cancel-agents-test-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
  // 第 449 页：这条用例此前**读真实 HOME**（`~/.config/cairn/memory`）。2026-10-12 实测到后果：
  // 那台机器上那份记忆目录一旦存在且内容不同，这条用例就**稳定失败**（撤了 worker 却不落
  // `agent_status(cancelled)`），而代码一个字没改——同一份代码在干净 HOME 下 8/8 全过。
  // ⇒ 判卷必须自带记忆目录，否则"红/绿"取决于开发机的家目录。
  vi.stubEnv("M2D_MEMORY_HOME", join(work, "memory"));
  gate = Promise.resolve();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

function makeOrch(): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath, workspace: work, parentMode: "default",
    modelFor: () => blockingModel(gate),
    emit: async (e) => { events.push(e); await createEventLog(logPath).append(e); },
  });
  return { orch, events };
}

describe("cancel_agents 工具（结构桩：只验工具体那一层）", () => {
  const host = (over: Partial<CancelAgentsHost> = {}): CancelAgentsHost => ({
    inFlightAgents: () => ["a1", "a2"],
    cancelAgents: (ids) => ({ cancelled: [...ids.filter((i) => i === "a1")], terminal: [], unknown: [...ids.filter((i) => i !== "a1")] }),
    ...over,
  });

  it("编排器未接线 ⇒ fail-closed 拒绝（与 wait_for_agents 同一措辞族）", async () => {
    const r = await createCancelAgentsTool(() => null).run({ agent_ids: ["a1"] }, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("编排器未接线");
  });

  it("撤掉在途 worker：回执点名被撤的 id，并把剩下的在途一起报出来", async () => {
    const seen: string[][] = [];
    const r = await createCancelAgentsTool(() => host({
      cancelAgents: (ids) => { seen.push([...ids]); return { cancelled: [...ids], terminal: [], unknown: [] }; },
    })).run({ agent_ids: ["a1"] }, { workspace: "/tmp", callId: "c2" });
    expect(r.ok, r.output).toBe(true);
    expect(seen).toEqual([["a1"]]);
    expect(r.output).toContain("a1");
    expect(r.output).toContain("a2"); // 还有几个在途，模型这一轮就能决定要不要接着派
  });

  it("未知 id ⇒ 整批拒（不做部分执行），并把真正在途的 id 列给它", async () => {
    let called = 0;
    const r = await createCancelAgentsTool(() => host({
      cancelAgents: (ids) => { called++; return { cancelled: [...ids], terminal: [], unknown: [] }; },
    })).run({ agent_ids: ["ghost"] }, { workspace: "/tmp", callId: "c3" });
    expect(r.ok).toBe(false);
    expect(called, "有未知 id 就不该动手撤（撤一半是最难复现的错法）").toBe(0);
    expect(r.output).toContain("a1");
    expect(r.output).toContain("未知 agent_id");
  });

  it("agent_ids 缺失/空数组/非字符串 ⇒ 拒绝并点名参数", async () => {
    const t = createCancelAgentsTool(() => host());
    await expect(t.run({}, { workspace: "/tmp", callId: "c4" })).rejects.toThrow(/agent_ids/);
    await expect(t.run({ agent_ids: [] }, { workspace: "/tmp", callId: "c5" })).rejects.toThrow(/agent_ids/);
    await expect(t.run({ agent_ids: [1] }, { workspace: "/tmp", callId: "c6" })).rejects.toThrow(/agent_ids/);
  });

  it("规格与实例同名同串；只读档摘掉；worker 两面都够不着（深度恒 1）", () => {
    const spec = gateToolSpecs("auto").find((s) => s.function.name === CANCEL_AGENTS_TOOL);
    if (!spec) throw new Error("模型可见面里没有 cancel_agents（实例在表里，模型却叫不到）");
    expect(spec.function.description).toContain("撤");
    expect(Object.keys((spec.function.parameters as { properties?: Record<string, unknown> }).properties ?? {}))
      .toEqual(["agent_ids"]);
    expect(gateToolSpecs("read-only").some((s) => s.function.name === CANCEL_AGENTS_TOOL)).toBe(false);
    expect(workerToolSpecs().some((s) => (s as { name?: string }).name === CANCEL_AGENTS_TOOL)).toBe(false);
    expect(WORKER_FORBIDDEN_TOOLS).toContain(CANCEL_AGENTS_TOOL);
  });
});

describe("cancel_agents 走真编排器（那一跳要真的把 worker 停下来）", () => {
  it("撤 ⇒ agent_status(cancelled) 真落流；没撤的那一个继续跑完", async () => {
    const g = deferred();
    gate = g.promise;
    const { orch, events } = makeOrch();
    const a = await orch.spawn({ mode: "read", task: "甲" } as SpawnArgs, { callId: "s1" });
    const b = await orch.spawn({ mode: "read", task: "乙" } as SpawnArgs, { callId: "s2" });
    expect(a.ok, a.output).toBe(true);
    expect(b.ok, b.output).toBe(true);
    const ids = (JSON.parse(a.output) as { agent_id: string }).agent_id;

    const tool = createCancelAgentsTool(() => orch);
    const r = await tool.run({ agent_ids: [ids] }, { workspace: work, callId: "c7" });
    expect(r.ok, r.output).toBe(true);
    g.release();
    await orch.waitAll(5_000);

    const cancelled = events.filter((e) => e.type === "agent_status" &&
      (e as { status?: string }).status === "cancelled");
    expect(cancelled.map((e) => (e as { agent_id?: string }).agent_id)).toEqual([ids]);
    // 只撤点名的那一个：另一个仍到 done（一把全停是能力 4 的反面）
    expect(events.some((e) => e.type === "agent_result" &&
      (e as { agent_id?: string }).agent_id !== ids)).toBe(true);
  });

  it("spawn 回执把在途数与上限摆在模型面前（不报价位就只能凭感觉拆）", async () => {
    const g = deferred();
    gate = g.promise;
    const { orch } = makeOrch();
    const first = await orch.spawn({ mode: "read", task: "甲" } as SpawnArgs, { callId: "s3" });
    const second = await orch.spawn({ mode: "read", task: "乙" } as SpawnArgs, { callId: "s4" });
    g.release();
    await orch.waitAll(5_000);
    const receipt = JSON.parse(second.output) as Record<string, unknown>;
    expect(receipt.in_flight).toBe(2);            // 含这一次
    expect(receipt.worker_cap).toBe(MAX_CONCURRENT_WORKERS);
    expect((JSON.parse(first.output) as Record<string, unknown>).in_flight).toBe(1);
  });
});

describe("join 文案点名的取回通道必须真存在", () => {
  it("超时提示里的取消通道 = 模型面上真有的那个工具名（幻影门第 N 次复发）", () => {
    const text = renderJoinPayload({
      rows: [{ agent_id: "w1", status: "running", task: "t", summary: "", truncated: false,
        usage: { inputTokens: 0, outputTokens: 0 } }],
      degraded: [], timedOut: ["w1"], cancelled: false,
    });
    const onFace = new Set(gateToolSpecs("auto").map((s) => s.function.name));
    expect(text).toContain("wait_for_agents");
    expect(text, "取消通道要点名模型真能调的工具：" + text).toContain(CANCEL_AGENTS_TOOL);
    expect(text, "不许再点名方法名（模型面上没有它）").not.toContain("cancelAgent");
    for (const n of [CANCEL_AGENTS_TOOL, "wait_for_agents"]) expect(onFace, "文案点名了模型叫不到的工具：" + n).toContain(n);
  });
});
