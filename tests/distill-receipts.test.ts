import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DistillOptions } from "../src/agent/memory/distill";
import type { AgentEvent, ToolCallEvent } from "../src/events";
import type { Provider } from "../src/providers";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const rememberCall = (id: string, scope: "global" | "project" = "global"): ToolCallEvent => ({
  type: "tool_call", id, name: "remember",
  args: { scope, kind: "memory", type: "user", topic: "language", content: "prefer Chinese" },
});

async function setup(calls = [rememberCall("memory-1")]) {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "distill-receipts-"));
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  vi.stubEnv("M2D_MEMORY_HOME", join(dir, "memory-home"));
  const { runSessionEndDistill } = await import("../src/agent/memory/distill");
  const { createEventLog, replay } = await import("../src/events");
  const logPath = join(dir, "session.jsonl");
  const log = createEventLog(logPath);
  cleanups.push(async () => { try { await log.close?.(); } finally { await rm(dir, { recursive: true, force: true }); } });
  await log.append({ type: "user_message", content: "remember preference" });
  const controller = new AbortController();
  const approve = vi.fn(async () => true);
  const write = vi.fn(async () => ({ ok: true, output: "saved" }));
  let closed = false;
  const provider: Provider = {
    async *stream() {
      try { for (const call of calls) yield call; }
      finally { closed = true; }
    },
  };
  return {
    controller, approve, write, log, closed: () => closed,
    read: () => replay(logPath),
    run: (overrides: Partial<DistillOptions> = {}) => runSessionEndDistill({
      enabled: true, logPath, workspace, provider, signal: controller.signal,
      rememberTool: { name: "remember", run: write }, mergedApproval: approve,
      emit: (event) => log.append(event), ...overrides,
    }),
  };
}

function receipts(events: AgentEvent[]) {
  return events.filter((event) => event.type === "tool_result");
}

describe("自动沉淀的已落盘调用必须有真实结局", () => {
  it.each([true, false])("审批返回 %s 时取消：补齐取消回执，保留已知审批状态", async (approved) => {
    const s = await setup();
    const outcome = await s.run({ mergedApproval: async () => {
      s.controller.abort(new Error("cancel during approval"));
      return approved;
    } });
    expect(outcome).toEqual({ kind: "failed", why: "cancel during approval" });
    expect(s.write).not.toHaveBeenCalled();
    const log = await s.read();
    expect(log.filter((event) => event.type === "tool_call")).toHaveLength(1);
    expect(receipts(log)).toHaveLength(1);
    expect(receipts(log)[0]).toMatchObject({ callId: "memory-1", ok: false, gate: { layer: "X-distill", verdict: approved ? "approved" : "rejected" } });
    expect(receipts(log)[0]?.output).toContain("cancelled");
    const { projectContext } = await import("../src/agent/context");
    expect(projectContext(log).find((message) => message.role === "tool" && message.tool_call_id === "memory-1")?.content).toContain("cancelled");
    expect(s.closed()).toBe(true);
  });

  it.each(["project", "global"] as const)("%s 调用落盘期间取消：不再发起审批或写入，不编造审批结论", async (scope) => {
    const s = await setup([rememberCall("memory-1", scope)]);
    expect(await s.run({ emit: async (event) => {
      await s.log.append(event);
      if (event.type === "tool_call") s.controller.abort(new Error("cancel after call log"));
    } })).toEqual({ kind: "failed", why: "cancel after call log" });
    expect(s.approve).not.toHaveBeenCalled();
    expect(s.write).not.toHaveBeenCalled();
    const result = receipts(await s.read());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ callId: "memory-1", ok: false });
    expect(result[0]?.output).toContain("cancelled");
    if (scope === "project") expect(result[0]?.gate).toMatchObject({ layer: "X-distill", verdict: "auto-approved" });
    else expect(result[0]).not.toHaveProperty("gate");
  });

  it("审批口抛错：调用有失败回执，原错误仍为沉淀失败原因", async () => {
    const s = await setup();
    expect(await s.run({ mergedApproval: async () => { throw new Error("approval unavailable"); } }))
      .toEqual({ kind: "failed", why: "approval unavailable" });
    expect(s.write).not.toHaveBeenCalled();
    const result = receipts(await s.read());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ callId: "memory-1", ok: false });
    expect(result[0]?.output).toContain("approval unavailable");
    expect(result[0]).not.toHaveProperty("gate");
  });

  it("复用已批准的全局审批时取消第二笔，第一笔保留，第二笔有明确取消回执", async () => {
    const s = await setup([rememberCall("memory-1"), rememberCall("memory-2")]);
    expect(await s.run({ emit: async (event) => {
      await s.log.append(event);
      if (event.type === "tool_call" && event.id === "memory-2") s.controller.abort();
    } })).toMatchObject({ kind: "failed" });
    expect(s.approve).toHaveBeenCalledTimes(1);
    expect(s.write).toHaveBeenCalledTimes(1);
    const result = receipts(await s.read());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ callId: "memory-1", ok: true });
    expect(result[1]).toMatchObject({ callId: "memory-2", ok: false, gate: { verdict: "approved" } });
    expect(result[1]?.output).toContain("cancelled");
  });

  it("未取消的批准路径仍执行一次，并且只落一条成功回执", async () => {
    const s = await setup();
    expect(await s.run()).toEqual({ kind: "saved", writes: 1, asks: 1 });
    expect(s.approve).toHaveBeenCalledTimes(1);
    expect(s.write).toHaveBeenCalledTimes(1);
    const result = receipts(await s.read());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ callId: "memory-1", ok: true, gate: { verdict: "approved" } });
  });

  it("普通 remember 工具失败仍可继续下一笔，不因审批异常处理而重复落回执", async () => {
    const s = await setup([rememberCall("memory-1"), rememberCall("memory-2")]);
    s.write.mockRejectedValueOnce(new Error("write failed"));
    expect(await s.run()).toEqual({ kind: "saved", writes: 1, asks: 1 });
    const result = receipts(await s.read());
    expect(result).toHaveLength(2);
    expect(result.map((event) => [event.callId, event.ok])).toEqual([["memory-1", false], ["memory-2", true]]);
    expect(s.approve).toHaveBeenCalledTimes(1);
    expect(s.write).toHaveBeenCalledTimes(2);
  });
});
