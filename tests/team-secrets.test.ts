// 成员密钥授权判卷（ADR 0015 §五 M12）：默认拒、后写覆盖前写、非法名字进 rejected。
import { describe, expect, it } from "vitest";
import { canUseSecret, grantPatch, projectSecretGrants } from "../src/agent/team/secrets";

const rec = (at: number, patch: Record<string, string>) => ({ at, patch });

describe("成员密钥授权", () => {
  it("默认拒：没有记录 ⇒ 不许用", () => {
    const view = projectSecretGrants([]);
    expect(view.grants).toEqual([]);
    expect(canUseSecret(view, "m1", "OPENAI_API_KEY")).toBe(false);
  });

  it("允许 / 拒绝都记；后写覆盖前写（历史仍可审计）", () => {
    const view = projectSecretGrants([
      rec(1, grantPatch("m1", "OPENAI_API_KEY", true)),
      rec(2, grantPatch("m1", "BRAVE_KEY", false)),
      rec(3, grantPatch("m1", "OPENAI_API_KEY", false)),
    ]);
    expect(view.grants.map((g) => [g.memberId, g.secret, g.allow, g.at])).toEqual([
      ["m1", "BRAVE_KEY", false, 2],
      ["m1", "OPENAI_API_KEY", false, 3],
    ]);
    expect(canUseSecret(view, "m1", "OPENAI_API_KEY")).toBe(false);
  });

  it("成员之间互不串：m1 的授权不抬高 m2", () => {
    const view = projectSecretGrants([rec(1, grantPatch("m1", "K", true))]);
    expect(canUseSecret(view, "m1", "K")).toBe(true);
    expect(canUseSecret(view, "m2", "K")).toBe(false);
  });

  it("非法名字进 rejected，不静默丢", () => {
    const view = projectSecretGrants([
      rec(1, { "grant.a.b.C": "allow" }),          // 带点 ⇒ 形状歧义
      rec(2, { "grant.m1.OPENAI_API_KEY": "maybe" }), // 值不合法
      rec(3, { "grant..K": "allow" }),              // 空成员
    ]);
    expect(view.grants).toEqual([]);
    expect(view.rejected.map((r) => r.at)).toEqual([1, 2, 3]);
  });

  it("写侧 helper 拒绝非法名字", () => {
    expect(() => grantPatch("a.b", "K", true)).toThrow(/成员 id/);
    expect(() => grantPatch("m1", "a/b", true)).toThrow(/密钥名/);
    expect(grantPatch("m1", "K", true)).toEqual({ "grant.m1.K": "allow" });
  });
});
