import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import { projectContext } from "../src/agent/context";
import type { AgentEvent } from "../src/events";
import type { ModelOutput, Provider, ProviderMessage } from "../src/providers";

describe("loop context feedback", () => {
  it("includes persisted tool results exactly once in the next provider request", async () => {
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    const provider: Provider = {
      async *stream(messages) {
        requests.push(messages);
        if (requests.length === 1) {
          yield { type: "tool_call", id: "read-1", name: "read_file", args: { path: "note.txt" } };
        }
      },
    };
    await runLoop({
      provider,
      events: { async append(event) { log.push(event); } },
      workspace: "/tmp",
      userMessage: "Read the note",
      tools: {
        read_file: {
          name: "read_file",
          async run() { return { ok: true, output: "FEEDBACK_SENTINEL" }; },
        },
      },
    });

    expect(requests).toHaveLength(2);
    expect(log.filter((event) => event.type === "tool_result")).toHaveLength(1);
    expect(requests[1]).toEqual(projectContext(log));
    expect(requests[1]?.filter((message) => message.role === "tool")).toEqual([
      { role: "tool", tool_call_id: "read-1", content: "FEEDBACK_SENTINEL" },
    ]);
  });

  it.each([
    { label: "failure", name: "read_file", options: {}, output: "TOOL_FAILURE" },
    { label: "permission denial", name: "write_file", options: { mode: "read-only" }, output: "[permission denied]" },
    { label: "tool table denial", name: "read_file", options: { allowedTools: [] }, output: "[tool table]" },
    { label: "unknown tool", name: "absent", options: {}, output: "unknown tool" },
    { label: "missing verify hook", name: "verify", options: {}, output: "fail-closed" },
    {
      label: "verify exception", name: "verify",
      options: { verify: { async run(): Promise<never> { throw new Error("VERIFY_FAILURE"); } } },
      output: "VERIFY_FAILURE",
    },
  ] satisfies { label: string; name: string; options: Partial<LoopOptions>; output: string }[])(
    "returns $label to the model without duplicate history",
    async ({ name, options, output }) => {
      const log: AgentEvent[] = [];
      const requests: ProviderMessage[][] = [];
      await runLoop({
        workspace: "/tmp",
        events: { async append(event) { log.push(event); } },
        tools: { read_file: { name: "read_file", async run() { throw new Error("TOOL_FAILURE"); } } },
        provider: {
          async *stream(messages) {
            requests.push(messages);
            if (requests.length === 1) yield { type: "tool_call", id: "c1", name, args: {} };
          },
        },
        ...options,
      });
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(projectContext(log));
      const results = requests[1]!.filter((message) => message.role === "tool");
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toContain(output);
    },
  );

  it("includes tool-emitted events in persisted order", async () => {
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    await runLoop({
      workspace: "/tmp",
      events: { async append(event) { log.push(event); } },
      provider: {
        async *stream(messages) {
          requests.push(messages);
          if (requests.length === 1) yield { type: "tool_call", id: "c1", name: "read_file", args: {} };
        },
      },
      tools: {
        read_file: {
          name: "read_file",
          async run(_args, ctx) {
            await ctx.emit?.({ type: "assistant_message", content: "EMITTED" });
            return { ok: true, output: "RESULT" };
          },
        },
      },
    });
    expect(requests[1]).toEqual(projectContext(log));
    expect(requests[1]?.map((message) => message.content)).toEqual([null, "EMITTED", "RESULT"]);
  });

  it("does not request another turn after cancellation", async () => {
    const abort = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const log: AgentEvent[] = [];
    await runLoop({
      workspace: "/tmp",
      signal: abort.signal,
      events: { async append(event) { log.push(event); } },
      provider: {
        async *stream(_messages, _tools, call): AsyncGenerator<ModelOutput> {
          signals.push(call?.signal);
          yield { type: "tool_call", id: "c1", name: "read_file", args: {} };
        },
      },
      tools: {
        read_file: {
          name: "read_file",
          async run(_args, ctx) {
            expect(ctx.signal).toBe(abort.signal);
            abort.abort();
            return { ok: false, output: "cancelled" };
          },
        },
      },
    });
    expect(signals).toEqual([abort.signal]);
    expect(log.at(-1)).toEqual({ type: "tool_result", callId: "c1", ok: false, output: "cancelled" });
  });
});
