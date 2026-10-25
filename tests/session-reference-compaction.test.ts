// 来源视图的模型投影（计划 Task 2 红面）：跨文件压缩、摘要锚点与 tool-call wire id。
//
// 钉的是「数字位置不在拼接数组上解释」：
//   ① 旧的数字压缩只解释**本文件**的行号（父第 2 行与子第 2 行不是同一格）；
//   ② 来源形式只摘 EventRef 指向的事件，锚点用来源；未知/混合/半套形状 fail closed；
//   ③ 父子复用同一个 raw tool id 时，wire id 按来源分开，回执一一配对，不补「没有收到结果」；
//   ④ 裁剪替换键是 eventRefKey，跨来源不误伤同号结果。
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eventRefKey, isReferencedCompaction, readSessionView, replay, type AgentEvent, type SessionMetaEvent } from "../src/events";
import { projectViewContext } from "../src/agent/session-view-context";
import { runCompaction } from "../src/agent/compaction";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_message", content });
const forkMeta = (from: string, boundary: number, id: string): SessionMetaEvent =>
  ({ type: "session_meta", fork: { from_session_path: from, boundary_event_id: boundary, from_session_id: id } });
function compaction(patch: { compressed_event_ids: number[]; summary_offset: number; summary: string }): AgentEvent {
  return { type: "compaction", trigger: "manual", reason: "user_request", tokens_before: 9000, tokens_after: 100, ...patch };
}

async function workspace(): Promise<{ ws: string; root: string }> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "cairn-ref-comp-")));
  roots.push(ws);
  const root = join(ws, ".agent", "sessions");
  await mkdir(root, { recursive: true });
  return { ws, root };
}

async function writeSession(root: string, id: string, events: readonly AgentEvent[]): Promise<string> {
  const path = join(root, id + ".jsonl");
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return realpath(path);
}

const text = (msgs: { content: string | null }[]): string => msgs.map((m) => m.content ?? "").join("\n");

describe("跨文件压缩：旧数字形式只解释本文件", () => {
  it("子第 2 行的旧压缩不会摘掉父第 2 行", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER")]);
    await writeSession(root, "child", [
      forkMeta(parent, 2, "parent"), user("CHILD_USER"),
      compaction({ compressed_event_ids: [2], summary: "CHILD_SUMMARY", summary_offset: 3 }),
    ]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const msgs = projectViewContext(view);
    const body = text(msgs);
    expect(body).toContain("PARENT_ANSWER"); // 父第 2 行不是子第 2 行
    expect(body).not.toContain("CHILD_USER"); // 子第 2 行按本文件行号被摘
    expect(body).toContain("CHILD_SUMMARY");
  });
});

describe("来源形式：EventRef 摘除与锚点", () => {
  it("只摘指定 EventRef，摘要按 summary_anchor 插在来源之前", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER")]);
    await writeSession(root, "child", [
      forkMeta(parent, 2, "parent"), user("CHILD_USER"),
      {
        type: "compaction", trigger: "manual", reason: "user_request",
        reference_version: 1,
        compressed_event_refs: [{ workspace: ws, sessionId: "parent", eventId: 2 }],
        summary_anchor: { before: { workspace: ws, sessionId: "child", eventId: 2 } },
        superseded_summary_refs: [],
        summary: "REF_SUMMARY", tokens_before: 9000, tokens_after: 100,
      } as AgentEvent,
    ]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const msgs = projectViewContext(view);
    const body = text(msgs);
    expect(body).not.toContain("PARENT_ANSWER");
    expect(body).toContain("CHILD_USER");
    const summaryAt = msgs.findIndex((m) => (m.content ?? "").includes("REF_SUMMARY"));
    const childAt = msgs.findIndex((m) => (m.content ?? "") === "CHILD_USER");
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(summaryAt).toBeLessThan(childAt);
  });

  it("未知版本 / 新旧混用 / 半套字段 / 视图外锚点 一律 fail closed", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER")]);
    const cases: AgentEvent[][] = [
      [forkMeta(parent, 2, "parent"), user("C"), {
        type: "compaction", trigger: "manual", reason: "user_request", reference_version: 2,
        compressed_event_refs: [], summary_anchor: { end: true }, superseded_summary_refs: [],
        summary: "S", tokens_before: 1, tokens_after: 1,
      } as unknown as AgentEvent],
      [forkMeta(parent, 2, "parent"), user("C"), {
        type: "compaction", trigger: "manual", reason: "user_request", reference_version: 1,
        compressed_event_refs: [], summary_anchor: { end: true }, superseded_summary_refs: [],
        compressed_event_ids: [], summary_offset: 2,
        summary: "S", tokens_before: 1, tokens_after: 1,
      } as unknown as AgentEvent],
      [forkMeta(parent, 2, "parent"), user("C"), {
        type: "compaction", trigger: "manual", reason: "user_request", reference_version: 1,
        compressed_event_refs: [], superseded_summary_refs: [],
        summary: "S", tokens_before: 1, tokens_after: 1,
      } as unknown as AgentEvent],
      [forkMeta(parent, 2, "parent"), user("C"), {
        type: "compaction", trigger: "manual", reason: "user_request", reference_version: 1,
        compressed_event_refs: [], summary_anchor: { before: { workspace: ws, sessionId: "nope", eventId: 9 } },
        superseded_summary_refs: [], summary: "S", tokens_before: 1, tokens_after: 1,
      } as unknown as AgentEvent],
    ];
    for (const [index, events] of cases.entries()) {
      await writeSession(root, `bad-${String(index)}`, events);
      const view = await readSessionView({ workspace: ws, sessionId: `bad-${String(index)}` }, root);
      expect(() => projectViewContext(view), `case ${String(index)}`).toThrow(/fail closed/);
    }
  });
});

