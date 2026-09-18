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

/* ---- 能力 5 收束闸：写过盘就必须留下验证证据（此前只有提示词里的「修改完成后调用 verify」）----
   注：自动拍只落证据、不注入模型上下文——没有配对的 tool_call 就没有合法注入通道
  （裸 tool_result 会让 provider 侧 tool 消息失去前置 tool_calls 而 400；合成 tool_call 违反
   action-fusion 明写的「no extra tool calls」不变量）。要「验证失败自动返修」需要先裁一条
   harness→模型的注入通道，见 BLOCKED 立案。 */
describe("auto-verify on completion (harness 补拍，证据 only)", () => {
  const failHook = { async run() { return { ok: false as const, results: [{ command: "pnpm test", ok: false as const, output: "1 failed" }] }; } };
  const okHook = { async run() { return { ok: true as const, results: [{ command: "pnpm test", ok: true as const, output: "4 passed" }] }; } };

  /** 剧本：第 1 请求写盘成功，之后每请求都是纯文本（模型自认为收工）。 */
  async function runWritesFirst(opts: Partial<LoopOptions> = {}, script?: (n: number) => ModelOutput | null) {
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    await runLoop({
      workspace: "/tmp",
      userMessage: "fix the bug",
      mode: "auto",
      interactive: true,
      events: { async append(event) { log.push(event); } },
      tools: { write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } } },
      provider: {
        async *stream(messages) {
          requests.push(messages);
          if (requests.length === 1) yield { type: "tool_call", id: "w1", name: "write_file", args: { path: "a.ts" } };
          else if (script) { const o = script(requests.length); if (o) yield o; }
        },
      },
      ...opts,
    });
    return { log, requests };
  }

  it("写盘后纯文本收束 → 补一拍并把红字落进事件流（零额外模型调用）", async () => {
    const { log, requests } = await runWritesFirst({ verify: failHook, autoVerify: true });
    expect(log.filter((e) => e.type === "verify_result")).toMatchObject([
      { type: "verify_result", callId: "harness-auto-verify", ok: false, auto: true, attempt: 1 },
    ]);
    expect(requests).toHaveLength(2); // 证据拍不偷要一轮模型
    expect(log.filter((e) => e.type === "tool_result")).toHaveLength(1); // 只有一拍 = 写盘本身
    expect(log.some((e) => e.type === "tool_call" && e.name === "verify")).toBe(false); // 不合成工具调用
  });

  it("每 run 至多一拍：自动拍红字后模型仍纯文本收束 ⇒ 不叠加", async () => {
    const { log, requests } = await runWritesFirst({ verify: failHook, autoVerify: true });
    expect(log.filter((e) => e.type === "verify_result" && e.auto === true)).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("自动拍验证通过 → 绿证据落流", async () => {
    const { log } = await runWritesFirst({ verify: okHook, autoVerify: true });
    expect(log.some((e) => e.type === "verify_result" && e.auto === true && e.ok)).toBe(true);
  });

  it("模型自调过 verify ⇒ harness 让位，且手动拍事件形态零变化（连 auto 键都不出现）", async () => {
    const { log, requests } = await runWritesFirst({ verify: okHook, autoVerify: true }, (n) =>
      n === 2 ? ({ type: "tool_call", id: "v1", name: "verify", args: {} } as ModelOutput) : null);
    const beats = log.filter((e) => e.type === "verify_result");
    expect(beats).toHaveLength(1);
    expect("auto" in (beats[0] as object)).toBe(false);
    expect(requests).toHaveLength(2); // verify 通过即停
  });

  it("可验面探测炸（config 存在但 JSON 坏）⇒ 不炸 run、不补拍", async () => {
    const boom = { surface: async () => { throw new SyntaxError("Unexpected token 'I'"); }, run: async () => ({ ok: false as const, results: [] }) };
    const { log } = await runWritesFirst({ verify: boom, autoVerify: true });
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(0);
  });

  it.each([
    { label: "未写盘（只读动作）", call: "read_file", opts: {} },
    { label: "仓库无 verify 面（surface=false）", call: "write_file", opts: { verify: { surface: async () => false, run: async () => ({ ok: false as const, results: [] }) } } },
    { label: "缺省不开闸（未给 autoVerify）", call: "write_file", opts: { verify: failHook } },
    { label: "显式 autoVerify:false", call: "write_file", opts: { verify: failHook, autoVerify: false } },
  ])("零行为回退：$label → 无 verify_result、请求数与旧行为同形", async ({ call, opts }) => {
    const log: AgentEvent[] = [];
    const requests: ProviderMessage[][] = [];
    await runLoop({
      workspace: "/tmp", userMessage: "t", mode: "auto", interactive: true,
      events: { async append(e) { log.push(e); } },
      tools: {
        read_file: { name: "read_file", async run() { return { ok: true, output: "x" }; } },
        write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } },
      },
      provider: {
        async *stream(messages) {
          requests.push(messages);
          if (requests.length === 1) yield { type: "tool_call", id: "c1", name: call, args: {} };
        },
      },
      ...opts,
    });
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(0);
    expect(requests).toHaveLength(2);
  });
});
