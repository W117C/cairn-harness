// 搜索与回滚的来源语义（计划 Task 7）：
//   ① 两个工作区同名会话：结果带精确 SessionRef，命中带来源 EventRef；
//   ② 关键词只在祖先时，子会话视图也能命中（owner=子，ref=父行）；
//   ③ 预算不足以读完整条父链 ⇒ partial，不报零命中；
//   ④ 回滚计划在视图上按物理行号与 EventRef 记账，旧 raw 调用逐字不变。
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionView, replay, type AgentEvent, type SessionMetaEvent } from "../src/events";
import { searchSessions } from "../src/main/session-search";
import { planTurnRevert, planTurnRevertView } from "../src/agent/file-revert";
import { SNAPSHOT_ROOT } from "../src/tools/snapshot";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const forkMeta = (from: string, boundary: number, id: string): SessionMetaEvent =>
  ({ type: "session_meta", fork: { from_session_path: from, boundary_event_id: boundary, from_session_id: id } });

async function setup(): Promise<{ ws: string; root: string }> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "cairn-srch-")));
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

describe("搜索的来源引用", () => {
  it("同名会话各带各的 SessionRef；命中带所属文件的物理行", async () => {
    const a = await setup();
    const b = await setup();
    await writeSession(a.root, "same", [user("ALPHA needle one")]);
    await writeSession(b.root, "same", [user("BETA needle two")]);
    const ra = await searchSessions({ root: a.root, query: "needle" });
    const rb = await searchSessions({ root: b.root, query: "needle" });
    if (ra.kind === "unavailable" || rb.kind === "unavailable") throw new Error("unavailable");
    expect(ra.matches[0]?.session).toEqual({ workspace: a.ws, sessionId: "same" });
    expect(rb.matches[0]?.session).toEqual({ workspace: b.ws, sessionId: "same" });
    expect(ra.matches[0]?.snippets[0]?.ref).toEqual({ workspace: a.ws, sessionId: "same", eventId: 1 });
    expect(rb.matches[0]?.snippets[0]?.ref).toEqual({ workspace: b.ws, sessionId: "same", eventId: 1 });
  });

  it("关键词只在祖先：子会话视图命中，owner=子、ref=父行", async () => {
    const { ws, root } = await setup();
    const parent = await writeSession(root, "parent", [user("PARENT_ONLY_NEEDLE"), { type: "assistant_message", content: "done" }]);
    await writeSession(root, "child", [forkMeta(parent, 2, "parent"), user("child local")]);
    const res = await searchSessions({ root, query: "PARENT_ONLY_NEEDLE" });
    if (res.kind === "unavailable") throw new Error("unavailable");
    const child = res.matches.find((m) => m.sessionId === "child");
    expect(child?.session).toEqual({ workspace: ws, sessionId: "child" });
    expect(child?.snippets[0]?.ref).toEqual({ workspace: ws, sessionId: "parent", eventId: 1 });
  });

  it("预算不足以读完父链 ⇒ partial（不是零命中）", async () => {
    const { root } = await setup();
    const parent = await writeSession(root, "parent", [user("NEEDLE " + "x".repeat(4000))]);
    await writeSession(root, "child", [forkMeta(parent, 1, "parent"), user("local")]);
    const res = await searchSessions({ root, query: "NEEDLE", budgetBytes: 200 });
    expect(res.kind).toBe("partial");
    if (res.kind === "partial") expect(res.truncatedSessions).toContain("child");
  });
});

describe("回滚计划的来源行号", () => {
  it("视图里父轮的写回执带 EventRef；旧 raw 调用仍是 1-based 行号、无 ref", async () => {
    const { ws, root } = await setup();
    const snapshotId = `${SNAPSHOT_ROOT}/1--c/a.ts`;
    const parent = await writeSession(root, "parent", [
      user("P1"),
      { type: "tool_call", id: "c", name: "write_file", args: { path: "a.ts" } },
      { type: "tool_result", callId: "c", ok: true, output: "ok", snapshotId, change: "modified" },
    ]);
    await writeSession(root, "child", [forkMeta(parent, 3, "parent"), user("C1")]);
    const view = await readSessionView({ workspace: ws, sessionId: "child" }, root);
    const planned = planTurnRevertView(view, 1);
    if ("error" in planned) throw new Error(planned.error);
    expect(planned.entries).toHaveLength(1);
    expect(planned.entries[0]).toMatchObject({
      path: "a.ts", undo: "restore", sourceEventId: 3,
      sourceRef: { workspace: ws, sessionId: "parent", eventId: 3 },
    });

    const raw = planTurnRevert(await replay(parent), 1);
    if ("error" in raw) throw new Error(raw.error);
    expect(raw.entries[0]).toMatchObject({ path: "a.ts", undo: "restore", sourceEventId: 3 });
    expect(raw.entries[0]!.sourceRef).toBeUndefined();
  });
});
