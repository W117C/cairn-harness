// 退出后果告知判卷（蓝本 §3.3「退出后果告知」）：
// 文案逐字同构 + 闸判据（0 个在跑会话 = 不打扰）。纯函数段，无 Electron 依赖。
import { describe, expect, it } from "vitest";
import { quitWarningMessage, shouldWarnBeforeQuit } from "../src/main/quit-guard";

describe("quitWarningMessage", () => {
  it("逐字同构（品牌名 Cairn；count 进文案）", () => {
    expect(quitWarningMessage(1)).toBe("Cairn 正在 1 个会话中工作。现在退出将中断该工作。");
    expect(quitWarningMessage(3)).toBe("Cairn 正在 3 个会话中工作。现在退出将中断该工作。");
  });
});

describe("shouldWarnBeforeQuit", () => {
  it("有在跑会话才问；0 = 直接退（不打扰）", () => {
    expect(shouldWarnBeforeQuit(0)).toBe(false);
    expect(shouldWarnBeforeQuit(1)).toBe(true);
    expect(shouldWarnBeforeQuit(5)).toBe(true);
  });

  it("负数按 0 处理（防御：计数来源异常时不弹无意义警告）", () => {
    expect(shouldWarnBeforeQuit(-1)).toBe(false);
  });
});
