// 事故 `failed-run-still-ledgers`（INCIDENTS.md）：maxSteps 中止的跑没有账本。
// 最该拿来学习的失败跑恰恰不入账，自进化面看到的全是幸存者。
import { describe, expect, it } from "vitest";
import { withPostRunReadingsOnThrow } from "../src/main/post-run-readings";

describe("失败跑也要落读数", () => {
  it("先读数、再抛原错", async () => {
    const calls: string[] = [];
    await expect(
      withPostRunReadingsOnThrow(
        async () => { throw new Error("agent loop 超过 maxSteps=50"); },
        async () => { calls.push("emit"); },
      ),
    ).rejects.toThrow("maxSteps=50");
    expect(calls).toEqual(["emit"]);
  });

  it("读数自己失败不许掩盖原错", async () => {
    await expect(
      withPostRunReadingsOnThrow(
        async () => { throw new Error("原错"); },
        async () => { throw new Error("读数错"); },
      ),
    ).rejects.toThrow("原错");
  });

  it("成功路径不重复读数（只由调用方收尾），返回值原样透传", async () => {
    const calls: string[] = [];
    const r = await withPostRunReadingsOnThrow(async () => 42, async () => { calls.push("emit"); });
    expect(r).toBe(42);
    expect(calls).toEqual([]);
  });
});
