// 原生面板人工验收的判读：四种结果各自折算，reason 有话说。
import { describe, expect, it } from "vitest";
import { verdictOf, verdictReason } from "../src/main/native-pick-verdict";

describe("原生面板验收判读", () => {
  it("选中 / 取消 / 超时 / 空 四种", () => {
    expect(verdictOf({ canceled: false, filePaths: ["/a.png"] })).toBe("PASS(selected)");
    expect(verdictOf({ canceled: true, filePaths: [] })).toBe("PASS(canceled)");
    expect(verdictOf({ timeout: true })).toBe("TIMEOUT");
    expect(verdictOf({ canceled: false, filePaths: [] })).toBe("FAIL(empty)");
    expect(verdictOf({ canceled: false, filePaths: [""] })).toBe("FAIL(empty)");
  });

  it("超时优先于其它字段（面板没结算就是没验到）", () => {
    expect(verdictOf({ timeout: true, canceled: true, filePaths: ["/a.png"] })).toBe("TIMEOUT");
  });

  it("每种 verdict 都有说明（人工那一步不用自己解释读数）", () => {
    for (const v of ["PASS(selected)", "PASS(canceled)", "TIMEOUT", "FAIL(empty)"] as const) {
      expect(verdictReason(v).length).toBeGreaterThan(4);
    }
  });
});
