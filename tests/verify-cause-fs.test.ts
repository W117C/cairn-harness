// 事故 `verify-eprem-is-env`（outputs/task-carried-verify-2026-11-04/INCIDENTS.md）：
// 运行器写不了自己的临时目录时，那条红不是模型的代码错。归因若落回 `code`，
// 模型会照着「代码错了」去改本来正确的实现——这是把环境账记到模型头上。
import { describe, expect, it } from "vitest";
import { classifyVerifyFailure } from "../src/agent/verify";
import { isEnvVerifyCause } from "../src/events";

describe("环境写权限红", () => {
  it("EPERM/operation not permitted ⇒ env-fs，不是 code", () => {
    const out = "Error: EPERM: operation not permitted, open '/w/node_modules/.vite-temp/vitest.config.ts.timestamp-1'";
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: out })).toBe("env-fs");
  });

  it("EACCES/permission denied ⇒ env-fs", () => {
    const out = "Error: EACCES: permission denied, mkdir '/w/node_modules/.vite-temp'";
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: out })).toBe("env-fs");
  });

  it("同形对照：普通测试失败仍是 code", () => {
    const out = "Test Files 1 failed | Tests 2 failed | FAIL tests/x.test.ts";
    expect(classifyVerifyFailure({ timedOut: false, exitCode: 1, output: out })).toBe("code");
  });

  it("env-fs 进环境集：不烧修复额度", () => {
    expect(isEnvVerifyCause("env-fs")).toBe(true);
  });
});
