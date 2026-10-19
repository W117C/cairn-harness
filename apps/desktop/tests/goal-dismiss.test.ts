// 已停目标「隐藏」的持久化（2026-10-18）：按会话 id 记账、只收整数；重启后不复活。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dismissedFrom } from "../src/renderer/goal-dismiss";

describe("dismissedFrom", () => {
  it("只收整数；坏数据/空值当没有", () => {
    expect([...dismissedFrom('{"a":3,"b":"3","c":1.5,"d":0}')]).toEqual([["a", 3], ["d", 0]]);
    expect(dismissedFrom(null).size).toBe(0);
    expect(dismissedFrom("{oops").size).toBe(0);
    expect(dismissedFrom("[]").size).toBe(0);
  });

  it("App 启动读 storage、隐藏时写回", () => {
    const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
    expect(app).toContain("useState<Map<string, number>>(() => readDismissedGoals())");
    expect(app).toContain("writeDismissedGoals(next);");
  });
});
