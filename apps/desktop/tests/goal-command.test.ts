// /goal 参数解析（2026-10-18）：斜杠说明承诺“轮次/美元上限”，现在真的认 --turns / --usd。
import { describe, expect, it } from "vitest";
import { parseGoalCommand } from "../src/renderer/goal-command";

describe("parseGoalCommand", () => {
  it("非 /goal 返回 null；纯目标原样", () => {
    expect(parseGoalCommand("你好")).toBeNull();
    expect(parseGoalCommand("/goals x")).toBeNull();
    expect(parseGoalCommand("/goal 完成小目标")).toEqual({ objective: "完成小目标" });
  });

  it("--turns / --usd 可单用、可组合、可与目标换序", () => {
    expect(parseGoalCommand("/goal --turns 3 修好测试")).toEqual({ objective: "修好测试", maxTurns: 3 });
    expect(parseGoalCommand("/goal --usd 0.5 另一个目标")).toEqual({ objective: "另一个目标", maxUsd: 0.5 });
    expect(parseGoalCommand("/goal --turns 2 --usd 1.25 组合")).toEqual({ objective: "组合", maxTurns: 2, maxUsd: 1.25 });
    expect(parseGoalCommand("/goal 目标在前的写法 --turns 4")).toEqual({ objective: "目标在前的写法", maxTurns: 4 });
  });

  it("非法参数留在目标里（不静默吞字）；只有参数时目标为空", () => {
    expect(parseGoalCommand("/goal --turns abc 目标")).toEqual({ objective: "--turns abc 目标" });
    expect(parseGoalCommand("/goal --turns 2")).toEqual({ objective: "", maxTurns: 2 });
  });
});
