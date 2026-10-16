// 工具面测：参数收窄 fail-visible、编排器未接线、零 worker 零行为、payload 与规格同源。
// 用结构桩而非真 Orchestrator——工具体只依赖 WaitForAgentsHost 这两样，测才能与编排器解耦。
// 参数非法一律 **throw ToolError**（本仓约定：impact-query / propose_plan 同形，由 loop 在边界转成
// ok:false 的 tool_result）⇒ 单测直调 tool.run 时必须用 rejects.toThrow，不能期待返回值。
import { describe, expect, it } from "vitest";
import { WAIT_FOR_AGENTS_TOOL, createWaitForAgentsTool, type WaitForAgentsHost } from "../src/tools/wait_for_agents";
import { gateToolSpecs } from "../src/agent/session-provider";

const hostWith = (calls: unknown[]): WaitForAgentsHost & { calls: unknown[] } => ({
  calls,
  hasWorkers: () => true,
  waitForAgents: async (ids, timeoutMs, signal) => {
    calls.push({ ids, timeoutMs, hasSignal: signal !== undefined });
    return { rows: [{ agent_id: "w1", status: "done", task: "t", summary: "结论", truncated: false, usage: { inputTokens: 1, outputTokens: 2 } }], degraded: [], timedOut: [], cancelled: false };
  },
});
const emptyHost = (): WaitForAgentsHost => ({ hasWorkers: () => false, waitForAgents: async () => { throw new Error("不该被调用"); } });

describe("wait_for_agents 工具", () => {
  it("编排器未接线 ⇒ fail-closed 拒绝（与 spawn_agent 同一措辞族，不静默返回空）", async () => {
    const r = await createWaitForAgentsTool(() => null).run({}, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("编排器未接线");
  });

  it("正常收队：透传 agent_ids / timeout_ms / 取消信号，输出以 [join] 开头", async () => {
    const h = hostWith([]);
    const r = await createWaitForAgentsTool(() => h).run({ agent_ids: ["w1"], timeout_ms: 30_000 }, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(true);
    expect(r.output.startsWith("[join]")).toBe(true);
    expect(h.calls[0]).toEqual({ ids: ["w1"], timeoutMs: 30_000, hasSignal: false });
  });

  it("零 worker ⇒ 一句话即返，不建等待（省一次模型可见的空对象）", async () => {
    const r = await createWaitForAgentsTool(() => emptyHost()).run({}, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("没有 worker");
  });

  it("非法 timeout_ms 拒绝并把合法区间说清楚（不静默回落缺省）", async () => {
    await expect(
      createWaitForAgentsTool(() => hostWith([])).run({ timeout_ms: "30000" }, { workspace: "/tmp", callId: "c1" }),
    ).rejects.toThrow(/timeout_ms/);
  });

  it("agent_ids 含非字符串 ⇒ 拒绝（JSON 数组里混数字是模型常犯的错，必须点名而不是当未知 id 处理）", async () => {
    await expect(
      createWaitForAgentsTool(() => hostWith([])).run({ agent_ids: [1] }, { workspace: "/tmp", callId: "c1" }),
    ).rejects.toThrow(/agent_ids/);
  });

  it("规格与实例同名同串（两头断是本仓第 5 次复发的缺陷族）", () => {
    // 断的是**模型可见那一份**（gateToolSpecs），不是工具模块里的副本——副本曾与它漂移过。
    const spec = gateToolSpecs("auto").find((s) => s.function.name === WAIT_FOR_AGENTS_TOOL);
    if (!spec) throw new Error("模型可见面里没有 wait_for_agents（实例在表里，模型却叫不到）");
    expect(spec.function.description).toContain("收队");
    expect(Object.keys((spec.function.parameters as { properties?: Record<string, unknown> }).properties ?? {}))
      .toEqual(["agent_ids", "timeout_ms"]);
    expect(gateToolSpecs("read-only").some((s) => s.function.name === WAIT_FOR_AGENTS_TOOL)).toBe(false);
  });
});
