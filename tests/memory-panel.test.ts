// 记忆面板判卷：三层固定都在、成员按 id 排、合计与行同源、缺层要点名。
import { describe, expect, it } from "vitest";
import { memoryPanelView, memoryRowText } from "../src/agent/memory/panel";

const base = {
  project: { dir: "/p", topics: 2, bytes: 100 },
  team: { dir: "/t", topics: 1, bytes: 50 },
  members: [
    { memberId: "m2", dir: "/t/members/m2", topics: 0, bytes: 0 },
    { memberId: "m1", dir: "/t/members/m1", topics: 3, bytes: 70 },
  ],
};

describe("记忆面板", () => {
  it("三层都出；成员按 id 排；合计等于各行之和", () => {
    const view = memoryPanelView(base);
    expect(view.rows.map((r) => [r.scope, r.memberId ?? "", r.topics])).toEqual([
      ["project", "", 2],
      ["team", "", 1],
      ["member", "m1", 3],
      ["member", "m2", 0],
    ]);
    expect(view.total).toEqual({ topics: 6, bytes: 220 });
    expect(view.rows.reduce((s, r) => s + r.topics, 0)).toBe(view.total.topics);
    expect(view.missingScopes).toEqual([]);
  });

  it("没有成员也出 team/project 两行，member 层点名缺失（不许静默）", () => {
    const view = memoryPanelView({ ...base, members: [] });
    expect(view.rows.map((r) => r.scope)).toEqual(["project", "team"]);
    expect(view.missingScopes).toEqual(["member"]);
  });

  it("行文本同一套格式（面板与判卷共用）", () => {
    expect(memoryRowText({ scope: "member", dir: "/t/members/m1", topics: 3, bytes: 70, memberId: "m1" }))
      .toBe("member m1 · 3 个主题 · 70 B");
    expect(memoryRowText({ scope: "team", dir: "/t", topics: 0, bytes: 0 })).toBe("team · 0 个主题 · 0 B");
  });
});
