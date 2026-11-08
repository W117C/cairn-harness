import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPermission, evaluate, newAutonomySession, rememberDecision, runWithPlanScope } from "../src/permissions";
import type { ToolName } from "../src/tools";

describe("完全允许：用户已授权操作，不再等待操作审批", () => {
  it.each([
    ["run_shell", { command: "curl https://example.com" }],
    ["web_fetch", { url: "https://example.com" }],
    ["web_search", { query: "hello" }],
    ["write_file", { path: "file.txt", content: "hello" }],
    ["mcp__demo__write", {}],
  ])("%s 在方案待批、禁止/审批规则存在时也自动批准", (tool, args) => {
    const autonomy = newAutonomySession("full-access", {
      planBlocked: () => true,
      rules: [{ id: "block", tool, behavior: "deny", scope: "always" }],
    });
    expect(evaluate(tool as ToolName, args, autonomy)).toMatchObject({ verdict: "approve", auto: { source: "mode" } });
  });
  it("粗档门与记忆写入遵守同一授权", () => {
    runWithPlanScope(() => {
      expect(checkPermission("full-access", "write_file")).toBe("allow");
      expect(checkPermission("auto", "write_file")).toBe("deny");
      expect(rememberDecision({ mode: "full-access", scope: "global", isPlanBlocked: () => true })).toBe("allow");
      expect(rememberDecision({ mode: "auto", scope: "global", isPlanBlocked: () => true })).toBe("deny");
    }, true);
  });
  it("智能审批仍请求联网审批，只读仍拒绝写入", () => {
    expect(evaluate("web_fetch" as unknown as ToolName, { url: "https://example.com" }, newAutonomySession("auto"))).toMatchObject({ verdict: "ask" });
    expect(evaluate("write_file", { path: "file.txt" }, newAutonomySession("read-only"))).toMatchObject({ verdict: "deny" });
  });
  it("loop 装配把 full-access 传下来（否则未批 plan 时 loop 层会先拒）", () => {
    // 单测 evaluate/checkPermission 都放行，但 loop 的 `gate(mode, …)` 若仍拿冻结的 auto，
    // 方案门会在执行前把写向拒掉——门说放行、执行层没跑到。这条钉住那处装配。
    const src = readFileSync(new URL("../src/main/agent-runner.ts", import.meta.url), "utf8");
    expect(src).toContain('mode: opts.mode === "full-access" ? "full-access" : "auto"');
    expect(src).not.toContain('mode: "auto", // 冻结 loop 对 ask 一律拒绝');
  });
  it("保留评测文件完整性约束", () => {
    expect(evaluate("write_file", { path: "judge.ts" }, newAutonomySession("full-access", {
      frozenJudgePaths: new Set(["judge.ts"]),
    }))).toMatchObject({ verdict: "deny", layer: "L0-hard" });
  });
});
