// ADR 0005 的产品来源视图（计划 Task 1 的红面）：raw、带 EventRef 的 SessionView、模型投影三面分开。
//
// 这一份钉的是「视图不许把物理行号丢掉」：
//   ① 每个 entry 的 ref.eventId = 该事件在**所属文件**里的 1-based 物理行号（祖先不重编号）；
//   ② 祖先边界按各自文件的 raw 行号截，不是按拼接后的数组位置；
//   ③ 控制记录（rewind / meta_update）按各自文件解释，过滤后仍保留来源；
//   ④ localEvents 与 raw replay 逐字相等（视图不是 raw 的替代品）；
//   ⑤ 分叉点在祖先里时返回**祖先**来源与物理边界；在本地时返回本地；
//   ⑥ 坏血缘（缺失 / 越界 / 环 / 软链越界）显式失败；同名不同根互不串；
//   ⑦ 继承边界未收尾的请求被过滤，子自己的在飞保留，worker 同 id 不替主流收尾。
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { effectiveEvents, replay, type AgentEvent, type SessionMetaEvent } from "../src/events";
import {
  eventRefKey, isEventRef, isSessionRef, sameEventRef, sameSession, sessionRefKey,
} from "../src/events/session-ref";
import { forkPointInView, readSessionView } from "../src/events/session-view";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_message", content });
const forkMeta = (from: string, boundary: number, id: string): SessionMetaEvent =>
  ({ type: "session_meta", fork: { from_session_path: from, boundary_event_id: boundary, from_session_id: id } });

async function workspace(): Promise<{ ws: string; root: string }> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "cairn-view-")));
  roots.push(ws);
  const root = join(ws, ".agent", "sessions");
  await mkdir(root, { recursive: true });
  return { ws, root };
}

/** 造一份真实 JSONL（一行一事件），返回规范化后的文件路径。 */
async function writeSession(root: string, id: string, events: readonly AgentEvent[]): Promise<string> {
  const path = join(root, id + ".jsonl");
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return realpath(path);
}

describe("SessionView：来源与物理行号", () => {
  it("父 4 行、子 2 行、孙子 1 行：各文件原行号保留，祖先按边界截，localEvents 与 raw 相等", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER"), user("P2"), assistant("P3")]);
    const child = await writeSession(root, "child", [forkMeta(parent, 2, "parent"), user("CHILD_USER")]);
    await writeSession(root, "grand", [forkMeta(child, 1, "child"), user("GRAND_USER")]);
    const ref = { workspace: ws, sessionId: "child" };

    const view = await readSessionView(ref, root);
    expect(view.entries.map((e) => [e.ref.sessionId, e.ref.eventId, e.inherited])).toEqual([
      ["parent", 1, true],
      ["parent", 2, true],
      ["child", 1, false],
      ["child", 2, false],
    ]);
    expect(view.entries.map((e) => e.event.type)).toEqual([
      "user_message", "assistant_message", "session_meta", "user_message",
    ]);
    expect(view.entries.map((e) => e.event.type === "user_message" || e.event.type === "assistant_message" ? e.event.content : "")).toEqual([
      "P1", "PARENT_ANSWER", "", "CHILD_USER",
    ]);
    expect(view.entries.every((e) => e.ref.workspace === ws)).toBe(true);
    expect(view.localEvents).toEqual(await replay(child));

    const grand = await readSessionView({ workspace: ws, sessionId: "grand" }, root);
    expect(grand.entries.map((e) => [e.ref.sessionId, e.ref.eventId, e.inherited])).toEqual([
      ["parent", 1, true],
      ["parent", 2, true],
      ["child", 1, true],
      ["grand", 1, false],
      ["grand", 2, false],
    ]);
  });

  it("控制记录按各自文件解释：rewind 过滤后来源仍是原行号，不重编号", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [
      user("P1"), assistant("PA"), user("P2"),
      { type: "session_rewind", to_event_id: 2 },
      assistant("AFTER_REWIND"),
    ]);
    await writeSession(root, "child", [forkMeta(parent, 5, "parent"), user("CHILD_USER")]);

    expect((await replay(parent)).length).toBe(5);
    expect(effectiveEvents(await replay(parent)).map((e) => e.type)).toEqual(["user_message", "assistant_message"]);

    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    expect(view.entries.map((e) => [e.ref.sessionId, e.ref.eventId])).toEqual([
      ["parent", 1], ["parent", 2], ["child", 1], ["child", 2],
    ]);
    // 视图里的顺序不是物理行号的来源：父第 2 行与子第 2 行各自保留自己的 2。
    expect(view.entries.filter((e) => e.ref.eventId === 2).map((e) => e.ref.sessionId)).toEqual(["parent", "child"]);
  });

  it("meta_update 只改所属文件的有效补丁，不改变 entry 与来源", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [
      user("P1"), { type: "session_meta_update", patch: { title: "父标题" } }, assistant("PA"),
    ]);
    await writeSession(root, "child", [forkMeta(parent, 3, "parent"), user("CHILD_USER")]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    expect(view.entries.map((e) => [e.ref.sessionId, e.ref.eventId, e.event.type])).toEqual([
      ["parent", 1, "user_message"],
      ["parent", 3, "assistant_message"],
      ["child", 1, "session_meta"],
      ["child", 2, "user_message"],
    ]);
  });
});

