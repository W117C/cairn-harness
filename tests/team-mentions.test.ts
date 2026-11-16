// 群 @ 路由判卷（ADR 0015 §五 M4）：名字长者优先、整名匹配、只认名单里的名字。
import { describe, expect, it } from "vitest";
import { parseMemberMentions } from "../src/agent/team/mentions";

const members = [
  { id: "m1", name: "阿岚" },
  { id: "m2", name: "阿岚的助手" },
  { id: "m3", name: "小北" },
];

describe("群 @ 路由", () => {
  it("整名匹配 + 出现顺序 + 去重", () => {
    expect(parseMemberMentions("@小北 帮我看下 @阿岚 的结论", members)).toEqual({ ids: ["m3", "m1"], unknown: [] });
    expect(parseMemberMentions("@小北 @小北 重复点两次", members).ids).toEqual(["m3"]);
  });

  it("名字长者优先：@阿岚的助手 不会被截成 @阿岚", () => {
    expect(parseMemberMentions("@阿岚的助手 你来", members).ids).toEqual(["m2"]);
    expect(parseMemberMentions("@阿岚 你来", members).ids).toEqual(["m1"]);
  });

  it("名字后面紧跟字母/数字/汉字 ⇒ 不算命中（整名匹配）", () => {
    expect(parseMemberMentions("@阿岚二号 在吗", members).ids).toEqual([]);
    expect(parseMemberMentions("@小北2 在吗", members).ids).toEqual([]);
  });

  it("认不出的 @ 进 unknown，不猜", () => {
    expect(parseMemberMentions("@不存在的人 你看", members)).toEqual({ ids: [], unknown: ["不存在的人"] });
  });

  it("没有 @ ⇒ 空；标点后的 @ 也认", () => {
    expect(parseMemberMentions("大家好", members)).toEqual({ ids: [], unknown: [] });
    expect(parseMemberMentions("开始吧，@小北。", members).ids).toEqual(["m3"]);
  });
});
