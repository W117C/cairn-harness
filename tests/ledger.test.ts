import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { ObservationLedger, LEDGER_THRESHOLD_BYTES, RECALL_MAX_BYTES, RECALL_MAX_LINES,
  type AuthorizedRedactedText, type LedgerOptions } from "../src/agent/ledger";
import { captureObservation, createObservationRecallTool } from "../src/tools/observation-capture";

let root: string;
const text = "authorized [REDACTED] diagnostic\n".repeat(600);
const source = (value = text): AuthorizedRedactedText => ({ kind: "authorized-redacted-text", text: value });
const input = (value = text, callId = "call-1") => ({ toolName: "run_shell", callId, source: source(value) });
const ledger = (options: Partial<LedgerOptions> = {}) => new ObservationLedger({ sessionDataDir: root, sessionId: "session-1", enabled: true, ...options });
beforeEach(async () => {
  if (!process.env.PI_SCRATCH_DIR) throw new Error("PI_SCRATCH_DIR required: never put ledger test data in workspace");
  root = await fs.realpath(await fs.mkdtemp(join(process.env.PI_SCRATCH_DIR, "ledger-test-")));
});
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe("authorized text ledger", () => {
  it("defaults disabled: no FS, no altered result/events/projection or tool", async () => {
    const store = ledger({ enabled: undefined, sessionDataDir: join(root, "nonexistent") });
    const result = { ok: false, output: text };
    const eventBefore = JSON.stringify(result);
    const captured = await captureObservation(store, { ...input(), result });
    expect(captured).toEqual({ result });
    expect(captured.result).toBe(result);
    expect(JSON.stringify(result)).toBe(eventBefore);
    expect(await store.archive(input())).toBeUndefined();
    expect(await store.project({ id: "bad", text, requestNumber: 100 })).toEqual({ text, archived: false });
    await store.clear(); await store.delete("bad"); await store.deleteSession();
    expect(createObservationRecallTool(store)).toBeUndefined();
    expect(await fs.readdir(root)).toEqual([]);
  });
  it("archives strictly >10KB, content addresses and fsyncs durable text, preserving full events", async () => {
    const store = ledger();
    expect(await store.archive(input("a".repeat(LEDGER_THRESHOLD_BYTES)))).toBeUndefined();
    expect(await fs.readdir(root)).toEqual([]);
    const value = "a".repeat(LEDGER_THRESHOLD_BYTES + 1);
    const r = (await store.archive(input(value)))!;
    expect(r.bytes).toBe(Buffer.byteLength(value));
    expect(r.lines).toBe(1);
    expect(r.id).toMatch(/^obs_[a-f0-9]{24}$/);
    expect(r.sha256).toBe(createHash("sha256").update(value).digest("hex"));
    expect(r.path).toBe(join(root, "ledger-session-1", "objects", `${r.sha256}.txt`));
    expect(await fs.readFile(r.path, "utf8")).toBe(value);
    expect((await fs.stat(r.path)).mode & 0o777).toBe(0o600);
    expect((await ledger().recall({ id: r.id })).text).toBe(value);
    const result = { ok: false, output: text };
    const cap = await captureObservation(store, { ...input(), result });
    expect(cap.result).toBe(result);
    expect(cap.observation?.text).toBe(text);
    expect(cap.observation?.archived).toBe(true);
  });
  it("isolates identical observations by session and never accepts paths from recall arguments", async () => {
    const a = ledger(), b = ledger({ sessionId: "session-2" });
    const ar = (await a.archive(input()))!, br = (await b.archive(input()))!;
    expect(ar.id).not.toBe(br.id);
    expect(ar.path).not.toBe(br.path);
    await expect(b.recall({ id: ar.id })).rejects.toMatchObject({ code: "ESTALE" });
    const tool = createObservationRecallTool(b)!;
    expect((await tool.run({ id: ar.id }, { workspace: root })).ok).toBe(false);
    expect(await tool.run({ id: br.id, dir: a.directory }, { workspace: root })).toMatchObject({ ok: false, output: expect.stringContaining("EINVAL") });
    expect(() => ledger({ sessionId: "../../escape" })).toThrow("EINVAL");
    for (const id of ["../index.json", "obs_" + "A".repeat(24), "obs_a", ""]) await expect(a.recall({ id })).rejects.toMatchObject({ code: "EINVAL" });
  });
  it.each(["bytes", "lines"] as const)("round-trips UTF-8 %s pages including long lines and trailing newlines", async by => {
    const value = "😀汉字\r\n".repeat(700) + "🧪".repeat(18000) + "\nfinal\n";
    const store = ledger();
    const r = (await store.archive(input(value)))!;
    let offset = 0, byteInLine = 0, rebuilt = "", pages = 0;
    for (;;) {
      const p = await store.recall({ id: r.id, by, offset, byteInLine, max: 999999 });
      expect(Buffer.byteLength(p.text)).toBeLessThanOrEqual(RECALL_MAX_BYTES);
      expect(p.text.split("\n").length - Number(p.text.endsWith("\n"))).toBeLessThanOrEqual(RECALL_MAX_LINES);
      expect(p.text).not.toContain("�");
      expect(p.text.length).toBeGreaterThan(0);
      rebuilt += p.text; pages++;
      if (p.eof) break;
      offset = p.nextOffset!; byteInLine = p.nextByteInLine ?? 0;
      expect(pages).toBeLessThan(30);
    }
    expect(pages).toBeGreaterThan(4);
    expect(Buffer.from(rebuilt)).toEqual(Buffer.from(value));
  });
  it("validates offsets and avoids non-progress UTF-8 pages", async () => {
    const store = ledger();
    const r = (await store.archive(input("😀".repeat(4000))))!;
    for (const args of [{ offset: -1 }, { offset: 0.5 }, { max: 0 }, { max: NaN }, { offset: 1 }, { offset: 20000 }, { max: 1 }, { by: "lines" as const, offset: 2 }, { by: "lines" as const, byteInLine: 16000 }]) {
      await expect(store.recall({ id: r.id, ...args })).rejects.toBeInstanceOf(Error);
    }
    expect(await store.recall({ id: r.id, offset: 16000 })).toEqual({ text: "", eof: true });
    const page = await store.recall({ id: r.id, max: 5 });
    expect(page).toEqual({ text: "😀", eof: false, nextOffset: 4 });
  });
  it("projects only third and later requests, revalidates, never mutates full source", async () => {
    const store = ledger(); const r = (await store.archive(input()))!;
    for (const requestNumber of [1, 2]) expect((await store.project({ id: r.id, text, requestNumber })).text).toBe(text);
    const p = await store.project({ id: r.id, text, requestNumber: 3 });
    expect(p.text.length).toBeLessThan(text.length);
    expect(p.text).toContain(r.id);
    expect(await fs.readFile(r.path, "utf8")).toBe(text);
    expect(await store.project({ id: r.id, text: text + "changed", requestNumber: 3 })).toMatchObject({ archived: false, text: text + "changed", error: expect.stringContaining("ECORRUPT") });
    await fs.unlink(r.path);
    for (const requestNumber of [1, 2, 3, 4]) expect(await store.project({ id: r.id, text, requestNumber })).toMatchObject({ text, archived: false, error: expect.stringContaining("ENOENT") });
    await expect(store.recall({ id: r.id })).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("hash-checks same-size corruption both on recall and deduplicated capture", async () => {
    const store = ledger(); const r = (await store.archive(input()))!;
    await fs.writeFile(r.path, "z".repeat(r.bytes));
    await expect(store.recall({ id: r.id })).rejects.toMatchObject({ code: "ECORRUPT" });
    for (let i = 0; i < 3; i++) expect(await store.capture(input())).toMatchObject({ text, archived: false, error: expect.stringContaining("ECORRUPT") });
    expect(await store.project({ id: r.id, text, requestNumber: 3 })).toMatchObject({ text, archived: false, error: expect.any(String) });
  });
  it.each(["object", "index", "objects-dir", "session-dir"])("rejects %s symlinks without following them", async target => {
    const store = ledger(); const r = (await store.archive(input()))!;
    const path = target === "object" ? r.path : target === "index" ? join(store.directory, "index.json") : target === "objects-dir" ? dirname(r.path) : store.directory;
    const moved = join(root, "moved");
    await fs.rename(path, moved); await fs.symlink(moved, path);
    await expect(store.recall({ id: r.id })).rejects.toMatchObject({ code: "ELOOP" });
    expect(await store.capture(input())).toMatchObject({ text, archived: false, error: expect.stringContaining("ELOOP") });
  });
  it("rejects nonregular objects, hardlinks and corrupted manifests", async () => {
    const store = ledger(); const r = (await store.archive(input()))!;
    await fs.link(r.path, join(root, "hardlink"));
    await expect(store.recall({ id: r.id })).rejects.toMatchObject({ code: "EINVAL" });
    await fs.unlink(r.path); await fs.mkdir(r.path);
    await expect(store.recall({ id: r.id })).rejects.toMatchObject({ code: "EINVAL" });
    await fs.writeFile(join(store.directory, "index.json"), "null");
    await expect(store.recall({ id: r.id })).rejects.toMatchObject({ code: "ECORRUPT" });
  });
  it("enforces byte/object quotas across restart and concurrent instances; dedup consumes no extra bytes", async () => {
    const config = { maxTotalBytes: Buffer.byteLength(text), maxObjects: 1 };
    const a = ledger(config); const r = (await a.archive(input()))!;
    const b = ledger(config);
    expect((await b.archive(input()))!.id).toBe(r.id);
    expect((await b.archive(input(text, "another-call")))!.path).toBe(r.path);
    const outcomes = await Promise.all([a.capture(input(text + "new", "a")), b.capture(input(text + "different", "b"))]);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ archived: false, error: expect.stringContaining("EQUOTA") });
    expect(await fs.readdir(dirname(r.path))).toEqual([`${r.sha256}.txt`]);
  });
  it("counts entries separately and serializes concurrent allocations", async () => {
    const a = ledger({ maxEntries: 1 }); const b = ledger({ maxEntries: 1 });
    const results = await Promise.all([a.capture(input(text, "a")), b.capture(input(text, "b"))]);
    expect(results.filter(r => r.archived)).toHaveLength(1);
    expect(results.filter(r => r.error?.includes("EQUOTA"))).toHaveLength(1);
    expect(await ledger({ maxObjectBytes: 11000 }).capture(input())).toMatchObject({ archived: false, text, error: expect.stringContaining("EQUOTA") });
  });
  it("counts orphaned objects after interrupted commits and exposes a crash-held lock", async () => {
    const a = ledger({ maxObjects: 1 }); const r = (await a.archive(input()))!;
    const index = join(a.directory, "index.json");
    const m = JSON.parse(await fs.readFile(index, "utf8")); m.entries = {};
    await fs.writeFile(index, JSON.stringify(m));
    expect(await ledger({ maxObjects: 1 }).capture(input(text + "x"))).toMatchObject({ archived: false, error: expect.stringContaining("EQUOTA") });
    await fs.writeFile(join(a.directory, ".lock"), "");
    expect(await a.capture(input())).toMatchObject({ archived: false, error: expect.stringContaining("EBUSY") });
    expect(await fs.readFile(r.path, "utf8")).toBe(text);
  });
  it("delete/clear reclaim quotas, preserve shared objects and invalidate handles durably", async () => {
    const a = ledger({ maxObjects: 1 }); const r = (await a.archive(input()))!;
    const other = (await a.archive(input(text, "other")))!;
    await a.delete(r.id);
    expect((await a.recall({ id: other.id })).text.length).toBeGreaterThan(0);
    await expect(a.recall({ id: r.id })).rejects.toMatchObject({ code: "ESTALE" });
    const repeated = (await a.archive(input()))!;
    expect(repeated.id).not.toBe(r.id);
    await a.clear();
    expect(await fs.readdir(dirname(r.path))).toEqual([]);
    await expect(ledger().recall({ id: repeated.id })).rejects.toMatchObject({ code: "ESTALE" });
    const fresh = (await a.archive(input(text + "fresh")))!;
    expect(fresh.id).not.toBe(r.id);
    await a.deleteSession();
    expect(await fs.readdir(dirname(r.path))).toEqual([]);
    expect(await ledger().capture(input())).toMatchObject({ text, archived: false, error: expect.stringContaining("ESTALE") });
    expect(await a.project({ id: fresh.id, text, requestNumber: 3 })).toMatchObject({ text, archived: false, error: expect.stringContaining("ESTALE") });
  });
  it("physical session deletion gives visible missing errors and no projection recreation", async () => {
    const a = ledger(); const r = (await a.archive(input()))!;
    await fs.rm(a.directory, { recursive: true });
    const p = await a.project({ id: r.id, text, requestNumber: 3 });
    expect(p).toMatchObject({ text, archived: false, error: expect.stringContaining("ENOENT") });
    expect(await fs.readdir(root)).toEqual([]);
    const tool = createObservationRecallTool(a)!;
    expect(await tool.run({ id: r.id }, { workspace: root })).toMatchObject({ ok: false, output: expect.stringContaining("ENOENT") });
  });
  it.each(["object-write", "index-write", "rename"])("ENOSPC injected during %s fails open, exposes errors, leaves bounded state", async phase => {
    const good = ledger(); await good.clear();
    const diskFull = () => Object.assign(new Error("simulated disk full"), { code: "ENOSPC" });
    const io = { ...fs,
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        const path = String(args[0]);
        if ((phase === "object-write" && path.endsWith(".txt")) || (phase === "index-write" && path.endsWith(".index.tmp"))) {
          handle.writeFile = async () => { throw diskFull(); };
        }
        return handle;
      },
      rename: async (...args: Parameters<typeof fs.rename>) => { if (phase === "rename") throw diskFull(); return fs.rename(...args); },
    } as typeof fs;
    const a = ledger({ fs: io });
    for (let i = 0; i < 3; i++) expect(await a.capture(input())).toMatchObject({ text, archived: false, error: expect.stringContaining("ENOSPC") });
    expect((await fs.readdir(a.directory)).sort()).toEqual(["index.json", "objects"]);
    expect((await fs.readdir(join(a.directory, "objects"))).length).toBeLessThanOrEqual(1);
    const r = (await good.archive(input()))!;
    expect((await good.recall({ id: r.id })).text.length).toBeGreaterThan(0);
  });
  it("retries interrupted session deletion without reviving its tombstoned handles", async () => {
    const good = ledger(); const r = (await good.archive(input()))!;
    let fail = true;
    const io = { ...fs, unlink: async (path: Parameters<typeof fs.unlink>[0]) => {
      if (String(path).endsWith(".txt") && fail) throw Object.assign(new Error("disk failure"), { code: "EIO" });
      return fs.unlink(path);
    } } as typeof fs;
    const a = ledger({ fs: io });
    await expect(a.deleteSession()).rejects.toMatchObject({ code: "EIO" });
    await expect(good.recall({ id: r.id })).rejects.toMatchObject({ code: "ESTALE" });
    fail = false;
    await a.deleteSession(); await a.deleteSession(); await ledger().deleteSession();
    expect(await fs.readdir(dirname(r.path))).toEqual([]);
  });
  it("honors short line pages and reclaims the final shared object on delete", async () => {
    const a = ledger(); const r = (await a.archive(input()))!;
    const page = await a.recall({ id: r.id, by: "lines", offset: 2, max: 7 });
    expect(page.text).toBe(text.split("\n").slice(2, 9).join("\n") + "\n");
    expect(page.nextOffset).toBe(9);
    expect(page.nextByteInLine).toBe(0);
    const tool = createObservationRecallTool(a)!;
    const result = await tool.run({ id: r.id, by: "lines", max: 7 }, { workspace: root });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output).nextOffset).toBe(7);
    await a.delete(r.id);
    expect(await fs.readdir(dirname(r.path))).toEqual([]);
  });
  it("never treats raw buffers or a redaction mismatch as authorized archival input", async () => {
    const a = ledger();
    await expect(a.archive({ ...input(), source: { kind: "raw-bytes", text } as unknown as AuthorizedRedactedText })).rejects.toMatchObject({ code: "EAUTH" });
    const result = { ok: true, output: text };
    const cap = await captureObservation(a, { ...input("secret" + text), result });
    expect(cap.result).toBe(result);
    expect(cap.observation).toMatchObject({ archived: false, error: expect.stringContaining("EAUTH") });
    expect(await fs.readdir(root)).toEqual([]);
    expect(await a.capture(input(text + "\ud800"))).toMatchObject({ archived: false, error: expect.stringContaining("EINVAL") });
    expect(await a.capture(input(text + "\0"))).toMatchObject({ archived: false, error: expect.stringContaining("EINVAL") });
  });
});

