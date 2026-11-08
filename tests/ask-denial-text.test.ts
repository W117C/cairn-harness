// 事故 3（INCIDENTS.md）：非交互档下 `rm` 被拒后，模型连试三次同一命令。
// 拒单文案已经说了「不是档位禁止」，但没说「别原样重发」——三个分支里只有 user 那一支写了。
// 判据：三支拒单都必须带同一句「不要用相同参数重发同一个调用」，且都必须点明工具没有执行。
import { describe, expect, it } from "vitest";
import { askDenialText } from "../src/main/tool-gates";

describe("审批拒单文案", () => {
  for (const reason of ["user", "timeout", "unattended"] as const) {
    it(`${reason}：说明没执行 + 不许原样重发`, () => {
      const text = askDenialText(reason);
      expect(text).toContain("该工具没有执行");
      expect(text).toContain("不要用相同参数重发同一个调用");
    });
  }

  it("同形对照：不是三支共用同一句模板（timeout 仍自述「等审批变化」）", () => {
    expect(askDenialText("timeout")).toContain("授权状态尚未变化");
  });
});
