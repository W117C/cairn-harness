
import { describe, expect, it } from "vitest";
import { dismissedFrom, dismissedGoalAt, dismissedGoalKey, writeDismissedGoals } from "../src/renderer/goal-dismiss";
import { readAppSurface } from "./helpers/app-surface";

describe("dismissedFrom", () => {
  it("只收整数；坏数据/空值当没有", () => {
    expect([...dismissedFrom('{"a":3,"b":"3","c":1.5,"d":0}')]).toEqual([["a", 3], ["d", 0]]);
    expect(dismissedFrom(null).size).toBe(0);
    expect(dismissedFrom("{oops").size).toBe(0);
    expect(dismissedFrom("[]").size).toBe(0);
  });

  it("App 启动读 storage、隐藏时写回", () => {
    const app = readAppSurface();
    expect(app).toContain("useState<Map<string, number>>(() => readDismissedGoals())");
    expect(app).toContain("writeDismissedGoals(next);");
  });

  it("隐藏记录按工作区限定；裸 id 只在工作区未知时兼容", () => {
    const goals = new Map([
      [dismissedGoalKey("/a", "same"), 3],
      [dismissedGoalKey("/b", "same"), 8],
      ["legacy", 5],
    ]);
    expect(dismissedGoalAt(goals, "/a", "same")).toBe(3);
    expect(dismissedGoalAt(goals, "/b", "same")).toBe(8);
    expect(dismissedGoalAt(goals, "/c", "same")).toBeUndefined();
    expect(dismissedGoalAt(goals, "/a", "legacy")).toBeUndefined();
    expect(dismissedGoalAt(goals, null, "legacy")).toBe(5);
    expect(dismissedGoalKey("/a", "same")).not.toBe(dismissedGoalKey("/b", "same"));
    const stored = new Map<string, number>();
    writeDismissedGoals(stored);
    expect(stored.size).toBe(0);
  });
});