describe("tool-call wire id 按来源分域", () => {
  it("父子复用同一个 raw id：wire id 不同、回执各自配对、不补「没有收到结果」", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [
      user("P1"),
      { type: "tool_call", id: "same", name: "read_file", args: { path: "p" } },
      { type: "tool_result", callId: "same", ok: true, output: "PARENT_RECEIPT" },
      assistant("PA"),
    ]);
    await writeSession(root, "child", [
      forkMeta(parent, 4, "parent"),
      { type: "tool_call", id: "same", name: "read_file", args: { path: "c" } },
      { type: "tool_result", callId: "same", ok: true, output: "CHILD_RECEIPT" },
    ]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const msgs = projectViewContext(view);
    const ids = msgs.flatMap((m) => (m.tool_calls ?? []).map((c) => c.id));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const results = msgs.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
    expect(results).toEqual(ids);
    expect(text(msgs)).not.toContain("没有收到结果");
    expect(text(msgs)).not.toContain("没有配对的调用声明");
  });
});

describe("裁剪替换按来源", () => {
  it("替换父第 3 行的回执不误伤子第 3 行的同名结果", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [
      user("P1"),
      { type: "tool_call", id: "same", name: "read_file", args: { path: "p" } },
      { type: "tool_result", callId: "same", ok: true, output: "PARENT_RECEIPT" },
    ]);
    await writeSession(root, "child", [
      forkMeta(parent, 3, "parent"),
      { type: "tool_call", id: "same", name: "read_file", args: { path: "c" } },
      { type: "tool_result", callId: "same", ok: true, output: "CHILD_RECEIPT" },
    ]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const replacement = new Map([[eventRefKey({ workspace: ws, sessionId: "parent", eventId: 3 }), "CLEARED_PARENT"]]);
    const msgs = projectViewContext(view, replacement);
    const bodies = msgs.filter((m) => m.role === "tool").map((m) => m.content);
    expect(bodies).toContain("CLEARED_PARENT");
    expect(bodies).toContain("CHILD_RECEIPT");
    expect(await replay(join(root, "parent.jsonl"))).toHaveLength(3); // raw 不变
  });
});

describe("分叉会话的压缩生产端产出来源形式", () => {
  it("摘除是本文件 EventRef、旧摘要进 superseded；投影只注入新摘要", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [
      user("P1"), assistant("PA"),
      compaction({ compressed_event_ids: [], summary: "PARENT_SUMMARY", summary_offset: 3 }),
    ]);
    const local = [
      forkMeta(parent, 3, "parent"), user("C1"), assistant("A1"),
      user("C2"), assistant("A2"), user("C3"), assistant("A3"),
    ];
    const child = await writeSession(root, "child", local);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const outcome = await runCompaction({
      events: await replay(child), view,
      trigger: "overflow", reason: "hard_buffer",
      config: { inputLimit: 400, maxOutputReserve: 50 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const event = outcome.event;
    if (!isReferencedCompaction(event)) throw new Error("分叉会话压缩必须产出来源形式");
    expect(event.reference_version).toBe(1);
    expect(event.compressed_event_refs.length).toBeGreaterThan(0);
    expect(event.compressed_event_refs.every((r) => r.sessionId === "child" && r.workspace === ws)).toBe(true);
    expect(event.superseded_summary_refs).toContainEqual({ workspace: ws, sessionId: "parent", eventId: 3 });

    await writeSession(root, "child", [...local, event]);
    const after = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const body = text(projectViewContext(after));
    expect(body).toContain("overflow 紧急截断");
    expect(body).not.toContain("PARENT_SUMMARY");
  });
});
