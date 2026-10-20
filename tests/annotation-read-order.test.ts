import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FeedbackStore } from "../src/main/feedback";
import { PinStore } from "../src/main/pins";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function file(name: string) {
  const root = await mkdtemp(join(tmpdir(), "cairn-annotation-order-")); roots.push(root);
  return join(root, name);
}

it("反馈查询等待此前入队的写入，连续改主意立即读到最后一笔", async () => {
  const store = new FeedbackStore(await file("feedback.jsonl"));
  const first = store.append({ sessionId: "s1", eventId: 2, rating: "up" });
  const second = store.append({ sessionId: "s1", eventId: 2, rating: "down" });
  const result = await store.listForSession("s1");
  await Promise.all([first, second]);
  expect(result).toEqual([expect.objectContaining({ eventId: 2, rating: "down" })]);
});
it("置顶查询等待此前入队的写入，包括撤销", async () => {
  const store = new PinStore(await file("pins.jsonl"));
  const first = store.append({ sessionId: "s1", eventId: 2, pinned: true });
  const second = store.append({ sessionId: "s1", eventId: 2, pinned: false });
  const third = store.append({ sessionId: "s1", eventId: 3, pinned: true });
  const result = await store.listForSession("s1");
  await Promise.all([first, second, third]);
  expect(result).toEqual([3]);
});
it("写入失败不阻塞后续查询或合法写入", async () => {
  const store = new FeedbackStore(await file("feedback.jsonl"));
  const failure = store.append({ sessionId: "s1", eventId: 0, rating: "up" }).catch(() => undefined);
  const write = store.append({ sessionId: "s1", eventId: 1, rating: "up" });
  const result = await store.listAll();
  await Promise.all([failure, write]);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({ eventId: 1, rating: "up" });
});
