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
    // 2026-10-19：自动拍也落配对 tool_result（写盘 1 + 自动验证 1），否则下一轮投影会伪造成
    // 「工具调用没有收到结果 ⇒ 上次运行中途结束」。
    expect(log.filter((e) => e.type === "tool_result")).toHaveLength(2);
    expect(log.some((e) => e.type === "tool_result" && e.output.includes("自动验证未通过"))).toBe(true);
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

  it("可验面探测炸（config 存在但 JSON 坏）⇒ 不炸 run、不补拍，但必须出声", async () => {
    const boom = { surface: async () => { throw new SyntaxError("Unexpected token 'I'"); }, run: async () => ({ ok: false as const, results: [] }) };
    const { log } = await runWritesFirst({ verify: boom, autoVerify: true });
    const beats = log.filter((e) => e.type === "verify_result");
    // 原判据钉 `toHaveLength(0)`，而生产在 loop.ts 里改成**出声**（那里注释写明了理由：
    // 「fail-closed 口径与 manual 对齐：探测失败是一次坏的 verify 证据，必须进事件流，
    // 否则审计面看不到『该验没验』」）。两个版本都已入库 ⇒ 这是判卷与实现的真不一致，必须收口。
    // 收在**用例名的原意**上，那两件没有被放宽：
    //   · 不炸 run：runWritesFirst 正常返回（抛错收场的话这条会以异常失败，不是断言失败）；
    //   · 不补拍：只有这一拍，且它是**环境拍**（cause=hook-error、带 auto 标记）——
    //     环境拍不烧模型的修复额度，因此不会引出返修那一轮。
    expect(beats).toHaveLength(1);
    expect(beats[0]?.cause).toBe("hook-error");
    expect(beats[0]?.auto).toBe(true);
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

// 工具表硬闸必须**先于** verify 反射循环。spec §6 W4（orchestration-design:96）点名过这条潜在洞：
// 今天 worker 不传 verify 钩子（orchestrator.ts:1473-1482）所以没暴露，一旦按 W4a 给 worker 接上
// 收束闸，「表里没有 verify 却能执行 verify」就成权限旁路——三重闸（规格/实例/loop 白名单）各管各的，
// 系统门「优先于权限门」的那句注释不能顺手把工具表也越过。
describe("allowedTools 硬闸与 verify 系统门的次序", () => {
  async function callVerify(over: Partial<LoopOptions>): Promise<{ log: AgentEvent[]; hookRuns: number }> {
    const log: AgentEvent[] = [];
    let hookRuns = 0;
    let calls = 0;
    const hook = {
      maxAttempts: 3,
      surface: async () => true,
      run: async () => {
        hookRuns++;
        return { ok: true as const, results: [] };
      },
    };
    await runLoop({
      workspace: "/tmp",
      userMessage: "t",
      mode: "auto",
      events: { async append(e) { log.push(e); } },
      provider: {
        async *stream() {
          calls++;
          if (calls === 1) yield { type: "tool_call", id: "v1", name: "verify", args: {} };
        },
      },
      verify: hook,
      ...over,
    });
    return { log, hookRuns };
  }

  it("表内没有 verify ⇒ 钩子一次都不执行，按工具表摘除拒绝", async () => {
    const { log, hookRuns } = await callVerify({ allowedTools: ["read_file"] });
    expect(hookRuns).toBe(0);
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(0);
    const refused = log.find(
      (e) => e.type === "tool_result" && (e as { output: string }).output.includes("不在本会话工具表"),
    ) as Extract<AgentEvent, { type: "tool_result" }> | undefined;
    expect(refused).toBeDefined();
    expect(refused!.ok).toBe(false);
    expect(refused!.callId).toBe("v1"); // 拒绝挂回原调用，模型才换得了路
  });

  it("表内有 verify ⇒ 系统门照旧执行（反向锁：修法不是一律禁掉 verify）", async () => {
    const { log, hookRuns } = await callVerify({ allowedTools: ["verify"] });
    expect(hookRuns).toBe(1);
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(1);
  });

  it("未给工具表（主会话形状）⇒ 行为逐字不变", async () => {
    const { hookRuns } = await callVerify({});
    expect(hookRuns).toBe(1);
  });
});

describe("resolveTool 补表钩子（run 中途才出现的工具，2026-10-19）", () => {
  /** 起点快照里没有 `mcp__x__y`，钩子在**每一次查表前**现问一次——
   *  这正是 provider 的 requestFace 逐请求重算所需要的对称一手：
   *  模型面看得见（读活引用），执行面也必须动得了，否则落到 `unknown tool`。 */
  it("静态表里没有、钩子给得出 ⇒ 照常执行（模型看到的 ≠ 能执行的，这条堵住后半句）", async () => {
    const log: AgentEvent[] = [];
    let sent = false;
    const ran: string[] = [];
    let asked = 0;
    await runLoop({
      provider: {
        async *stream() {
          // 只发一次：provider 是会话型，每轮都会重放同一份 stream ⇒ 不设闸会一路撞到 maxSteps
          if (!sent) { sent = true; yield { type: "tool_call", id: "c1", name: "mcp__plugin_x__srv__t", args: {} }; }
        },
      },
      events: { async append(event) { log.push(event); } },
      workspace: "/tmp",
      userMessage: "call the late tool",
      resolveTool: (name) => {
        asked++;
        if (name !== "mcp__plugin_x__srv__t") return undefined;
        return { name, async run() { ran.push(name); return { ok: true, output: "LATE_TOOL_OK" }; } };
      },
    });
    expect(asked, "钩子必须在查表时真被问到（没问 = 这一手根本没接上）").toBeGreaterThan(0);
    expect(ran).toEqual(["mcp__plugin_x__srv__t"]);
    const result = log.find((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }> | undefined;
    expect(result?.output).toBe("LATE_TOOL_OK");
  });

  it("钩子也拿不到 ⇒ 仍是 unknown tool（补表不放行未注册工具，fail-closed 不变）", async () => {
    const log: AgentEvent[] = [];
    let sent = false;
    await runLoop({
      provider: {
        async *stream() {
          // 只发一次：provider 是会话型，每轮都会重放同一份 stream ⇒ 不设闸会一路撞到 maxSteps
          if (!sent) { sent = true; yield { type: "tool_call", id: "c1", name: "mcp__plugin_x__srv__t", args: {} }; }
        },
      },
      events: { async append(event) { log.push(event); } },
      workspace: "/tmp",
      userMessage: "call the absent tool",
      resolveTool: () => undefined,
    });
    const result = log.find((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }> | undefined;
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("unknown tool");
  });

  it("反向（突变体专破）：把 `?? opts.resolveTool?.(name)` 从 loop 里拆掉 ⇒ 第一条必须红在这儿", async () => {
    // 这一条不是恒真：判据若不再回落到钩子，下面这个 ran 会是空数组。
    const ran: string[] = [];
    let sent = false;
    await runLoop({
      provider: {
        async *stream() {
          if (!sent) { sent = true; yield { type: "tool_call", id: "c1", name: "only_in_hook", args: {} }; }
        },
      },
      events: { async append() {} },
      workspace: "/tmp",
      userMessage: "call the hooked tool",
      resolveTool: (name) => ({ name, async run() { ran.push(name); return { ok: true, output: "ok" }; } }),
    });
    expect(ran, "loop 必须回落到 resolveTool；断了这一手，run 中途批准的插件就永远 unknown tool").toEqual(["only_in_hook"]);
  });
});
