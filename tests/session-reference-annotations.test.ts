// 注释来源（计划 Task 6）：反馈/置顶可以指向**祖先文件**的行；owner 仍是当前子会话。
//   ① 解析键带来源：父第 2 行与子第 2 行是两格，不互相覆盖；
//   ② 旧数字记录仍按 owner 自己的行号解释（无 eventRef）；
//   ③ 写进 owner 的 sidecar，父日志与父 sidecar 一个字节不动；
//   ④ 坏 EventRef fail closed。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FeedbackStore } from "../src/main/feedback";
import { PinStore } from "../src/main/pins";
import { handleFeedbackSubmit, initSessionsDir } from "../src/main/session-handlers";
import { replay, type EventRef } from "../src/events";
import { promoteToMain } from "../src/agent/sidechat";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const sha = async (p: string): Promise<string> => createHash("sha256").update(await readFile(p)).digest("hex");

async function setup(): Promise<{ ws: string; root: string; parent: EventRef; child: EventRef }> {
  const ws = await mkdtemp(join(tmpdir(), "cairn-annot-"));
  roots.push(ws);
  const root = join(ws, ".agent", "sessions");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "parent.jsonl"), JSON.stringify({ type: "user_message", content: "P" }) + "\n");
  await writeFile(join(root, "child.jsonl"), JSON.stringify({ type: "user_message", content: "C" }) + "\n");
  return {
    ws, root,
    parent: { workspace: ws, sessionId: "parent", eventId: 1 },
    child: { workspace: ws, sessionId: "child", eventId: 1 },
  };
}

describe("反馈的来源键", () => {
  it("父行与本地行同号各留各的；撤销按来源键生效", async () => {
    const { ws } = await setup();
    const store = new FeedbackStore(join(ws, "feedback.jsonl"));
    await store.append({ sessionId: "child", eventId: 1, rating: "up", eventRef: { workspace: ws, sessionId: "parent", eventId: 1 } });
    await store.append({ sessionId: "child", eventId: 1, rating: "down" });
    const listed = await store.listForSession("child");
    expect(listed).toHaveLength(2);
    expect(listed.find((r) => r.eventRef !== undefined)?.rating).toBe("up");
    expect(listed.find((r) => r.eventRef === undefined)?.rating).toBe("down");

    // 撤销父行的那条不影响本地行。
    await store.append({ sessionId: "child", eventId: 1, rating: "none", eventRef: { workspace: ws, sessionId: "parent", eventId: 1 } });
    const after = await store.listForSession("child");
    expect(after).toHaveLength(1);
    expect(after[0]!.eventRef).toBeUndefined();
    expect(after[0]!.rating).toBe("down");
  });

  it("旧记录没有 eventRef：仍按 owner 自己的行号解释", async () => {
    const { ws } = await setup();
    const store = new FeedbackStore(join(ws, "feedback.jsonl"));
    await store.append({ sessionId: "child", eventId: 2, rating: "up" });
    const [rec] = await store.listForSession("child");
    expect(rec).toMatchObject({ eventId: 2, rating: "up" });
    expect(rec!.eventRef).toBeUndefined();
  });

  it("坏 eventRef fail closed", async () => {
    const { ws } = await setup();
    const store = new FeedbackStore(join(ws, "feedback.jsonl"));
    await expect(store.append({ sessionId: "child", eventId: 1, rating: "up", eventRef: { workspace: ws, sessionId: "parent", eventId: 0 } }))
      .rejects.toThrow(/eventRef 非法/);
  });
});

describe("置顶的来源键", () => {
  it("父行与本地行同号：取消父行不误伤本地行", async () => {
    const { ws } = await setup();
    const store = new PinStore(join(ws, "pins.jsonl"));
    const parentAnchor = { workspace: ws, sessionId: "parent", eventId: 1 };
    await store.append({ sessionId: "child", eventId: 1, pinned: true, eventRef: parentAnchor });
    await store.append({ sessionId: "child", eventId: 1, pinned: true });
    expect(await store.listForSessionWithRefs("child")).toHaveLength(2);
    await store.append({ sessionId: "child", eventId: 1, pinned: false, eventRef: parentAnchor });
    const left = await store.listForSessionWithRefs("child");
    expect(left).toHaveLength(1);
    expect(left[0]!.eventRef).toBeUndefined();
  });
});

describe("生产入口：owner 是子会话，父日志与父 sidecar 不动", () => {
  it("handleFeedbackSubmit 收 eventRef，落子会话所在的 sidecar；父文件 sha 不变", async () => {
    const { ws, root, parent } = await setup();
    initSessionsDir(root);
    const parentPath = join(root, "parent.jsonl");
    const before = await sha(parentPath);
    expect(await handleFeedbackSubmit({ sessionId: "child", eventId: 1, rating: "up", eventRef: parent }, root)).toEqual({ ok: true });
    const raw = await readFile(join(root, "feedback.jsonl"), "utf8");
    expect(raw).toContain('"sessionId":"child"');
    expect(raw).toContain('"sessionId":"parent"'); // 作为来源引用出现，不是 owner
    expect(await sha(parentPath)).toBe(before);
    await expect(readFile(join(root, "parent.feedback.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("侧聊提升的来源形式", () => {
  it("只用 EventRef 时从来源视图重建正文，origin 记下来源引用", async () => {
    const { ws, root } = await setup();
    await writeFile(join(root, "parent.jsonl"), [
      JSON.stringify({ type: "user_message", content: "P1" }),
      JSON.stringify({ type: "assistant_message", content: "PARENT_CONCLUSION" }),
    ].join("\n") + "\n");
    const mainLog = join(root, "main.jsonl");
    await writeFile(mainLog, "");
    const ref: EventRef = { workspace: ws, sessionId: "parent", eventId: 2 };
    const res = await promoteToMain({ mainLogPath: mainLog, sidechatId: "sc", sourceEventIds: [], sourceEventRefs: [ref] });
    expect(res.ok).toBe(true);
    const events = await replay(mainLog);
    const promoted = events.find((e) => e.type === "user_message");
    expect(promoted?.type === "user_message" ? promoted.content : "").toBe("PARENT_CONCLUSION");
    expect(promoted?.type === "user_message" ? promoted.origin?.source_event_refs : undefined).toEqual([ref]);
  });

  it("数字 id 与来源引用混用 / 坏引用都 fail closed", async () => {
    const { ws, root } = await setup();
    const mainLog = join(root, "main.jsonl");
    await writeFile(mainLog, "");
    const ref: EventRef = { workspace: ws, sessionId: "parent", eventId: 1 };
    expect(await promoteToMain({ mainLogPath: mainLog, sidechatId: "sc", sourceEventIds: [1], sourceEventRefs: [ref] }))
      .toMatchObject({ ok: false, error: expect.stringContaining("混用") });
    expect(await promoteToMain({ mainLogPath: mainLog, sidechatId: "sc", sourceEventIds: [], sourceEventRefs: [{ workspace: ws, sessionId: "parent", eventId: 0 }] }))
      .toMatchObject({ ok: false, error: expect.stringContaining("没有可提升的正文") });
  });
});
