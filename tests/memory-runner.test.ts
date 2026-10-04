import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionEndDistill } from "../src/agent/memory/distill";
import { initMemoryHome, readTextOrNull } from "../src/agent/memory/store";
import { composeTurnMessages } from "../src/agent/glm-session";
import { projectContext } from "../src/agent/context";
import { DEFAULT_COMPACTION_CONFIG, createMockSummarizer, runCompaction } from "../src/agent/compaction";
import { createMockProvider } from "../src/providers/mock";
import { createEventLog, type AgentEvent } from "../src/events";
import { memorySurfaceHits, stringLiterals } from "../scripts/lib/source-literals";
import { remember } from "../src/tools/remember";

let ws: string;
let home: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "m2d-run-ws-"));
  home = mkdtempSync(join(tmpdir(), "m2d-run-home-"));
  process.env.M2D_MEMORY_HOME = home;
  initMemoryHome(home);
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

async function seedSession(logPath: string): Promise<void> {
  const log = createEventLog(logPath);
  await log.append({ type: "user_message", content: "修 bug 并记住我用中文" });
  await log.append({ type: "assistant_message", content: "完成" });
}
async function seedFixture(path: string): Promise<void> {
  const rows = [
    { type: "tool_call", id: "d1", name: "remember", args: { scope: "global", kind: "memory", type: "user", topic: "lang", content: "用户偏好中文" } },
    { type: "tool_call", id: "d2", name: "remember", args: { scope: "project", kind: "memory", type: "project", topic: "flaky", content: "e2e 偶发" } },
    { type: "tool_call", id: "d3", name: "remember", args: { scope: "project", kind: "memory", type: "feedback", topic: "style", content: "断言带证据" } },
    { type: "assistant_message", content: "已沉淀 3 条" },
  ];
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}
const TINY = { ratio: 0.05, inputLimit: 200, maxOutputReserve: 0, tailMinTokens: 1, tailMaxTokens: 2, summaryCapTokens: 64, minProgress: 0 };
const user = (content: string): AgentEvent => ({ type: "user_message", content });
const say = (content: string): AgentEvent => ({ type: "assistant_message", content });
const call = (id: string, name: string, args: Record<string, unknown>): AgentEvent => ({ type: "tool_call", id, name, args });
const result = (id: string, output: string): AgentEvent => ({ type: "tool_result", callId: id, ok: true, output });

