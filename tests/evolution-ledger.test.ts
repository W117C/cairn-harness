// 闭环 v2 批次 A1 判卷：evolution 账本（追加式事件账 + 投影 + 复发升级）。
// 纪律判据：坏行只丢那一条、resolved 打断复发连击、无 emit 的 observe 不编造计数、
// 中位数空集 = null（不折成 0）。
import { describe, expect, it } from "vitest";
import {
  appendLedger,
  escalateNote,
  evolutionLedgerPathFor,
  ledgerEventsFor,
  loadLedger,
  medianOf,
  parseLedgerLine,
  projectLedger,
  RECURRENCE_ESCALATE_MIN_STREAK,
  type LedgerEvent,
  type LedgerKeyStats,
} from "../src/agent/evolution/ledger.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ledger parseLedgerLine", () => {
  it("三类事件各自往返 parse", () => {
    const run: LedgerEvent = { v: 1, type: "run", ts: 1, session: "s1", verifyOutcome: "red", patches: 2, tokensPerBoundary: 50_000, costMeasurable: true };
    const emit: LedgerEvent = { v: 1, type: "emit", ts: 2, key: "verify-escalate:code", kind: "verify-escalate", note: "n" };
    const observe: LedgerEvent = { v: 1, type: "observe", ts: 3, key: "verify-escalate:code", status: "recurred", observed: "o" };
    for (const e of [run, emit, observe]) {
      expect(parseLedgerLine(JSON.stringify(e))).toEqual(e);
    }
  });

  it("反向：坏 JSON / 版本不认 / 取值域外 / 字段缺型 ⇒ null", () => {
    expect(parseLedgerLine("{not json")).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ v: 2, type: "run", ts: 1, verifyOutcome: "red", patches: 0 }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ v: 1, type: "run", ts: 1, verifyOutcome: "purple", patches: 0 }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ v: 1, type: "observe", ts: 1, key: "k", status: "weird", observed: "o" }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ v: 1, type: "emit", ts: 1, key: "k", kind: "new-kind", note: "n" }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ v: 1, type: "run", ts: 1, verifyOutcome: "red", patches: 0, tokensPerBoundary: "many" }))).toBeNull();
  });
});

describe("ledger projectLedger", () => {
  const emit = (ts: number): LedgerEvent => ({ v: 1, type: "emit", ts, key: "cost-throttle", kind: "cost-throttle", note: "n" });
  const observe = (ts: number, status: "resolved" | "recurred" | "inconclusive"): LedgerEvent =>
    ({ v: 1, type: "observe", ts, key: "cost-throttle", status, observed: "o" });

  it("复发连击跨轮累加；resolved 清零后再犯从头数", () => {
    const p = projectLedger([emit(1), observe(2, "recurred"), emit(3), observe(4, "recurred"), emit(5), observe(6, "resolved"), emit(7), observe(8, "recurred")]);
    const s = p.stats["cost-throttle"]!;
    expect(s.emitted).toBe(4);
    expect(s.recurred).toBe(3);
    expect(s.resolved).toBe(1);
    expect(s.lastStatus).toBe("recurred");
    // 第三段：resolved 之后只犯了一次 ⇒ streak 1（不是 3）——「又来了」要重新数起。
    expect(s.recurrenceStreak).toBe(1);
  });

  it("inconclusive 不打断连击也不加连击（读数缺席既不是复发也不是消解）", () => {
    const p = projectLedger([emit(1), observe(2, "recurred"), emit(3), observe(4, "inconclusive"), emit(5), observe(6, "recurred")]);
    const s = p.stats["cost-throttle"]!;
    expect(s.recurrenceStreak).toBe(2);
    expect(s.inconclusive).toBe(1);
  });

  it("反向：没发出过就有 observe ⇒ 不编造 emit 计数（残段不进投影）", () => {
    const p = projectLedger([observe(1, "recurred")]);
    expect(p.stats["cost-throttle"]).toBeUndefined();
  });

  it("run 计数与成本读数：recentTokensPerBoundary 只收可测值、封顶 20 条", () => {
    const events: LedgerEvent[] = [];
    for (let i = 0; i < 25; i++) {
      events.push({ v: 1, type: "run", ts: i, verifyOutcome: "none", patches: 0, tokensPerBoundary: i % 2 === 0 ? i : null, costMeasurable: i % 2 === 0 });
    }
    const p = projectLedger(events);
    expect(p.runs).toBe(25);
    expect(p.recentTokensPerBoundary.length).toBe(13); // 25 轮里 13 个偶数（i%2==0 时才可测），未到 20 帽
    expect(p.recentTokensPerBoundary[p.recentTokensPerBoundary.length - 1]).toBe(24);
  });
});

describe("ledger escalateNote / medianOf", () => {
  it("连击 ≥ 阈值 ⇒ 前缀「第 N 次复发」；不足 / 无账 ⇒ 原样", () => {
    const stats = (streak: number): LedgerKeyStats => ({ key: "k", kind: "cost-throttle", emitted: 9, resolved: 0, recurred: streak, inconclusive: 0, recurrenceStreak: streak, lastStatus: "recurred", lastTs: 1 });
    expect(escalateNote("n", stats(RECURRENCE_ESCALATE_MIN_STREAK))).toBe("（第 " + String(RECURRENCE_ESCALATE_MIN_STREAK) + " 次复发）n");
    expect(escalateNote("n", stats(RECURRENCE_ESCALATE_MIN_STREAK - 1))).toBe("n");
    expect(escalateNote("n", undefined)).toBe("n");
  });

  it("medianOf：空 ⇒ null；奇偶两形", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([3])).toBe(3);
    expect(medianOf([1, 9, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("ledger 落账往返（tmp 工作区）", () => {
  it("appendLedger → loadLedger 往返；坏行只丢那一条并计数", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-ledger-"));
    try {
      const signals = { verifyOutcome: "red" as const, tokensPerBoundary: 41_000, costMeasurable: true };
      const events = ledgerEventsFor(1, "sess-a", signals, [{ kind: "cost-throttle", tokensPerBoundary: 41_000, note: "n" }], [{ key: "cost-throttle", status: "recurred", observed: "o" }]);
      expect(events.length).toBe(3); // run + emit + observe
      await appendLedger(root, events);
      // 手工塞一行坏行（模拟中途写坏）：load 只丢这一行，别的不受牵连。
      const { appendFile } = await import("node:fs/promises");
      await appendFile(evolutionLedgerPathFor(root), "{broken\n", "utf8");
      const loaded = await loadLedger(root);
      expect(loaded.badLines).toBe(1);
      expect(loaded.events.length).toBe(3);
      expect(projectLedger(loaded.events).runs).toBe(1);
      const raw = await readFile(evolutionLedgerPathFor(root), "utf8");
      expect(raw.endsWith("\n")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("文件缺失 ⇒ 空账不抛", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-ledger-"));
    try {
      const loaded = await loadLedger(root);
      expect(loaded.events).toEqual([]);
      expect(loaded.badLines).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
