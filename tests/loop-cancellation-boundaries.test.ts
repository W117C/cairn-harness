import { describe, expect, it, vi } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";

const write: ModelOutput = { type: "tool_call", id: "write", name: "write_file", args: { path: "a.txt", content: "a" } };
const done: ModelOutput = { type: "assistant_message", content: "done" };
const base = { workspace: "/tmp", mode: "auto" as const };

describe("取消在流、日志和钩子等待后仍须生效", () => {
  it("保留已开始工具的真实结果，关闭当前流，不再拉取文字、验证或新工具，也不启动后置钩子", async () => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    let closed = false;
    let tailPulls = 0;
    const verify = vi.fn(async () => ({ ok: true as const, results: [] }));
    const laterTool = vi.fn(async () => ({ ok: true, output: "late" }));
    const hook = vi.fn(async (_event: string) => ({ blocked: false, additionalContext: "" }));
    const provider: Provider = {
      async *stream() {
        try {
          yield write;
          tailPulls++;
          yield { type: "assistant_delta", callId: "reply", text: "stale text after cancel" };
          yield { type: "tool_call", id: "late", name: "read_file", args: { path: "a.txt" } };
          yield { type: "tool_call", id: "verify", name: "verify", args: {} };
          yield done;
        } finally { closed = true; }
      },
    };
    await runLoop({
      ...base, provider, signal: controller.signal,
      events: { async append(event) { log.push(event); } },
      tools: {
        write_file: { name: "write_file", async run() { controller.abort(); return { ok: true, output: "already written" }; } },
        read_file: { name: "read_file", run: laterTool },
      },
      hooks: { run: hook } as unknown as NonNullable<LoopOptions["hooks"]>,
      verify: { run: verify },
    });
    expect(log).toEqual([write, { type: "tool_result", callId: "write", ok: true, output: "already written" }]);
    expect(closed).toBe(true);
    expect(tailPulls).toBe(0);
    expect(verify).not.toHaveBeenCalled();
    expect(laterTool).not.toHaveBeenCalled();
    expect(hook.mock.calls.map(([event]) => event)).toEqual(["PreToolUse"]);
  });

  it.each([
    { type: "assistant_delta", callId: "reply", text: "stale delta" },
    done,
    write,
  ] satisfies ModelOutput[])("等待下一块时取消：不落盘迟到的 $type，且关闭流", async (output) => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const execute = vi.fn(async () => ({ ok: true, output: "unexpected" }));
    let closed = false;
    await runLoop({
      ...base, signal: controller.signal,
      events: { async append(event) { log.push(event); } },
      tools: { write_file: { name: "write_file", run: execute } },
      provider: {
        async *stream() {
          try {
            await Promise.resolve();
            controller.abort();
            yield output;
          } finally { closed = true; }
        },
      },
    });
    expect(log).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(closed).toBe(true);
  });

  it.each(["write_file", "verify"])("写入 %s 调用日志时取消：补齐取消回执，不启动工具或系统验证门", async (name) => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const execute = vi.fn(async () => ({ ok: true, output: "unexpected" }));
    const verify = vi.fn(async () => ({ ok: true as const, results: [] }));
    await runLoop({
      ...base, signal: controller.signal,
      events: { async append(event) { log.push(event); if (event.type === "tool_call") controller.abort(); } },
      provider: { async *stream() { yield { ...write, name }; } },
      tools: { write_file: { name: "write_file", run: execute } }, verify: { run: verify },
    });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ type: "tool_call", id: "write", name });
    expect(log[1]).toMatchObject({ type: "tool_result", callId: "write", ok: false });
    expect(log[1]?.type === "tool_result" && log[1].output).toContain("cancelled");
    expect(execute).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("PreToolUse 等待期间取消：不执行工具，调用仍有配对取消回执", async () => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const execute = vi.fn(async () => ({ ok: true, output: "unexpected" }));
    const hook = vi.fn(async () => { controller.abort(); return { blocked: false, additionalContext: "" }; });
    await runLoop({
      ...base, signal: controller.signal,
      events: { async append(event) { log.push(event); } },
      provider: { async *stream() { yield write; } },
      tools: { write_file: { name: "write_file", run: execute } },
      hooks: { run: hook } as unknown as NonNullable<LoopOptions["hooks"]>,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ type: "tool_result", callId: "write", ok: false });
  });

  it("流自然结束时取消：不启动自动验证，不误报 maxSteps 耗尽", async () => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const verify = vi.fn(async () => ({ ok: true as const, results: [] }));
    const run = runLoop({
      ...base, maxSteps: 1, signal: controller.signal, autoVerify: true,
      events: { async append(event) { log.push(event); } },
      provider: { async *stream() { yield write; controller.abort(); } },
      tools: { write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } } },
      verify: { run: verify },
    });
    await expect(run).resolves.toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ type: "tool_result", ok: true, output: "written" });
  });

  it("自动验证可验面探测期间取消：不再启动验证命令", async () => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const verify = vi.fn(async () => ({ ok: true as const, results: [] }));
    let requests = 0;
    await runLoop({
      ...base, signal: controller.signal, autoVerify: true,
      events: { async append(event) { log.push(event); } },
      provider: { async *stream() { if (++requests === 1) yield write; } },
      tools: { write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } } },
      verify: { surface: async () => { controller.abort(); return true; }, run: verify },
    });
    expect(verify).not.toHaveBeenCalled();
    expect(log.some((event) => event.type === "verify_result")).toBe(false);
  });

  it("未取消的同样流程仍保留完整输出并执行自动验证", async () => {
    const log: AgentEvent[] = [];
    const verify = vi.fn(async () => ({ ok: true as const, results: [] }));
    let requests = 0;
    await runLoop({
      ...base, autoVerify: true,
      events: { async append(event) { log.push(event); } },
      provider: { async *stream() { if (++requests === 1) { yield write; yield done; } } },
      tools: { write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } } },
      verify: { surface: async () => true, run: verify },
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(log).toContainEqual(done);
    expect(log.filter((event) => event.type === "verify_result")).toMatchObject([{ ok: true, auto: true }]);
  });

  it("取消时已经收到的真实 usage 仍记账，随后立即关闭流", async () => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const usage: ModelOutput = { type: "usage", inputTokens: 123, outputTokens: 45 };
    let tailPulls = 0;
    let closed = false;
    await runLoop({
      ...base, signal: controller.signal,
      events: { async append(event) { log.push(event); } },
      provider: {
        async *stream() {
          try {
            controller.abort();
            yield usage;
            tailPulls++;
            yield done;
          } finally { closed = true; }
        },
      },
    });
    expect(log).toEqual([usage]);
    expect(tailPulls).toBe(0);
    expect(closed).toBe(true);
  });

  it.each([true, false])("最后一轮自动验证完成（ok=%s）时取消：保留结果，不误报 maxSteps", async (ok) => {
    const controller = new AbortController();
    const log: AgentEvent[] = [];
    const verify = vi.fn(async () => ({ ok, results: [{ command: "test", ok, output: ok ? "passed" : "assertion failed", cause: "code" as const }] }));
    const run = runLoop({
      ...base, maxSteps: 1, signal: controller.signal, autoVerify: true, autoVerifyRepair: true,
      events: { async append(event) { log.push(event); if (event.type === "verify_result") controller.abort(); } },
      provider: { async *stream() { yield write; } },
      tools: { write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } } },
      verify: { run: verify },
    });
    await expect(run).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(log.filter((event) => event.type === "verify_result")).toMatchObject([{ ok, auto: true }]);
  });
});