describe("双轨触发：会话结束自动沉淀（任务6）", () => {
  it("cancellation during approval prevents a subsequent memory write", async () => {
    const logPath = join(ws, "cancel.jsonl");
    await seedSession(logPath);
    const abort = new AbortController();
    let writes = 0;
    const outcome = await runSessionEndDistill({
      enabled: true, logPath, workspace: ws, signal: abort.signal,
      provider: { async *stream(_messages, _tools, call) {
        expect(call?.signal).toBe(abort.signal);
        yield { type: "tool_call", id: "cancel-memory", name: "remember", args: {} };
      } },
      rememberTool: { name: "remember", async run() { writes++; return { ok: true, output: "saved" }; } },
      emit: async () => {},
      mergedApproval: async () => { abort.abort(); return true; },
    });
    expect(outcome.kind).toBe("failed");
    expect(writes).toBe(0);
  });
  it("开关关闭 → 完全不触发（无 provider 调用、无审批、无写入）", async () => {
    const logPath = join(ws, "s.jsonl");
    await seedSession(logPath);
    let providerCalls = 0;
    const outcome = await runSessionEndDistill({
      enabled: false, logPath, workspace: ws,
      provider: { async *stream() { providerCalls++; yield { type: "assistant_message", content: "不该被调用" }; } },
      rememberTool: remember, emit: async () => {},
    });
    expect(outcome.kind).toBe("disabled");
    expect(providerCalls).toBe(0);
  });
  it("开启 → N 次写入合并为 1 次审批请求；批准则全部落盘且写入即事件", async () => {
    const logPath = join(ws, "s.jsonl");
    await seedSession(logPath);
    const fixture = join(ws, "d.jsonl");
    await seedFixture(fixture);
    const events: AgentEvent[] = [];
    let asks = 0;
    const outcome = await runSessionEndDistill({
      enabled: true, logPath, workspace: ws,
      provider: createMockProvider(fixture),
      rememberTool: remember,
      emit: async (e) => { events.push(e); },
      mergedApproval: async () => { asks++; return true; },
    });
    expect(outcome).toEqual({ kind: "saved", writes: 3, asks: 1 });
    expect(asks).toBe(1);
    expect(readFileSync(join(home, "lang.md"), "utf8")).toContain("中文");
    expect(readFileSync(join(ws, ".agent", "memory", "flaky.md"), "utf8")).toContain("e2e 偶发");
    expect(events.filter((e) => e.type === "tool_call" && e.name === "remember").length).toBe(3);
    expect(events.filter((e) => e.type === "tool_result").length).toBe(3);
  });
  it("审批拒绝 → 全部不写", async () => {
    const logPath = join(ws, "s.jsonl");
    await seedSession(logPath);
    const fixture = join(ws, "d.jsonl");
    await seedFixture(fixture);
    mkdirSync(join(ws, ".agent", "memory"), { recursive: true });
    writeFileSync(join(ws, ".agent", "memory", "flaky.md"), "旧内容", "utf8");
    const outcome = await runSessionEndDistill({
      enabled: true, logPath, workspace: ws,
      provider: createMockProvider(fixture),
      rememberTool: remember, emit: async () => {},
      mergedApproval: async () => false,
    });
    expect(outcome.kind).toBe("no_content");
    expect(readFileSync(join(ws, ".agent", "memory", "flaky.md"), "utf8")).toBe("旧内容");
    expect(existsSync(join(home, "lang.md"))).toBe(false);
  });
  it("provider 调用失败显式分型（failed ≠ no_content）", async () => {
    const logPath = join(ws, "s.jsonl");
    await seedSession(logPath);
    const outcome = await runSessionEndDistill({
      enabled: true, logPath, workspace: ws,
      provider: { async *stream() { throw new Error("429 限流"); } },
      rememberTool: remember, emit: async () => {},
    });
    expect(outcome).toEqual({ kind: "failed", why: "429 限流" });
  });
  it("无 remember 调用 → no_content；非 remember 工具被拒且不执行", async () => {
    const logPath = join(ws, "s.jsonl");
    await seedSession(logPath);
    const fixture = join(ws, "d2.jsonl");
    const rows = [
      { type: "tool_call", id: "x1", name: "run_shell", args: { command: "echo hi" } },
      { type: "assistant_message", content: "无" },
    ];
    writeFileSync(fixture, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    const events: AgentEvent[] = [];
    const outcome = await runSessionEndDistill({
      enabled: true, logPath, workspace: ws,
      provider: createMockProvider(fixture),
      rememberTool: remember, emit: async (e) => { events.push(e); },
    });
    expect(outcome.kind).toBe("no_content");
    const rejected = events.find((e) => e.type === "tool_result" && e.callId === "x1") as { ok: boolean; output: string } | undefined;
    expect(rejected?.ok).toBe(false);
    expect(rejected?.output).toContain("只允许 remember");
  });
});

describe("压缩接缝（任务9）", () => {
  it("压缩前后记忆块都在（固定回注重注）", async () => {
    const memory = { project: '<memory source="project">两层记忆块</memory>', global: null };
    const events: AgentEvent[] = [user("目标"), say("开工"), call("t1", "write_file", { path: "a.ts", content: "x" }), result("t1", "ok"), say("好")];
    const before = composeTurnMessages({ memory, history: projectContext(events) });
    expect(before.some((m) => (typeof m.content === "string" ? m.content : "").includes("两层记忆块"))).toBe(true);
    const outcome = await runCompaction({
      events, trigger: "auto", reason: "threshold",
      summarizer: createMockSummarizer("摘要"),
      config: { ...DEFAULT_COMPACTION_CONFIG, ...TINY },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = composeTurnMessages({ memory, history: projectContext([...events, outcome.event]) });
    expect(after.some((m) => (typeof m.content === "string" ? m.content : "").includes("两层记忆块"))).toBe(true);
  });
  it("压缩器不触记忆文件（canary 逐字不变）+ 代码路径无 fs/记忆目录引用", async () => {
    mkdirSync(join(ws, ".agent", "memory"), { recursive: true });
    writeFileSync(join(ws, ".agent", "memory", "MEMORY.md"), "canary-项目层\n", "utf8");
    writeFileSync(join(home, "MEMORY.md"), "canary-全局层\n", "utf8");
    const events: AgentEvent[] = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? user("消息" + String(i)) : say("回复" + String(i))));
    await runCompaction({
      events, trigger: "auto", reason: "threshold",
      summarizer: createMockSummarizer("摘要"),
      config: { ...DEFAULT_COMPACTION_CONFIG, ...TINY },
    });
    expect(readFileSync(join(ws, ".agent", "memory", "MEMORY.md"), "utf8")).toBe("canary-项目层\n");
    expect((await readTextOrNull(join(home, "MEMORY.md"))) ?? "").toBe("canary-全局层\n");
    const src = readFileSync(join(process.cwd(), "src", "agent", "compaction.ts"), "utf8");
    // 扫的是**字符串字面量面**，不是整份源码文本（2026-10-04 修正，判据单源在 `scripts/lib/source-literals.ts`）。
    // 原写法 `expect(src).not.toContain(".agent")` 被一次无关的属性访问撞红：
    // `who(e.agent_id)` 里 "e.agent" 就含子串 ".agent" ⇒ 尺红得理直气壮，而代码一行都没碰记忆目录。
    // 这里刻意**引那只共享谓词而不是再抄一份正则**：第 371 页我第一次修时手抄了一份，
    // 于是同一判据在门侧与判卷侧各有一份实现，门侧漏同步就出现"判卷绿、门红"（认证第一趟实测）——
    // 覆盖面与门完全同源，两边不可能再漂；上面两条行为断言（canary 文件逐字未变）才是"没碰"的正证，这一组只是代理。
    const hits = memorySurfaceHits(src);
    expect(hits, "字面量面命中：" + hits.join("、")).toEqual([]);
    // 反向自证：字面量清单不是空的（尺没退化成"永远不匹配"）——今天这个文件里确有字面量。
    expect(stringLiterals(src).length).toBeGreaterThan(5);
  });
});
