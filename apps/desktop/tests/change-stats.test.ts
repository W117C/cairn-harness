// 交付卡逐文件行数：DSH 摘要路由给 added/deleted；Cairn 没那条路由，由 changeDiff 的 hunk 现算。
// 判四格：正常 hunk → +N/−M；截断 → 「过大」而不是偏小的数；二进制 → 「二进制」；失败 → 可重试的错误态。
import { describe, expect, it } from "vitest";
import { classifyChangeStat } from "../src/renderer/use-change-stats";

describe("交付卡逐文件行数分类", () => {
  it("正常 hunk：add/del 逐行数", () => {
    expect(classifyChangeStat({
      ok: true, path: "src/a.ts", created: false, truncated: false, bytes: { before: 1, after: 1 },
      hunks: [{ header: "@@", lines: [
        { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
        { kind: "add", text: "b", oldNo: null, newNo: 2 },
        { kind: "add", text: "c", oldNo: null, newNo: 3 },
        { kind: "del", text: "d", oldNo: 2, newNo: null },
      ] }],
    })).toEqual({ kind: "counts", add: 2, del: 1 });
  });

  it("截断：不给偏小行数，标「过大」", () => {
    expect(classifyChangeStat({
      ok: true, path: "src/big.ts", created: false, truncated: true, bytes: { before: 1, after: 1 },
      hunks: [{ header: "@@", lines: [{ kind: "add", text: "b", oldNo: null, newNo: 2 }] }],
    })).toEqual({ kind: "oversized" });
  });

  it("二进制/失败：分类不冒充 0", () => {
    expect(classifyChangeStat({ ok: false, error: "二进制文件不展示差异" })).toEqual({ kind: "binary" });
    expect(classifyChangeStat({ ok: false, error: "当前文件不存在：src/gone.ts" })).toEqual({ kind: "error", message: "当前文件不存在：src/gone.ts" });
    expect(classifyChangeStat(undefined)).toMatchObject({ kind: "error" });
  });
});
