import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DistillOptions } from "../src/agent/memory/distill";
import { splitUsageByAttribution } from "../src/agent/cost-per-progress";
import type { ToolCallEvent, UsageEvent } from "../src/events";
import type { Provider } from "../src/providers";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const usage: UsageEvent = {
  type: "usage", inputTokens: 123, outputTokens: 45,
  cacheReadInputTokens: 100, cacheWriteInputTokens: 5, model: "test-model",
};
const remember: ToolCallEvent = {
  type: "tool_call", id: "memory-1", name: "remember",
  args: { scope: "project", kind: "memory", type: "user", topic: "language", content: "prefer Chinese" },
};

async function setup() {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "distill-usage-"));
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
  return {
    controller, approve, write, log, read: () => replay(logPath),
    run: (provider: Provider, overrides: Partial<DistillOptions> = {}) => runSessionEndDistill({
      enabled: true, logPath, workspace, provider, signal: controller.signal,
      rememberTool: { name: "remember", run: write }, mergedApproval: approve,
      emit: (event) => log.append(event), ...overrides,
    }),
  };
}

describe("沉淀轮取消时保留已经收到的用量", () => {
  it("等待模型期间取消，但该次 next 已返回 usage：落盘并进入用量汇总，立即关闭流", async () => {
    const s = await setup();
    const nextPull = vi.fn();
    const close = vi.fn();
    const result = await s.run({ async *stream() {
      try {
        s.controller.abort(new Error("cancel with received usage"));
        yield usage;
        nextPull();
        yield remember;
      } finally { close(); }
    } });
    const events = await s.read();
    expect(events.filter((event) => event.type === "usage")).toEqual([usage]);
    expect(splitUsageByAttribution(events)).toMatchObject({ requests: 1, mainTokens: 168, totalTokens: 168, cacheReadTokens: 100 });
    expect(result).toEqual({ kind: "failed", why: "cancel with received usage" });
    expect(s.write).not.toHaveBeenCalled();
    expect(s.approve).not.toHaveBeenCalled();
    expect(nextPull).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("usage 落盘期间取消：用量只记一次，不再拉取下一笔输出", async () => {
    const s = await setup();
    const nextPull = vi.fn();
    const close = vi.fn();
    const result = await s.run({ async *stream() {
      try {
        yield usage;
        nextPull();
        yield remember;
      } finally { close(); }
    } }, { emit: async (event) => {
      await s.log.append(event);
      if (event.type === "usage") s.controller.abort(new Error("cancel during usage log"));
    } });
    expect(result).toEqual({ kind: "failed", why: "cancel during usage log" });
    const events = await s.read();
    expect(events.filter((event) => event.type === "usage")).toEqual([usage]);
    expect(events.some((event) => event.type === "tool_call")).toBe(false);
    expect(nextPull).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(s.write).not.toHaveBeenCalled();
  });

  it("未取消时用量元数据完整保留，正文仍隐藏，项目记忆正常写入", async () => {
    const s = await setup();
    expect(await s.run({ async *stream() {
      yield { type: "assistant_message", content: "internal distill response" };
      yield usage;
      yield remember;
    } })).toEqual({ kind: "saved", writes: 1, asks: 0 });
    const events = await s.read();
    expect(events.filter((event) => event.type === "usage")).toEqual([usage]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.filter((event) => event.type === "tool_result")).toMatchObject([{ callId: "memory-1", ok: true }]);
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(s.approve).not.toHaveBeenCalled();
  });

  it.each(["text", "tool"] as const)("取消后收到 %s：不投递正文、不执行工具、不追拉未来用量", async (kind) => {
    const s = await setup();
    const nextPull = vi.fn();
    const close = vi.fn();
    expect(await s.run({ async *stream() {
      try {
        s.controller.abort(new Error("cancel before output"));
        yield kind === "tool" ? remember : { type: "assistant_message" as const, content: "late text" };
        nextPull();
        yield usage;
      } finally { close(); }
    } })).toEqual({ kind: "failed", why: "cancel before output" });
    expect(await s.read()).toMatchObject([{ type: "user_message", content: "remember preference" }]);
    expect(nextPull).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(s.write).not.toHaveBeenCalled();
  });
});
