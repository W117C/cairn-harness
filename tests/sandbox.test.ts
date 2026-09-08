// 沙箱纯函数单测：profile 路径 realpath（坑一）、断网（无 network 放行）、env 白名单+秘密剥除。
// 四项真实断言（写收敛/拒读/断网/自检）由 pnpm sandbox:check 端到端负责。
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSandboxProfile, sandboxEnv } from "../src/main/sandbox";

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
