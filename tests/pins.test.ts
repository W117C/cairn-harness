// 消息置顶（2026-10-20 · 销 G6）判卷：append-only sidecar 的生效语义 + 非法入参不落盘 + 坏行可数。
// 形制照 feedback.test.ts（同一个 store 家族）：「改主意」是**追加**不是改写，读时取最后一条；
// 非法入参连文件都不该建起来；会话删除要清掉它的置顶（同 id 新会话不该继承旧 eventId 的高亮）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PinStore } from "../src/main/pins";

let root = "";
let file = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pins-"));
  file = join(root, "pins.jsonl");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("PinStore：append-only 的消息置顶", () => {
  it("置顶 → 生效；取消 → 追加一条 pinned:false，读时不再返回", async () => {
    const store = new PinStore(file);
    await store.append({ sessionId: "s1", eventId: 3, pinned: true });
    expect(await store.listForSession("s1")).toEqual([3]);

    await store.append({ sessionId: "s1", eventId: 3, pinned: false });
    expect(await store.listForSession("s1")).toEqual([]);
    // 追加语义：取消是**新行**，旧行还在流里（可审计），不是把文件改回空。
    const all = await store.listAll();
    expect(all.records).toHaveLength(2);
    expect(all.records[1]?.pinned).toBe(false);
  });

  it("再置顶回来（取消后又置顶）→ 认最后一条", async () => {
    const store = new PinStore(file);
    await store.append({ sessionId: "s1", eventId: 5, pinned: true });
    await store.append({ sessionId: "s1", eventId: 5, pinned: false });
    await store.append({ sessionId: "s1", eventId: 5, pinned: true });
    expect(await store.listForSession("s1")).toEqual([5]);
  });

  it("多条置顶按 eventId 升序返回；跨会话不串", async () => {
    const store = new PinStore(file);
    await store.append({ sessionId: "s1", eventId: 9, pinned: true });
    await store.append({ sessionId: "s1", eventId: 2, pinned: true });
    await store.append({ sessionId: "s2", eventId: 4, pinned: true });
    expect(await store.listForSession("s1")).toEqual([2, 9]);
    expect(await store.listForSession("s2")).toEqual([4]);
  });

  it("非法入参不落盘、不建文件（与 feedback 同一条纪律）", async () => {
    const store = new PinStore(file);
    await expect(store.append({ sessionId: "../etc/passwd", eventId: 1, pinned: true })).rejects.toThrow();
    await expect(store.append({ sessionId: "s1", eventId: 0, pinned: true })).rejects.toThrow();
    await expect(store.append({ sessionId: "s1", eventId: 1.5, pinned: true })).rejects.toThrow();
    // pinned 必须是布尔——字符串 "true" 不该被当成真
    await expect(store.append({ sessionId: "s1", eventId: 1, pinned: "true" })).rejects.toThrow();
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });

  it("坏行可数（skipped），且不污染有效记录", async () => {
    await writeFile(file, '{"sessionId":"s1","eventId":1,"pinned":true,"at":"2026-10-20T00:00:00.000Z"}\nnot-json\n{"bad":1}\n', "utf8");
    const store = new PinStore(file);
    const all = await store.listAll();
    expect(all.records).toHaveLength(1);
    expect(all.skipped).toBe(2); // 丢的要能数出来，不静默
  });

  it("删除会话清掉它的置顶，别的会话不受影响；坏行原样保留", async () => {
    await writeFile(
      file,
      [
        '{"sessionId":"s1","eventId":1,"pinned":true,"at":"2026-10-20T00:00:00.000Z"}',
        '{"sessionId":"s2","eventId":2,"pinned":true,"at":"2026-10-20T00:00:00.000Z"}',
        "broken-line",
        "",
      ].join("\n") + "\n",
      "utf8",
    );
    const store = new PinStore(file);
    expect(await store.removeSession("s1")).toBe(1);
    expect(await store.listForSession("s1")).toEqual([]);
    expect(await store.listForSession("s2")).toEqual([2]);
    // 审计面：坏行不借删除会话顺手清洗
    expect(await readFile(file, "utf8")).toContain("broken-line");
  });

  it("非法 sessionId 在查询侧同样拒绝（不静默返回空）", async () => {
    const store = new PinStore(file);
    await expect(store.listForSession("")).rejects.toThrow();
    await expect(store.removeSession("..")).rejects.toThrow();
  });
});
