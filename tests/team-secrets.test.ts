// 成员密钥授权判卷（ADR 0015 §五 M12）：默认拒、后写覆盖前写、非法名字进 rejected。
import { describe, expect, it } from "vitest";
import { applyMemberSecretEnv, canUseSecret, envForMember, grantPatch, projectSecretGrants, requestPatch, withMemberSecretEnv } from "../src/agent/team/secrets";

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

  it("申请：pending 排最前；同一对后写覆盖前写（审批后变 approved/denied）", () => {
    const view = projectSecretGrants([
      rec(1, requestPatch("m1", "OPENAI_API_KEY", "pending")),
      rec(2, requestPatch("m2", "BRAVE_KEY", "approved")),
    ]);
    expect(view.requests.map((r) => [r.memberId, r.secret, r.state])).toEqual([
      ["m1", "OPENAI_API_KEY", "pending"],
      ["m2", "BRAVE_KEY", "approved"],
    ]);
    const approved = projectSecretGrants([
      rec(1, requestPatch("m1", "K", "pending")),
      rec(2, requestPatch("m1", "K", "approved")),
    ]);
    expect(approved.requests).toEqual([{ memberId: "m1", secret: "K", state: "approved", at: 2 }]);
  });

  it("申请键也用同一把名字尺；非法进 rejected", () => {
    const view = projectSecretGrants([
      rec(1, { "request.m1.a.b": "pending" }),
      rec(2, { "request.m1.K": "maybe" }),
    ]);
    expect(view.requests).toEqual([]);
    expect(view.rejected.map((r) => r.at)).toEqual([1, 2]);
    expect(() => requestPatch("a.b", "K", "pending")).toThrow(/成员 id/);
  });

  it("写侧 helper 拒绝非法名字", () => {
    expect(() => grantPatch("a.b", "K", true)).toThrow(/成员 id/);
    expect(() => grantPatch("m1", "a/b", true)).toThrow(/密钥名/);
    expect(grantPatch("m1", "K", true)).toEqual({ "grant.m1.K": "allow" });
  });
});

describe("成员密钥注入（决定 + 写与撤）", () => {
  const view = projectSecretGrants([
    rec(1, grantPatch("m1", "OPENAI_API_KEY", true)),
    rec(2, grantPatch("m1", "BRAVE_KEY", false)),
    rec(3, grantPatch("m2", "OPENAI_API_KEY", true)),
  ]);
  const source = { OPENAI_API_KEY: "sk-test", OTHER: "x" };

  it("只注入 allow 的；值缺失记 missing；deny 记 denied", () => {
    expect(envForMember(view, "m1", source)).toEqual({
      env: { DSH_SECRET_OPENAI_API_KEY: "sk-test" },
      missing: [],
      denied: ["BRAVE_KEY"],
    });
    expect(envForMember(view, "m2", {})).toEqual({ env: {}, missing: ["OPENAI_API_KEY"], denied: [] });
    // 别人的授权不会漏进来
    expect(envForMember(view, "m3", source).env).toEqual({});
  });

  it("写与撤配对：只增删自己写的，外部同名变量不覆盖", () => {
    const target: Record<string, string | undefined> = { DSH_SECRET_OPENAI_API_KEY: "external" };
    const undo = applyMemberSecretEnv({ DSH_SECRET_OPENAI_API_KEY: "sk-test", DSH_SECRET_BRAVE_KEY: "b" }, target);
    expect(target.DSH_SECRET_OPENAI_API_KEY).toBe("external"); // 外部优先
    expect(target.DSH_SECRET_BRAVE_KEY).toBe("b");
    undo();
    expect(target.DSH_SECRET_OPENAI_API_KEY).toBe("external"); // 撤的时候也不动外部
    expect(target.DSH_SECRET_BRAVE_KEY).toBeUndefined();
  });
});

describe("withMemberSecretEnv：进 run 前写、收束后一定撤", () => {
  const view = projectSecretGrants([rec(1, grantPatch("m1", "K", true))]);
  it("run 里看得见，run 后看不见（抛错也撤）", async () => {
    const target: Record<string, string | undefined> = {};
    const source = { K: "v" };
    const seen = await withMemberSecretEnv(view, "m1", async () => target.DSH_SECRET_K, target, source);
    expect(seen.result).toBe("v");
    expect(target.DSH_SECRET_K).toBeUndefined();
    await expect(withMemberSecretEnv(view, "m1", async () => { throw new Error("boom"); }, target, source))
      .rejects.toThrow("boom");
    expect(target.DSH_SECRET_K).toBeUndefined();
  });
  it("没授权 ⇒ 空注入（deny 的人拿不到）", async () => {
    const target: Record<string, string | undefined> = {};
    const seen = await withMemberSecretEnv(view, "m2", async () => ({ ...target }), target, { K: "v" });
    expect(seen.result).toEqual({});
    expect(seen.env.denied).toEqual([]);
  });
});

describe("密钥卡片四跳串起来（申请→审批→注入→脱敏）", () => {
  it("成员跑出来的输出里，注入值会被脱敏", async () => {
    const { redactSecrets } = await import("../src/events/redact.js");
    const view = projectSecretGrants([
      rec(1, requestPatch("m1", "OPENAI_API_KEY", "pending")),
      rec(2, grantPatch("m1", "OPENAI_API_KEY", true)),
      rec(3, requestPatch("m1", "OPENAI_API_KEY", "approved")),
    ]);
    expect(canUseSecret(view, "m1", "OPENAI_API_KEY")).toBe(true);
    const target: Record<string, string | undefined> = { OPENAI_API_KEY: "sk-live-abcdef0123456789" };
    const out = await withMemberSecretEnv(view, "m1", async () => {
      return redactSecrets("调用返回 sk-live-abcdef0123456789 结束", { env: target }).text;
    }, target, target);
    expect(out.result).not.toContain("sk-live-abcdef0123456789");
  });
});