describe("分叉点：轮次 → 来源与物理边界", () => {
  it("选中祖先行时返回祖先来源与祖先物理边界；选到末轮返回本地", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER"), user("P2"), assistant("P3")]);
    await writeSession(root, "child", [forkMeta(parent, 2, "parent"), user("CHILD_USER")]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);

    expect(forkPointInView(view, 1)).toEqual({
      source: { workspace: ws, sessionId: "parent" }, boundaryEventId: 2, totalRounds: 2,
    });
    expect(forkPointInView(view, 2)).toEqual({
      source: { workspace: ws, sessionId: "child" }, boundaryEventId: 2, totalRounds: 2,
    });
    // desktop 的 0 = 全量分叉：保留到最后一轮。
    expect(forkPointInView(view, 0)).toEqual(forkPointInView(view, 2));
    expect(forkPointInView(view, 3)).toEqual({ error: "分叉轮次 3 超出可见历史（共 2 轮）" });
    expect("error" in forkPointInView(view, -1)).toBe(true);
    expect("error" in forkPointInView(view, 1.5)).toBe(true);
  });

  it("没有可见轮次时 fail closed", async () => {
    const { ws, root } = await workspace();
    await writeSession(root, "empty", []);
    const view = await readSessionView({ workspace: ws, sessionId: "empty" }, root);
    expect(forkPointInView(view, 0)).toEqual({ error: "这条会话还没有任何一轮（0 条 user_message），没有可分叉的点" });
  });
});

describe("血缘坏法 fail closed", () => {
  it("父缺失 / 边界越界 / 环 各有各的码", async () => {
    const { ws, root } = await workspace();
    await writeSession(root, "missing-parent", [forkMeta(join(root, "gone.jsonl"), 0, "gone"), user("X")]);
    await expect(readSessionView({ workspace: ws, sessionId: "missing-parent" }, root))
      .rejects.toMatchObject({ code: "session-missing" });

    const parent = await writeSession(root, "parent", [user("P1")]);
    await writeSession(root, "bad-boundary", [forkMeta(parent, 9, "parent"), user("X")]);
    await expect(readSessionView({ workspace: ws, sessionId: "bad-boundary" }, root))
      .rejects.toMatchObject({ code: "boundary-out-of-range" });

    const a = join(root, "a.jsonl");
    const b = join(root, "b.jsonl");
    await writeSession(root, "a", [forkMeta(b, 0, "b"), user("A")]);
    await writeSession(root, "b", [forkMeta(a, 0, "a"), user("B")]);
    await expect(readSessionView({ workspace: ws, sessionId: "a" }, root))
      .rejects.toMatchObject({ code: "fork-cycle" });
  });

  it("软链逃出受信 sessions 根 ⇒ outside-session-root", async () => {
    const { ws, root } = await workspace();
    const outside = await mkdtemp(join(tmpdir(), "cairn-view-outside-"));
    roots.push(outside);
    const evil = join(outside, "evil.jsonl");
    await writeFile(evil, JSON.stringify(user("OUTSIDE")) + "\n");
    const link = join(root, "link.jsonl");
    await symlink(evil, link);
    await writeSession(root, "child", [forkMeta(await realpath(link), 1, "evil"), user("X")]);
    await expect(readSessionView({ workspace: ws, sessionId: "child" }, root))
      .rejects.toMatchObject({ code: "outside-session-root" });
  });

  it("两个工作区同名会话各读各的，引用按 workspace 分域", async () => {
    const a = await workspace();
    const b = await workspace();
    await writeSession(a.root, "same", [user("A_BODY")]);
    await writeSession(b.root, "same", [user("B_BODY")]);
    const va = await readSessionView({ workspace: a.ws, sessionId: "same" }, a.root);
    const vb = await readSessionView({ workspace: b.ws, sessionId: "same" }, b.root);
    expect(va.entries[0]?.ref.workspace).toBe(a.ws);
    expect(vb.entries[0]?.ref.workspace).toBe(b.ws);
    expect(va.entries[0]?.event).not.toEqual(vb.entries[0]?.event);
    expect(sessionRefKey({ workspace: a.ws, sessionId: "same" }))
      .not.toBe(sessionRefKey({ workspace: b.ws, sessionId: "same" }));
  });
});

