// 能力 5 的最后一公里：harness 自动验证拍（autoVerify 收束闸）验出的红，下一轮必须回到模型眼前。
// 旧现状两头都是黑的——loop.ts 的自动拍 `if (auto) return "stop"` 不外注（没有合法注入通道：
// 裸 tool_result 会让 provider 侧 tool 消息失去前置 tool_calls 而 400），而 context.ts 又把
// verify_result 整类事件从投影里丢掉 ⇒ 「写过盘但没验过、验出来是红的」这件事，模型永远不知道，
// 只在时间线上给用户看。本测锁住回流通道（投影 = 事件流的纯函数，不新增事件、不冒充模型行为）。
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectContext, type ContextMessage } from "../src/agent/context";
import { estimateTextTokens } from "../src/agent/text-budget";
import { createGlmSessionProvider } from "../src/agent/session-provider";
import { createEventLog } from "../src/events";
import type { GlmMessage } from "../src/providers/glm";
import type { AgentEvent } from "../src/events";

// 记忆注入不是本测要验的面，且它会去读宿主主目录 ⇒ 打桩（与 session-provider.test.ts 同法）
vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));

const autoFail = (cmd: string, output: string, callId = "harness-auto-verify"): AgentEvent => ({
  type: "verify_result",
  callId,
  auto: true,
  ok: false,
  attempt: 1,
  maxAttempts: 3,
  results: [{ command: cmd, ok: false, output }],
});

/** 注入出来的那条「系统补拍」消息（按固定表头认，不靠正文关键词碰运气）。 */
type NoteMsg = ContextMessage & { content: string };
const autoNotes = (msgs: ContextMessage[]): NoteMsg[] =>
  msgs.filter((m): m is NoteMsg => typeof m.content === "string" && m.content.startsWith("[harness 自动验证]"));

const withText = (msgs: ContextMessage[], needle: string): number =>
  msgs.filter((m) => typeof m.content === "string" && m.content.includes(needle)).length;

