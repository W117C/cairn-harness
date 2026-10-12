// 用户反馈沉淀（v2.16）判卷：append-only sidecar 的生效语义 + 非法入参不落盘 + 坏行可数。
// 关键分辨力：「改主意」是**追加**不是改写（旧记录还在流里，读时取最后一条）；撤销后不再返回；
// 非法 rating/eventId 连文件都不该建起来（与 goal_set 被拒不建文件同一条纪律）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeedbackStore } from "../src/main/feedback";
import { handleFeedbackList, handleFeedbackSubmit, handleSessionCreate, initSessionsDir } from "../src/main/session-handlers";

let root = "";
let file = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "feedback-"));
  file = join(root, "feedback.jsonl");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FeedbackStore：append-only 的赞/踩", () => {
  it("赞 → 生效；改主意（踩）→ 只认最后一条；撤销（none）→ 不再返回", async () => {
    const store = new FeedbackStore(file);
    await store.append({ sessionId: "s1", eventId: 3, rating: "up" });
    expect(await store.listForSession("s1")).toEqual([
      expect.objectContaining({ eventId: 3, rating: "up" }),
    ]);

    await store.append({ sessionId: "s1", eventId: 3, rating: "down", note: "其实不对" });
    const after = await store.listForSession("s1");
    expect(after).toEqual([expect.objectContaining({ eventId: 3, rating: "down", note: "其实不对" })]);

    await store.append({ sessionId: "s1", eventId: 3, rating: "none" });
    expect(await store.listForSession("s1")).toEqual([]);

    // 三条都还在文件里（append-only：改过几次是审计事实，不被覆写抹掉）
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("多事件各自独立；按 eventId 升序返回；只要本会话的", async () => {
    const store = new FeedbackStore(file);
    await store.append({ sessionId: "s1", eventId: 9, rating: "up" });
    await store.append({ sessionId: "s1", eventId: 2, rating: "down" });
    await store.append({ sessionId: "s2", eventId: 2, rating: "up" });
    expect((await store.listForSession("s1")).map((r) => r.eventId)).toEqual([2, 9]);
    expect((await store.listForSession("s2")).map((r) => r.eventId)).toEqual([2]);
  });

  it("非法入参在写之前被拒：不落盘、不建文件", async () => {
    const store = new FeedbackStore(file);
    await expect(store.append({ sessionId: "s1", eventId: 0, rating: "up" })).rejects.toThrow(/eventId/);
    await expect(store.append({ sessionId: "s1", eventId: 1, rating: "meh" })).rejects.toThrow(/rating/);
    await expect(store.append({ sessionId: "../x", eventId: 1, rating: "up" })).rejects.toThrow(/sessionId/);
    await expect(readFile(file, "utf8")).rejects.toThrow(); // 一个坏入参都没能建起文件
  });

  it("坏行被跳过并计数（丢的事件数得出来），好行照常生效", async () => {
    await writeFile(file, "{\"oops\":1}\n" + JSON.stringify({ sessionId: "s1", eventId: 1, rating: "up", at: "2026-10-06T00:00:00.000Z" }) + "\n" + "not json\n", "utf8");
    const store = new FeedbackStore(file);
    const all = await store.listAll();
    expect(all.skipped).toBe(2);
    expect(all.records).toHaveLength(1);
    expect(await store.listForSession("s1")).toHaveLength(1);
  });
});

describe("反馈 IPC 处理器：会话必须存在", () => {
  beforeEach(() => {
    initSessionsDir(join(root, "sessions"), { feedbackPath: join(root, "sessions", "feedback.jsonl") });
  });

  it("对存在的会话提交/撤销；对不存在的会话 fail-visible（不凭空建记录）", async () => {
    const { id } = await handleSessionCreate("反馈会话");
    expect(await handleFeedbackSubmit({ sessionId: id, eventId: 4, rating: "up" })).toEqual({ ok: true });
    expect(await handleFeedbackList(id)).toEqual([expect.objectContaining({ eventId: 4, rating: "up" })]);

    const missing = await handleFeedbackSubmit({ sessionId: "nope", eventId: 4, rating: "up" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("不存在");

    expect(await handleFeedbackSubmit({ sessionId: id, eventId: 4, rating: "none" })).toEqual({ ok: true });
    expect(await handleFeedbackList(id)).toEqual([]);
  });
});
