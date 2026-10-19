// 2026-10-19：产出代码安全快筛看不到 apply_patch 写入（模型最主要的跨文件修改方式）。
// 旧实现只从 write_file/edit_file 重建变更集 ⇒ 补丁里的密钥/危险 API 整体失明，
// 且 patch-only 会话连 security_report 都不产生（不是「扫了但干净」，是「没扫」）。
import { describe, expect, it } from "vitest";
import { buildSecurityReport, collectChangeSet } from "../src/agent/security/scan";
import type { AgentEvent } from "../src/events";

const patchEvent = (patch: string): AgentEvent => ({
  type: "tool_call", id: "p1", name: "apply_patch", args: { patch },
} as unknown as AgentEvent);

describe("apply_patch 进入安全变更集", () => {
  it("新增行里的密钥被重建进变更集", () => {
    const patch = [
      "diff --git a/src/config.ts b/src/config.ts",
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -1,1 +1,2 @@",
      " const x = 1;",
      '+const KEY = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";',
    ].join("\n");
    const entries = collectChangeSet([patchEvent(patch)]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe("src/config.ts");
    expect(entries[0]!.lines.join("\n")).toContain("sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
  });

  it("危险 API 会产出安全报告（旧实现返回 null）", () => {
    const patch = [
      "diff --git a/src/run.ts b/src/run.ts",
      "--- a/src/run.ts",
      "+++ b/src/run.ts",
      "@@ -1,1 +1,2 @@",
      " const x = 1;",
      "+eval(input);",
    ].join("\n");
    const report = buildSecurityReport([patchEvent(patch)]);
    expect(report).not.toBeNull();
    expect(report!.findings.some((f) => f.category === "eval")).toBe(true);
  });
});
