import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DistillOptions } from "../src/agent/memory/distill";
import type { ToolCallEvent } from "../src/events";
import type { Provider } from "../src/providers";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const remember: ToolCallEvent = {
  type: "tool_call", id: "memory-1", name: "remember",
  args: { scope: "project", kind: "memory", type: "user", topic: "language", content: "prefer Chinese" },
};

async function setup() {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "distill-completion-"));
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

describe("沉淀轮流收束时仍须核对取消", () => {
  it.each([false, true])("最后一次 next 以 done 结束时取消，已有写入=%s：不能冒充正常完成", async (saved) => {
    const s = await setup();
    const close = vi.fn();
    const outcome = await s.run({ async *stream() {
      try {
        if (saved) yield remember;
        s.controller.abort(new Error("cancel on stream completion"));
      } finally { close(); }
    } });
    expect(outcome).toEqual({ kind: "failed", why: "cancel on stream completion" });
    expect(s.write).toHaveBeenCalledTimes(saved ? 1 : 0);
    const results = (await s.read()).filter((event) => event.type === "tool_result");
    expect(results).toHaveLength(saved ? 1 : 0);
    if (saved) expect(results[0]).toMatchObject({ callId: "memory-1", ok: true, output: "saved" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["saved", "rejected", "write-error"] as const)("%s 回执落盘期间取消：立即关闭流，回执只保留真实结果", async (kind) => {
    const s = await setup();
    const nextPull = vi.fn();
    const close = vi.fn();
    let call = remember;
    if (kind === "rejected") {
      call = { ...remember, args: { ...remember.args, scope: "global" } };
      s.approve.mockResolvedValueOnce(false);
    }
    if (kind === "write-error") s.write.mockRejectedValueOnce(new Error("write failed"));
    const outcome = await s.run({ async *stream() {
      try {
        yield call;
        nextPull();
        yield { ...remember, id: "must-not-run" };
      } finally { close(); }
    } }, { emit: async (event) => {
      await s.log.append(event);
      if (event.type === "tool_result") s.controller.abort(new Error("cancel during receipt"));
    } });
    expect(outcome).toEqual({ kind: "failed", why: "cancel during receipt" });
    expect(nextPull).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    const results = (await s.read()).filter((event) => event.type === "tool_result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ callId: "memory-1", ok: kind === "saved" });
    if (kind === "saved") expect(results[0]?.output).toBe("saved");
    if (kind === "write-error") expect(results[0]?.output).toBe("write failed");
    expect(s.write).toHaveBeenCalledTimes(kind === "saved" || kind === "write-error" ? 1 : 0);
  });

  it("已经开始的写入在取消后完成：成功回执保留，不再请求下一笔模型输出", async () => {
    const s = await setup();
    const nextPull = vi.fn();
    const close = vi.fn();
    s.write.mockImplementationOnce(async () => {
      s.controller.abort(new Error("cancel during started write"));
      return { ok: true, output: "saved before stopping" };
    });
    expect(await s.run({ async *stream() {
      try {
        yield remember;
        nextPull();
      } finally { close(); }
    } })).toEqual({ kind: "failed", why: "cancel during started write" });
    expect(s.write).toHaveBeenCalledTimes(1);
    expect((await s.read()).filter((event) => event.type === "tool_result"))
      .toMatchObject([{ callId: "memory-1", ok: true, output: "saved before stopping" }]);
    expect(nextPull).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("未取消、已有写入=%s：正常返回原有结局", async (saved) => {
    const s = await setup();
    expect(await s.run({ async *stream() { if (saved) yield remember; } }))
      .toEqual(saved ? { kind: "saved", writes: 1, asks: 0 } : { kind: "no_content" });
    expect(s.write).toHaveBeenCalledTimes(saved ? 1 : 0);
  });
});
