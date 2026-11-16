// 成员档案判卷（ADR 0015 §四 的第一件最小件）：
// 档案是**投影**——写侧只往既有补丁通道追加 `member.<id>.<字段>`，读侧重建名单。
//
// 判据要点：
//  · 重建可重复：同一份补丁重放两次逐字相同；
//  · 权限单调继承：成员档宽于团队档 ⇒ 按 `clampTier` 裁到团队档，并**出声**（不静默降级）；
//  · 坏输入不静默：空 id / 未知字段 / 认不出的档位 / 先写字段后写身份 ⇒ 进 rejected，名单回到上一条合法状态；
//  · fail closed：没声明团队档时按最窄档（read-only）跑，不给「默认全权」。
import { describe, expect, it } from "vitest";
import {
  MEMBER_KEY_PREFIX,
  memberPatch,
  projectMembers,
  type MemberPatchRecord,
} from "../src/agent/team/members";

const rec = (at: number, patch: Record<string, string>): MemberPatchRecord => ({ at, patch });

describe("成员档案", () => {
  it("最小档案：name + role，档位缺席时按最窄档（fail closed）", () => {
    const roster = projectMembers([rec(1, memberPatch("m1", { name: "阿岚", role: "调研" }))], "guided");
    expect(roster.members).toEqual([
      { id: "m1", name: "阿岚", role: "调研", tier: "read-only", memoryScope: "team", capabilities: [] },
    ]);
    expect(roster.rejected).toEqual([]);
  });

  it("补丁按写入顺序累积：后者覆盖前者，缺席的键不变", () => {
    const roster = projectMembers([
      rec(1, memberPatch("m1", { name: "阿岚", role: "调研" })),
      rec(2, memberPatch("m1", { model: "gpt-x" })),
      rec(3, memberPatch("m1", { role: "实现" })),
    ], "guided");
    expect(roster.members).toHaveLength(1);
    expect(roster.members[0]).toMatchObject({ id: "m1", name: "阿岚", role: "实现", model: "gpt-x" });
  });

  it("权限单调继承：成员档宽于团队档 ⇒ 裁到团队档并出声", () => {
    const roster = projectMembers([
      rec(1, memberPatch("m1", { name: "A", role: "r", tier: "full-access" })),
    ], "guided");
    expect(roster.members[0]!.tier).toBe("guided");
    expect(roster.clamped).toEqual([{ id: "m1", requested: "full-access", applied: "guided" }]);
    // 窄于团队档不算越界，也不出声
    const narrow = projectMembers([rec(1, memberPatch("m2", { name: "B", role: "r", tier: "read-only" }))], "guided");
    expect(narrow.clamped).toEqual([]);
  });

  it("坏输入进 rejected，名单不被污染", () => {
    const roster = projectMembers([
      rec(1, memberPatch("m1", { name: "A", role: "r" })),
      rec(2, { [`${MEMBER_KEY_PREFIX}m2.unknown`]: "x" }), // 未知字段
      rec(3, { [`${MEMBER_KEY_PREFIX}m3.tier`]: "guided" }), // 先写字段后写身份
      rec(4, memberPatch("m4", { name: "D", role: "r", tier: "天空" })), // 认不出的档位
      rec(5, { "plan.goal": "不是成员的键" }), // 不归本模块管 ⇒ 不当错
    ], "guided");
    expect(roster.members.map((m) => m.id)).toEqual(["m1"]);
    expect(roster.rejected.map((r) => r.id)).toEqual(["m2", "m3", "m4"]);
    expect(roster.rejected.every((r) => r.error !== "")).toBe(true);
  });

  it("不完整的档案（缺 name 或 role）不算成员，但会记一条拒绝", () => {
    const roster = projectMembers([rec(1, { [`${MEMBER_KEY_PREFIX}m1.name`]: "只有名字" })], "guided");
    expect(roster.members).toEqual([]);
    expect(roster.rejected).toHaveLength(1);
  });

  it("能力清单按逗号拆、去空白、丢空项", () => {
    const roster = projectMembers([
      rec(1, memberPatch("m1", { name: "A", role: "r", capabilities: ["read", " search ", ""] })),
    ], "guided");
    expect(roster.members[0]!.capabilities).toEqual(["read", "search"]);
  });

  it("可重建：同一份补丁算两次逐字相同（投影不是第二真源）", () => {
    const records = [
      rec(1, memberPatch("m1", { name: "A", role: "r", tier: "auto" })),
      rec(2, memberPatch("m2", { name: "B", role: "r" })),
    ];
    expect(projectMembers(records, "guided")).toEqual(projectMembers(records, "guided"));
  });

  it("写侧 helper 拒绝非法 id（分隔符会让读侧认错人）", () => {
    expect(() => memberPatch("a.b", { name: "x" })).toThrow(/成员 id/);
    expect(() => memberPatch("", { name: "x" })).toThrow(/成员 id/);
    expect(() => memberPatch("有 空格", { name: "x" })).toThrow(/成员 id/);
  });
});