describe("自动验证拍的红进下一轮上下文", () => {
  it("① 有 auto 的 verify_result(ok:false) ⇒ 按事件位置注入一条含失败命令与输出的消息", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "把标题改成蓝色" },
      { type: "assistant_message", content: "改完了，收尾" },
      autoFail("pnpm test", "AssertionError: expected red\n Tests 1 failed"),
      { type: "user_message", content: "继续下一个任务" },
    ];
    const msgs = projectContext(events);
    const notes = autoNotes(msgs);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content).toContain("[verify FAIL] pnpm test");
    expect(notes[0]!.content).toContain("Tests 1 failed");
    // 位置：红注入在它之后、新指令之前（时序不颠倒）
    const iNote = msgs.indexOf(notes[0]!);
    const iNext = msgs.findIndex((m) => m.content === "继续下一个任务");
    expect(iNote).toBeGreaterThan(-1);
    expect(iNote).toBeLessThan(iNext);
  });

  it("② 手动拍（无 auto 字段）零注入：失败原文只走既有的 tool_result 那一条", () => {
    const digest = "[verify FAIL] pnpm test\nTests 1 failed";
    const events: AgentEvent[] = [
      { type: "user_message", content: "改标题" },
      { type: "tool_call", id: "v1", name: "verify", args: {} },
      { type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, results: [{ command: "pnpm test", ok: false, output: "Tests 1 failed" }] },
      { type: "tool_result", callId: "v1", ok: false, output: digest },
      { type: "user_message", content: "继续" },
    ];
    const msgs = projectContext(events);
    expect(withText(msgs, "[verify FAIL] pnpm test")).toBe(1); // 不是两条：不重复注入同一拍
    expect(autoNotes(msgs)).toHaveLength(0);
    expect(msgs.some((m) => m.role === "tool" && m.content === digest)).toBe(true);
  });

  it("③ 自动拍通过（ok:true）零注入：没红就不占每轮重送的预算", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "改标题" },
      { type: "verify_result", callId: "harness-auto-verify", auto: true, ok: true, attempt: 1, maxAttempts: 3, results: [{ command: "pnpm test", ok: true, output: "All passed" }] },
      { type: "user_message", content: "继续" },
    ];
    expect(autoNotes(projectContext(events))).toHaveLength(0);
  });

  it("④ 多拍只留最新一份全文，旧的折成计数行（同 compaction「只出现最新一份」的口径）", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      autoFail("pnpm test", "第一次红的详情-OLDER"),
      { type: "user_message", content: "r2" },
      autoFail("pnpm lint", "第二次红的详情-NEWEST"),
      { type: "user_message", content: "r3" },
    ];
    const msgs = projectContext(events);
    const notes = autoNotes(msgs);
    expect(notes).toHaveLength(1); // 只注入一条
    expect(notes[0]!.content).toContain("pnpm lint");
    expect(notes[0]!.content).toContain("NEWEST");
    expect(notes[0]!.content).not.toContain("OLDER"); // 旧拍全文不重投
    expect(notes[0]!.content).toContain("另有 1 次"); // 但计数如实（不假装只红过一次）
    // 注入点在最新那拍的位置（r2 之后、r3 之前）
    const iNote = msgs.indexOf(notes[0]!);
    const iR2 = msgs.findIndex((m) => m.content === "r2");
    const iR3 = msgs.findIndex((m) => m.content === "r3");
    expect(iNote).toBeGreaterThan(iR2);
    expect(iNote).toBeLessThan(iR3);
  });

  it("⑤ 帽：超大输出按 token 预算收窄、保住尾部结论行，且失败命令一条不丢", () => {
    const huge = "✓ ok\n".repeat(20000) + "FAIL tests/x.test.ts:1\n Tests 1 failed";
    const events: AgentEvent[] = [
      { type: "user_message", content: "改标题" },
      autoFail("pnpm test", huge),
      { type: "user_message", content: "继续" },
    ];
    const msgs = projectContext(events);
    const notes = autoNotes(msgs);
    expect(notes).toHaveLength(1);
    const body = notes[0]!.content;
    expect(estimateTextTokens(body)).toBeLessThanOrEqual(1500); // 帽 1200 + 表头/提示余量
    expect(body).toContain("Tests 1 failed"); // 尾部结论在
    expect(body.split("✓ ok").length - 1).toBeLessThan(1500); // 头部流水账整段不在（原文 20000 行）
    expect(body).toContain("已截断");
  });

  it("⑤b 多条失败命令：留尾会砍掉前面那段的正文，但命令名必须还在（否则模型不知道去跑哪条）", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "改标题" },
      {
        type: "verify_result", callId: "harness-auto-verify", auto: true, ok: false, attempt: 1, maxAttempts: 3,
        results: [
          { command: "pnpm typecheck", ok: false, output: "A".repeat(30000) + "\ntsconfig 少一个 include" },
          { command: "pnpm test", ok: false, output: "B".repeat(30000) + "\n Tests 1 failed" },
        ],
      },
      { type: "user_message", content: "继续" },
    ];
    const body = autoNotes(projectContext(events))[0]!.content;
    expect(estimateTextTokens(body)).toBeLessThanOrEqual(1500);
    expect(body).toContain("pnpm typecheck"); // 正文被留尾砍掉了，命令名仍在
    expect(body).toContain("pnpm test");
    expect(body).toContain("Tests 1 failed"); // 最后一条的结论行在
  });

  it("⑥ 被压缩摘除的自动拍不再注入，且它不得顶掉仍然存活的那拍", () => {
    // 排除集由主循环的早退执行，但预扫描也必须知道它：只投「最新那拍」的游标若把已摘除的
    // 一拍算成最新，存活那拍就被顶掉 ⇒ 整条通道静默失效（测试仍绿的那种失效）。
    const events: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      autoFail("pnpm test", "还活着的红-Keeper"), // 事件 id = 2，未被摘除
      { type: "user_message", content: "r2" },
      autoFail("pnpm lint", "已被摘除的红-Ghost"), // 事件 id = 4，下面摘除它
      { type: "compaction", trigger: "auto", reason: "threshold", compressed_event_ids: [4], summary: "已摘要", summary_offset: 5, tokens_before: 9000, tokens_after: 1000 },
      { type: "user_message", content: "r3" },
    ];
    const msgs = projectContext(events);
    const notes = autoNotes(msgs);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content).toContain("Keeper");
    expect(notes[0]!.content).not.toContain("Ghost");
    expect(notes[0]!.content).not.toContain("另有"); // 已摘除的那拍不计成「此前另有 1 次」
    expect(withText(msgs, "上下文压缩摘要")).toBe(1); // 摘要注入照常（本测不碰它）
  });

  it("⑦ 幂等 + 零回归：同一事件列表投影两次逐字一致；手动拍逐字等价于删掉该事件", () => {
    const base: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "a", name: "read_file", args: { path: "x" } },
      { type: "tool_result", callId: "a", ok: true, output: "content" },
      { type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [] }, // 手动拍通过
      { type: "assistant_message", content: "done" },
    ];
    expect(JSON.stringify(projectContext(base))).toBe(JSON.stringify(projectContext(base)));
    const manualOnly: AgentEvent[] = base.filter((e) => e.type !== "verify_result");
    expect(JSON.stringify(projectContext(base))).toBe(JSON.stringify(projectContext(manualOnly)));
  });

  // 「两头断」防线：projectContext 有这条分支 ≠ 模型看得到。生产入口是会话型 provider
  // （它以事件日志为唯一事实源、忽略 loop 传入的 messages），故在这里验真实请求体。
  it("⑧ 生产入口：会话型 provider 的下一轮请求体里真的带着这条红", async () => {
    const dir = await mkdtemp(join(tmpdir(), "avnote-e2e-"));
    const path = join(dir, "events.jsonl");
    const log = createEventLog(path);
    await log.append({ type: "user_message", content: "把标题改成蓝色" });
    await log.append({ type: "assistant_message", content: "改完了，收尾" });
    await log.append(autoFail("pnpm test", "AssertionError: expected red\n Tests 1 failed"));
    const requests: GlmMessage[][] = [];
    const provider = createGlmSessionProvider(path, {
      map: false,
      workspace: dir,
      transport: async function* (messages): AsyncGenerator<never> {
        requests.push(messages);
        yield { type: "assistant_message", content: "收到" } as never;
      },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
    await log.close?.();
    await rm(dir, { recursive: true, force: true });
    expect(requests).toHaveLength(1);
    const flat = requests[0]!.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    expect(flat).toContain("[harness 自动验证]");
    expect(flat).toContain("[verify FAIL] pnpm test");
    expect(flat).toContain("Tests 1 failed");
  });
});

