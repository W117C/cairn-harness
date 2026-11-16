// 发言权判卷（ADR 0015 §四 的第三件最小件）：
// 一轮谁先说、谁并行、谁静默、什么时候停机——全是纯函数，可逐条断言。
//
// 判据要点：
//  · 点名 ⇒ 只有被点名的说，且**同一批**（并行，互相看不见这一轮的答复）；
//  · 主持人优先 ⇒ 主持人单独一批先说，其余按声明顺序一人一批；
//  · 静默 ⇒ 这一轮不出现（没有隐形的「续推一回合」）；
//  · 空转守卫 ⇒ 读数到阈值就整体停机（不是让模型自己感觉该停）；
//  · 认不出的 id 不猜、不吞，交回上层记账。
import { describe, expect, it } from "vitest";
import { DEFAULT_IDLE_LIMIT, planRound, type RoundMember } from "../src/orchestration/speech";

const members: RoundMember[] = [
  { id: "m-alpha", chair: true },
  { id: "m-beta" },
  { id: "m-gamma" },
];

describe("发言权", () => {
  it("主持人优先：主持人单独一批，其余按声明顺序一人一批", () => {
    const plan = planRound({ members, mode: "chairFirst" });
    expect(plan.batches).toEqual([
      { order: 1, speakers: ["m-alpha"] },
      { order: 2, speakers: ["m-beta"] },
      { order: 3, speakers: ["m-gamma"] },
    ]);
    expect(plan.paused).toBe(false);
  });

  it("按名单轮：不看 chair，全按声明顺序", () => {
    const plan = planRound({ members, mode: "turnOrder" });
    expect(plan.batches.map((b) => b.speakers)).toEqual([["m-alpha"], ["m-beta"], ["m-gamma"]]);
  });

  it("点名 ⇒ 只有被点名的说，且同一批（并行）", () => {
    const plan = planRound({ members, mode: "chairFirst", mentioned: ["m-gamma", "m-beta"] });
    expect(plan.batches).toEqual([{ order: 1, speakers: ["m-gamma", "m-beta"] }]);
  });

  it("点名里认不出的 id：不猜、不吞，交回上层", () => {
    const plan = planRound({ members, mode: "turnOrder", mentioned: ["m-beta", "m-nobody"] });
    expect(plan.batches).toEqual([{ order: 1, speakers: ["m-beta"] }]);
    expect(plan.unknown).toEqual(["m-nobody"]);
  });

  it("静默：这一轮不出现在任何批里（没有隐形续推回合）", () => {
    const plan = planRound({ members, mode: "chairFirst", silent: ["m-beta"] });
    expect(plan.batches.map((b) => b.speakers)).toEqual([["m-alpha"], ["m-gamma"]]);
    expect(plan.silent).toEqual(["m-beta"]);
  });

  it("点名到的人全静默 ⇒ 这一轮没人发言（不是空批）", () => {
    const plan = planRound({ members, mode: "chairFirst", mentioned: ["m-beta"], silent: ["m-beta"] });
    expect(plan.batches).toEqual([]);
  });

  it("空转守卫：读数到阈值 ⇒ 整体停机等人", () => {
    const atLimit = planRound({ members, mode: "chairFirst", idleRounds: DEFAULT_IDLE_LIMIT });
    expect(atLimit.paused).toBe(true);
    expect(atLimit.pausedReason).toBe("idle");
    expect(atLimit.batches).toEqual([]);
    const below = planRound({ members, mode: "chairFirst", idleRounds: DEFAULT_IDLE_LIMIT - 1 });
    expect(below.paused).toBe(false);
    // 阈值可配
    expect(planRound({ members, mode: "chairFirst", idleRounds: 2, idleLimit: 2 }).paused).toBe(true);
  });

  it("重复成员声明只算一次（取第一次出现的位置）", () => {
    const plan = planRound({
      members: [{ id: "m-alpha" }, { id: "m-alpha" }, { id: "m-beta" }],
      mode: "turnOrder",
    });
    expect(plan.batches.map((b) => b.speakers)).toEqual([["m-alpha"], ["m-beta"]]);
  });

  it("纯函数：同一输入算两次逐字相同", () => {
    const input = { members, mode: "chairFirst" as const, mentioned: ["m-alpha"], silent: ["m-gamma"] };
    expect(planRound(input)).toEqual(planRound(input));
  });
});
