// 沙箱纯函数单测：profile 路径 realpath（坑一）、断网（默认无 network 放行 + 批准后 allow 支只加两条）、
// 断网判据（三种真实 OS 形状抓住、两种「像但不是」不误伤）、env 白名单+秘密剥除。
// 四项真实断言（写收敛/拒读/断网/自检）由 pnpm sandbox:check 端到端负责。
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { annotateNetworkDenial, buildSandboxProfile, looksLikeNetworkDenial, networkProfileFor, sandboxEnv } from "../src/main/sandbox";

describe("buildSandboxProfile", () => {
  it("可写根与敏感目录路径全部 realpath（坑一：/tmp 实为 /private/tmp）", () => {
    const profile = buildSandboxProfile(tmpdir());
    expect(profile).toContain('(allow file-write* (subpath "' + realpathSync(tmpdir()) + '"))');
    expect(profile).toContain(
      '(deny file-read* (subpath "' + join(realpathSync(homedir()), ".ssh") + '"))',
    );
  });

  it("默认断网：deny default 且无任何 network 放行", () => {
    const profile = buildSandboxProfile(tmpdir());
    expect(profile).toContain("(deny default)");
    expect(profile).not.toMatch(/allow network/);
    expect(profile).toContain("(allow process*)");
    expect(profile).toContain("(allow signal)");
  });

  it("显式 deny 与缺省逐字一致（调用方误传「deny」不得改变现形态）", () => {
    expect(buildSandboxProfile(tmpdir(), { network: "deny" })).toBe(buildSandboxProfile(tmpdir()));
  });

  it("allow 支只加两条 network 放行，写收敛与拒读一字不动（放行面不得顺手放宽别的）", () => {
    const deny = buildSandboxProfile(tmpdir());
    const allow = buildSandboxProfile(tmpdir(), { network: "allow" });
    expect(allow).toContain("(allow network-outbound)");
    expect(allow).toContain("(allow network-inbound)");
    expect(allow.split("\n").filter((l) => l !== "").length).toBe(deny.split("\n").filter((l) => l !== "").length + 2);
    for (const line of deny.split("\n")) expect(allow).toContain(line);
  });
});

describe("looksLikeNetworkDenial / annotateNetworkDenial（§11.4 网络审批通道的判据面）", () => {
  // 三条真串都是本机 sandbox-exec 实测拿到的原文，不是编的措辞。
  it("抓住三种真实断网形状", () => {
    expect(looksLikeNetworkDenial("curl: (6) Could not resolve host: example.com")).toBe(true);
    expect(looksLikeNetworkDenial("NETERR:EPERM connect EPERM 1.1.1.1:80 - Local (0.0.0.0:0)")).toBe(true);
    expect(looksLikeNetworkDenial("ping: cannot resolve foo: Unknown host\nTemporary failure in name resolution")).toBe(true);
  });

  it("不误伤两种「像但不是」的形状：工作区外写被拒（也报 EPERM）与端口本就没监听", () => {
    expect(looksLikeNetworkDenial("EPERM: operation not permitted, open '/private/tmp/m0b-sbx-should-deny.txt'")).toBe(false);
    expect(looksLikeNetworkDenial("curl: (7) Failed to connect to 127.0.0.1 port 64862: Couldn't connect to server")).toBe(false);
  });

  it("deny 支下补一行可行动的提示；allow 支与无提示串一律原样返回", () => {
    const out = "curl: (6) Could not resolve host: example.com";
    const noted = annotateNetworkDenial({ ok: false, output: out }, "deny");
    expect(noted.output.startsWith(out)).toBe(true);
    expect(noted.output).toContain("[sandbox]");
    expect(noted.ok, "提示不得把失败改写成成功").toBe(false);
    expect(annotateNetworkDenial({ ok: false, output: out }, "allow").output).toBe(out);
    expect(annotateNetworkDenial({ ok: true, output: "all good" }, "deny").output).toBe("all good");
  });
});

describe("networkProfileFor（§11.4 红线：网络全开永不免批）", () => {
  it("真值表：三条条件缺一即 deny，全齐才 allow", () => {
    const cases: [boolean, boolean, boolean, "allow" | "deny"][] = [
      [true, true, true, "allow"], // 网络命令 + 问过 + 批了
      [true, true, false, "deny"], // 问过但拒了
      [true, false, true, "deny"], // auto 档 L4-pass 没问过 ⇒ 不得拿网络
      [true, false, false, "deny"], // 无人值守
      [false, true, true, "deny"], // 批准了但非网络命令 ⇒ 不为它开面
      [false, false, false, "deny"],
    ];
    for (const [wantsNetwork, asked, approved, want] of cases) {
      expect(networkProfileFor({ wantsNetwork, asked, approved }), `wants=${String(wantsNetwork)} asked=${String(asked)} approved=${String(approved)}`).toBe(want);
    }
  });
});

describe("sandboxEnv", () => {
  it("白名单只留 PATH/HOME 等，名字含 KEY/TOKEN/SECRET/PASSWORD 的一律剥除", () => {
    process.env.M0B_FAKE_API_KEY = "should-be-stripped";
    process.env.M0B_FAKE_PASSWORD = "x";
    try {
      const env = sandboxEnv("/some/tmp");
      expect(env.M0B_FAKE_API_KEY).toBeUndefined();
      expect(env.M0B_FAKE_PASSWORD).toBeUndefined();
      expect(env.PATH).toBeDefined();
      expect(env.HOME).toBeDefined();
      expect(env.TMPDIR).toBe("/some/tmp");
      expect(env.NODE_ENV).toBeUndefined();
    } finally {
      delete process.env.M0B_FAKE_API_KEY;
      delete process.env.M0B_FAKE_PASSWORD;
    }
  });
});
