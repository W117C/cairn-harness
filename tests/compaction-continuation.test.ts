import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, replay, type AgentEvent, type CompactionEvent, type SessionView } from "../src/events";
import { createMockSummarizer, extractFilePaths, extractTriedRejected, runCompaction } from "../src/agent/compaction";
import { projectContext } from "../src/agent/context";
import { projectViewContext } from "../src/agent/session-view-context";
import { createSessionProvider } from "../src/agent/session-provider";
import { withAgentId } from "../src/agent/worker-projection";

const CONFIG = { inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200, retryBackoffMs: 1 };
const SUMMARY = "## Work State\n- 已决定保留兼容接口；旧方案 pnpm test --legacy 已失败。";
const say = (content: string): AgentEvent => ({ type: "assistant_message", content });
const call = (id: string, name: string, args: Record<string, unknown>): AgentEvent => ({ type: "tool_call", id, name, args });
const fail = (callId: string, output: string): AgentEvent => ({ type: "tool_result", callId, ok: false, output, exitCode: 1 });

function prior(summary: string): CompactionEvent {
  return { type: "compaction", trigger: "auto", reason: "threshold", compressed_event_ids: [2], summary, summary_offset: 3, tokens_before: 1000, tokens_after: 100 };
}

describe("压缩后续跑保留事实", () => {
  it("常规摘要之后 overflow 仍保留旧摘要，并传给下一次摘要器", async () => {
    const initial: AgentEvent[] = [
      { type: "user_message", content: "保留兼容接口并完成修复" },
      say("旧调查记录 ".repeat(1000)),
      say("最近一条消息"),
    ];
    const compacted = await runCompaction({ events: initial, trigger: "auto", reason: "threshold", summarizer: createMockSummarizer(SUMMARY), config: CONFIG });
    if (!compacted.ok) throw new Error(compacted.why);
    expect(compacted.event.summary).toContain(SUMMARY);

    const events: AgentEvent[] = [...initial, compacted.event, ...Array.from({ length: 6 }, (_, i) => say("后续调查 " + i + " ".repeat(2000)))];
    const overflow = await runCompaction({ events, trigger: "overflow", reason: "hard_buffer", config: CONFIG });
    if (!overflow.ok) throw new Error(overflow.why);
    const projected = JSON.stringify(projectContext([...events, overflow.event]));
    expect(projected).toContain("已决定保留兼容接口");
    expect(projected).toContain("pnpm test --legacy");
    expect(projected.split("已决定保留兼容接口")).toHaveLength(2);
    expect(overflow.event.tokens_after).toBeLessThan(overflow.event.tokens_before);

    let receivedPrior: string | undefined;
    await runCompaction({
      events: [...events, overflow.event, say("下一轮调查 ".repeat(1000))], trigger: "manual", reason: "user_request", config: CONFIG,
      summarizer: async (input) => { receivedPrior = input.priorSummary; return { text: "## Work State\n- 继续修复" }; },
    });
    expect(receivedPrior).toContain(SUMMARY);
  });

  it("来源视图 overflow 保留祖先摘要，且不继承 worker 的摘要", async () => {
    const session = { workspace: "/workspace", sessionId: "child" };
    const parentRef = { ...session, sessionId: "parent", eventId: 3 };
    const events: AgentEvent[] = [{ type: "user_message", content: "继续" }, ...Array.from({ length: 6 }, () => say("本地调查 ".repeat(1000)))];
    const view: SessionView = {
      session, localEvents: events,
      entries: [
        { event: prior(SUMMARY), ref: parentRef, inherited: true },
        { event: { ...prior("worker 私有摘要"), agent_id: "w1" }, ref: { ...parentRef, eventId: 4 }, inherited: true },
        ...events.map((event, i) => ({ event, ref: { ...session, eventId: i + 1 }, inherited: false })),
      ],
    };
    const overflow = await runCompaction({ events, view, trigger: "overflow", reason: "hard_buffer", config: CONFIG });
    if (!overflow.ok) throw new Error(overflow.why);
    const after: SessionView = {
      ...view, localEvents: [...events, overflow.event],
      entries: [...view.entries, { event: overflow.event, ref: { ...session, eventId: events.length + 1 }, inherited: false }],
    };
    const projected = JSON.stringify(projectViewContext(after));
    expect(projected).toContain("已决定保留兼容接口");
    expect(projected).not.toContain("worker 私有摘要");
    expect(overflow.event.superseded_summary_refs).toEqual([parentRef]);
  });

  it("连续 overflow 不复制或丢失已有事实", async () => {
    let events: AgentEvent[] = [{ type: "user_message", content: "继续" }, say("已压掉的正文"), prior(SUMMARY), ...Array.from({ length: 12 }, () => say("调查 ".repeat(1000)))];
    for (let n = 0; n < 2; n++) {
      const overflow = await runCompaction({ events, trigger: "overflow", reason: "hard_buffer", config: CONFIG });
      if (!overflow.ok) throw new Error(overflow.why);
      events = [...events, overflow.event];
      const projected = JSON.stringify(projectContext(events));
      expect(projected.split("已决定保留兼容接口")).toHaveLength(2);
    }
  });

  it("旧摘要本身已超预算时保留事实，并由最终硬闸明确失败而不循环或发请求", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-compaction-continuation-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    try {
      const largeSummary = SUMMARY + "\n" + "必须保留的历史事实 ".repeat(2000);
      for (const event of [{ type: "user_message", content: "继续" } as AgentEvent, say("旧正文"), prior(largeSummary), ...Array.from({ length: 6 }, () => say("新调查 ".repeat(1000)))]) await log.append(event);
      await log.close?.();
      let calls = 0;
      const provider = createSessionProvider(logPath, {
        workspace: dir, map: false,
        transport: async function* () { calls++; yield { type: "assistant_delta" as const, callId: "unreachable", text: "ok" }; },
        compaction: { config: CONFIG },
      });
      await expect(async () => { for await (const _ of provider.stream([], [])) { /* consume */ } }).rejects.toThrow(/context_budget_exceeded/);
      expect(calls).toBe(0);
      const compactions = (await replay(logPath)).filter((e): e is CompactionEvent => e.type === "compaction");
      expect(compactions).toHaveLength(2); // 一份原摘要 + 一次 overflow，无内部重试环
      expect(compactions[1]?.summary).toContain(largeSummary);
    } finally {
      await log.close?.();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("失败记忆按 worker 归因匹配调用", () => {
  it("父会话和两个 worker 复用 callId 时各自保留正确命令", () => {
    const events = [
      call("same", "run_shell", { command: "pnpm parent" }), fail("same", "parent error"),
      withAgentId(call("same", "run_shell", { command: "pnpm worker-one" }), "w1"), withAgentId(fail("same", "worker-one error"), "w1"),
      withAgentId(call("same", "run_shell", { command: "pnpm worker-two" }), "w2"), withAgentId(fail("same", "worker-two error"), "w2"),
    ];
    const bullets = extractTriedRejected(events);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toContain("pnpm parent 失败");
    expect(bullets[0]).not.toContain("〔worker:");
    expect(bullets[1]).toContain("pnpm worker-one 失败");
    expect(bullets[1]).toContain("〔worker:w1〕");
    expect(bullets[2]).toContain("pnpm worker-two 失败");
    expect(bullets[2]).toContain("〔worker:w2〕");
  });

  it("worker 孤儿回执不能借用同号父调用", () => {
    const bullets = extractTriedRejected([
      call("same", "run_shell", { command: "pnpm parent" }),
      withAgentId(fail("same", "worker error"), "w1"),
    ]);
    expect(bullets[0]).toContain("工具名不在压缩范围内");
    expect(bullets[0]).not.toContain("pnpm parent");
  });

  it("同号 plan 提案及拒绝按归因配对，worker 拒绝保留归属", () => {
    const proposed = (approach: string): AgentEvent => ({ type: "plan_proposed", callId: "same", plan: { goal: "修复", files: [], approach } }) as AgentEvent;
    const rejected: AgentEvent = { type: "plan_approved", callId: "same", approved: false } as AgentEvent;
    const bullets = extractTriedRejected([
      proposed("父方案"), rejected,
      { ...proposed("子方案"), agent_id: "w1" } as AgentEvent,
      { ...rejected, agent_id: "w1" } as AgentEvent,
    ]);
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toContain("父方案");
    expect(bullets[0]).not.toContain("子方案");
    expect(bullets[1]).toContain("子方案");
    expect(bullets[1]).toContain("〔worker:w1〕");
  });
});

describe("主摘要辅助取料排除 worker 内部流", () => {
  it.each([
    ["run_shell", { command: "worker-private" }],
    ["read_file", { path: "worker-private.md" }],
  ] as const)("worker 同号 %s 不覆盖父回执的类型与参数", async (name, args) => {
    const output = ["// 普通行".repeat(40), ...Array.from({ length: 20 }, () => "// filler ".repeat(20)), "export function parentSignature() {}", ...Array.from({ length: 40 }, () => "// 尾部填充 ".repeat(20))].join("\n");
    const events: AgentEvent[] = [
      { type: "user_message", content: "调查父代码" },
      call("same", "read_file", { path: "src/parent.ts" }),
      { type: "tool_result", callId: "same", ok: true, output },
      withAgentId(call("same", name, args), "w1"),
      withAgentId({ type: "tool_result", callId: "same", ok: true, output: "worker-private" }, "w1"),
      say("后续调查 ".repeat(1000)),
    ];
    let conversation = "";
    const result = await runCompaction({
      events, trigger: "manual", reason: "user_request", config: CONFIG,
      summarizer: async (input) => { conversation = input.conversation; return { text: "## Work State\n- 继续" }; },
    });
    expect(result.ok).toBe(true);
    expect(conversation).toContain("export function parentSignature() {}");
    expect(conversation).not.toContain("worker-private");
  });

  it("Files 兜底保留父文件，不把 worker 私有读写/补丁路径列成主会话文件", () => {
    const files = extractFilePaths([
      call("p", "edit_file", { path: "src/parent.ts" }),
      ...["read_file", "write_file", "edit_file"].map((name) => withAgentId(call(name, name, { path: name + ".ts" }), "w1")),
      withAgentId(call("patch", "apply_patch", { patch: "*** Begin Patch\n*** Add File: worker-private.ts\n+x\n*** End Patch" }), "w1"),
    ]);
    expect(files).toEqual([{ path: "src/parent.ts", action: "改" }]);
  });
});
