/** 系统提示固定开销这把尺的判卷面（第 90 页）。
 *  重点是**不许把"没数据"读成 0**：占比 null、请求数 0 的流不进表、factor 非正数时不硬算。 */
import { describe, expect, it } from "vitest";

import {
  fixedInputTokens, fixedShare, median, promptCostRows, summarizePromptCost,
} from "../scripts/lib/prompt-cost";

describe("fixedInputTokens / fixedShare", () => {
  it("每请求固定输入 = ceil(字符/factor) × 请求数", () => {
    expect(fixedInputTokens(4100, 3, 4)).toBe(1025 * 3);
  });

  it("请求数 0 或 factor 非正 ⇒ 0，不返回 NaN（NaN 会顺着合计把整表带坏）", () => {
    expect(fixedInputTokens(4000, 0, 4)).toBe(0);
    expect(fixedInputTokens(4000, 5, 0)).toBe(0);
    expect(Number.isNaN(fixedInputTokens(4000, 5, 0))).toBe(false);
  });

  it("实测输入为 0 ⇒ 占比是 null 而不是 0%（缺报≠免费）", () => {
    expect(fixedShare(100, 0)).toBeNull();
    expect(fixedShare(100, 400)).toBe(0.25);
  });

  it("占比封顶 1：提示不可能占超过全部输入（算出 >1 说明请求数或实测口径错了，宁可夹住也不报 130%）", () => {
    expect(fixedShare(900, 100)).toBe(1);
  });
});

describe("promptCostRows：只有真有请求的流进表", () => {
  const rows = promptCostRows(
    [
      { file: "a/I1.events.jsonl", requests: 4, measuredInputTokens: 8000 },
      { file: "b/I2.events.jsonl", requests: 0, measuredInputTokens: 0 },
      { file: "c/I3.events.jsonl", requests: 2, measuredInputTokens: 0 },
    ],
    { promptChars: 4000, factor: 4 },
  );

  it("问答流（0 请求）被排除，且理由随行走", () => {
    expect(rows.map((r) => r.file)).toEqual(["a/I1.events.jsonl", "c/I3.events.jsonl"]);
  });

  it("有请求但实测输入缺报 ⇒ share=null + note 说未记", () => {
    const c = rows.find((r) => r.file === "c/I3.events.jsonl");
    expect(c?.share).toBeNull();
    expect(c?.note).toContain("未记");
  });

  it("合计里 `inputTotal` 只加有数的一条，`medianShare` 忽略 null", () => {
    const s = summarizePromptCost(rows);
    expect(s.streams).toBe(2);
    expect(s.fixedTotal).toBe(4000 + 2000); // 每请求 4000/4=1000 token：a 4 次、c 2 次
    expect(s.inputTotal).toBe(8000);
    expect(s.medianShare).toBe(0.5);
    expect(s.maxShare).toBe(0.5);
  });

  it("空表 ⇒ 三个统计都是 null，不是 0（0 会被读成「这条面量到的是零开销」）", () => {
    const s = summarizePromptCost([]);
    expect(s.medianShare).toBeNull();
    expect(s.maxShare).toBeNull();
    expect(s.fixedTotal).toBe(0);
    expect(median([])).toBeNull();
  });
});