// #56（第 73 页）：预览帽那 1024 是按**字节**切的，一刀落在汉字中间时交出去的必须是完整码位。
// 这个形状原先没被观测过：本文件的默认样本 `text` 是纯 ASCII ⇒ 判据写在字节回退那一行上，
// 而取料面从来没有跨界样本（本仓点名的「两头断」：helper 有测、面没测）。
describe("预览帽的 UTF-8 缝", () => {
  const replacementChar = String.fromCharCode(0xfffd); // 源码里不留裸字符（同 `utf8-text-safety` 的写法）
  const cjk = "汉".repeat(5000); // 15000 字节 ⇒ 过 `LEDGER_THRESHOLD_BYTES`，且 1024 那一刀落在第 342 个汉字里
  it("前提：跨界样本真的跨界（前提不成立就撤针，假锚点比没锚点更坏）", () => {
    const buf = Buffer.from(cjk, "utf8");
    expect(buf.length).toBeGreaterThan(1024);
    expect((buf[1024]! & 0xc0) === 0x80).toBe(true); // 刀口右边是延续字节 ⇒ 这个字符被切开了
    expect(buf.subarray(0, 1024).toString("utf8").includes(replacementChar)).toBe(true); // 裸切确实出问号
  });

  it("project 的预览行不含半个字符，且仍是原文的前缀（退到最近一个完整码位）", async () => {
    const store = ledger();
    const r = (await store.archive(input(cjk)))!;
    expect(r).toBeTruthy();
    const p = await store.project({ id: r.id, text: cjk, requestNumber: 3 });
    const preview = p.text.split("\n")[0]!;
    expect(preview.includes(replacementChar), "交出去的预览里有半个汉字").toBe(false);
    expect(cjk.startsWith(preview)).toBe(true);
    expect(preview).toBe("汉".repeat(341)); // 1023 字节：1024 那一格属于第 342 个字符，整串退掉
  });
});
