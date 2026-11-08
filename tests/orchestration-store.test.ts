import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestrationStore } from "../src/orchestration/store";
const dirs: string[] = [];
const stores: OrchestrationStore[] = [];
afterEach(async () => { await Promise.all(stores.splice(0).map(s => s.close())); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "cairn-orchestration-store-")); dirs.push(dir);
  const store = await OrchestrationStore.open(join(dir, "events.jsonl")); stores.push(store); return { dir, store };
}
it("serializes concurrent appends and replays unchanged legacy events", async () => {
  const { store } = await setup();
  await Promise.all(Array.from({ length: 50 }, (_, n) => store.append({ type: "user_message", content: String(n) })));
  expect((await store.events()).map(e => e.type === "user_message" && e.content)).toEqual(Array.from({ length: 50 }, (_, n) => String(n)));
});
it("rejects a second live writer and releases its own lock on close", async () => {
  const { dir, store } = await setup();
  await expect(OrchestrationStore.open(join(dir, "events.jsonl"))).rejects.toThrow(/writer|写入/);
  await store.close(); const next = await OrchestrationStore.open(join(dir, "events.jsonl")); stores.push(next);
});
it("rebuilds from JSONL after snapshot corruption without changing the log", async () => {
  const { dir, store } = await setup();
  await store.append({ type: "user_message", content: "legacy" });
  const before = await readFile(join(dir, "events.jsonl"), "utf8");
  await store.snapshot(); await writeFile(join(dir, "events.jsonl.snapshot.json"), "{broken");
  expect((await store.view()).last_event_id).toBe(1);
  expect(await readFile(join(dir, "events.jsonl"), "utf8")).toBe(before);
});
it("closed stores refuse further appends", async () => {
  const { store } = await setup(); await store.close();
  await expect(store.append({ type: "user_message", content: "late" })).rejects.toThrow(/closed/);
});