describe("未收尾请求与 worker 分域", () => {
  it("父的未收尾请求不继承（worker 同 id 不替主流收尾）；子自己的在飞保留", async () => {
    const { ws, root } = await workspace();
    const parent = await writeSession(root, "parent", [
      { type: "tool_call", id: "same", name: "read_file", args: { path: "a" } },
      { type: "tool_result", callId: "same", ok: true, output: "worker did it", agent_id: "worker" },
      { type: "clarify_requested", callId: "q", questions: [] },
      { type: "approval_requested", id: "ask", tool: "run_shell", args_digest: "pwd", risk: "low" },
    ]);
    await writeSession(root, "child", [
      forkMeta(parent, 4, "parent"),
      { type: "tool_call", id: "same", name: "read_file", args: { path: "b" } },
    ]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    // 父的主流 tool_call 未收尾 ⇒ 不继承；worker 的回执是已收尾事件（与 replaySession 同口径，
    // 孤儿回执由模型投影按来源配对处理）；澄清/审批的未收尾请求同样被丢弃。
    expect(view.entries.map((e) => [e.ref.sessionId, e.event.type])).toEqual([
      ["parent", "tool_result"],
      ["child", "session_meta"],
      ["child", "tool_call"],
    ]);
    // raw 仍然逐字保留（视图不是 raw 的替代品），父的在飞行还在自己文件里。
    expect(view.localEvents.map((e) => e.type)).toEqual(["session_meta", "tool_call"]);
    expect((await replay(parent)).length).toBe(4);
  });
});

describe("EventRef 形状与键", () => {
  it("eventId 必须是正安全整数；键是 JSON 元组，不用分隔符拼接", () => {
    expect(isEventRef({ workspace: "/w", sessionId: "s", eventId: 1 })).toBe(true);
    for (const bad of [
      { workspace: "/w", sessionId: "s", eventId: 0 },
      { workspace: "/w", sessionId: "s", eventId: -1 },
      { workspace: "/w", sessionId: "s", eventId: 1.5 },
      { workspace: "/w", sessionId: "s", eventId: Number.MAX_SAFE_INTEGER + 1 },
      { workspace: "", sessionId: "s", eventId: 1 },
      { workspace: "/w", sessionId: "", eventId: 1 },
      { workspace: "/w", sessionId: "s" },
      null,
    ]) expect(isEventRef(bad)).toBe(false);
    expect(isSessionRef({ workspace: "/w", sessionId: "s" })).toBe(true);
    expect(isSessionRef({ workspace: "", sessionId: "s" })).toBe(false);

    const a = { workspace: "a:b", sessionId: "c", eventId: 1 };
    const b = { workspace: "a", sessionId: "b:c", eventId: 1 };
    expect(eventRefKey(a)).not.toBe(eventRefKey(b));
    expect(eventRefKey(a)).toBe(JSON.stringify(["a:b", "c", 1]));
    expect(sameEventRef(a, { ...a })).toBe(true);
    expect(sameEventRef(a, { ...a, eventId: 2 })).toBe(false);
    expect(sameSession({ workspace: "a", sessionId: "s" }, { workspace: "a", sessionId: "s" })).toBe(true);
    expect(sameSession({ workspace: "a", sessionId: "s" }, { workspace: "b", sessionId: "s" })).toBe(false);
  });
});