describe("⑨ 计数那句不许指向模型读不到的地方（#48，第 63 页）", () => {
  // 旧写法说「全文见事件流」，而模型侧没有任何一把工具能读会话事件流（七把碰文件的工具全走
  // resolveInWorkspace，日志又在应用数据目录里）⇒ 那是一次也执行不了的承诺（探针当时红在这一格）。
  it("两次自动补拍：旧拍只留计数，不递地址，只指做得到的动作", () => {
    const events = [
      { type: "user_message", content: "第一轮" } as AgentEvent,
      autoFail("pnpm test", "boom one"),
      autoFail("pnpm test", "boom two"),
    ];
    const note = projectContext(events).find((m) => typeof m.content === "string" && m.content.includes("[harness 自动验证]"));
    const text = typeof note?.content === "string" ? note.content : "";
    expect(text, "第二拍必须带着计数出现").toContain("此前另有 1 次"); // 计数如实保留，不假装只红过一次
    expect(text).not.toMatch(/全文见|取回/); // 不递模型够不着的地址
    expect(text).toContain("显式跑一次 verify"); // 只指做得到的动作
  });

  it("第一次红（earlierCount=0）时那句计数整段不出现（零回归）", () => {
    const events = [
      { type: "user_message", content: "第一轮" } as AgentEvent,
      autoFail("pnpm test", "boom only"),
    ];
    const text = String(projectContext(events).find((m) =>
      typeof m.content === "string" && m.content.includes("[harness 自动验证]"))?.content ?? "");
    expect(text).not.toContain("此前另有");
    expect(text).not.toMatch(/全文见|取回/);
  });
});
