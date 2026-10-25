// 单会话日志扫描判卷（2026-10-21 批 131）：坏行如实计数、无关行不计数、
// cache 以 size+mtime 失效（文件长大会重读）。
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scanUsageFile, type UsageFileCache } from "../src/main/usage-ledger-scan";

const dir = mkdtempSync(join(tmpdir(), "cairn-usage-scan-"));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const line = (row: unknown): string => JSON.stringify(row) + "\n";

describe("scanUsageFile", () => {
  it("只折 usage / tool_call / user_message；坏行计数但不断整份", async () => {
    const file = join(dir, "s1.jsonl");
    writeFileSync(file, [
      line({ type: "session_meta", session_id: "s1" }),
      line({ type: "user_message", content: "一" }),
      line({ type: "user_message", content: "子任务", agent_id: "w1" }),
      line({ type: "tool_call", id: "t1", name: "read_file", args: {} }),
      line({ type: "tool_call", id: "t2", name: "read_file", args: {}, agent_id: "w1" }),
      line({ type: "usage", inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 7 }),
      '{"type":"usage", broken\n', // JSON 坏 ⇒ badLines
      '{"type":"assistant_message", broken\n', // 不含关键词的坏行也要计数（评审：旧实现静默漏掉）
      line({ type: "assistant_message", content: "回" }),
    ].join(""));
    const r = await scanUsageFile(file);
    expect(r.badLines).toBe(2);
    expect(r.totals).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, usageCount: 1, toolSteps: 1, rounds: 1 });
  });

  it("cache：同 size+mtime 复用；文件长大即重读", async () => {
    const file = join(dir, "s2.jsonl");
    writeFileSync(file, line({ type: "usage", inputTokens: 10, outputTokens: 1 }));
    const cache: UsageFileCache = new Map();
    const first = await scanUsageFile(file, cache);
    expect(first.totals.usageCount).toBe(1);
    const second = await scanUsageFile(file, cache);
    expect(second.totals).toEqual(first.totals);

    appendFileSync(file, line({ type: "usage", inputTokens: 5, outputTokens: 2 }));
    const third = await scanUsageFile(file, cache);
    expect(third.totals.inputTokens).toBe(15);
    expect(third.totals.usageCount).toBe(2);
  });

  it("读不了的文件 reject（由上层计 skipped，不在这里假装 0）", async () => {
    await expect(scanUsageFile(join(dir, "nope.jsonl"))).rejects.toBeTruthy();
  });
});

describe("坏行口径（2026-10-21 评审修）", () => {
  it("尾行没有换行且 JSON 不完整 ⇒ 视为在飞半行，不算损坏", async () => {
    const file = join(dir, "partial.jsonl");
    writeFileSync(file, line({ type: "usage", inputTokens: 1, outputTokens: 1 }) + '{"type":"usage", half');
    const r = await scanUsageFile(file);
    expect(r.badLines).toBe(0);
    expect(r.totals.usageCount).toBe(1);
  });

  it("尾行有换行但 JSON 坏 ⇒ 真损坏，照常计数", async () => {
    const file = join(dir, "broken-tail.jsonl");
    writeFileSync(file, line({ type: "usage", inputTokens: 1, outputTokens: 1 }) + '{"type":"usage", broken\n');
    const r = await scanUsageFile(file);
    expect(r.badLines).toBe(1);
  });
});
