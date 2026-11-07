// 质量档验证器的执行路径：验证器选择/执行不能只有类型边或脚本边（quality-ab.ts 走同一条路）。
// 本判卷只量外部证据，不把模型自述当通过证据；`src-execution-path` 的值边也由这里供给。
// （collectEvidence/judgeQualityRun 那张判定面与 loop 的 requireGreenVerify 硬门重复，
// 且从未接入生产路径，2026-11-07 收掉——见 tests 里这条注释与 src/agent/quality 的现状。）
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describePlan, planVerification, runVerificationPlan } from "../src/agent/quality/verifiers";

const dirs: string[] = [];
afterEach(async () => { while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true }); });

describe("质量档验证器选择", () => {
  it("声明命令优先于仓库探测；报告保留判据来源；无面 fail-closed", async () => {
    const ws = await mkdtemp(join(tmpdir(), "quality-plan-"));
    dirs.push(ws);
    const plan = await planVerification({ workspace: ws, declared: { commands: ["pnpm test"], timeoutMs: 30_000 } });
    expect(plan).toMatchObject({ kind: "task", commands: ["pnpm test"], timeoutMs: 30_000, source: "task" });
    expect(describePlan(plan)).toContain("task [task] pnpm test");

    const noSurface = await planVerification({ workspace: ws });
    expect(noSurface).toMatchObject({ kind: "none", commands: [], source: "none" });
    const outcome = await runVerificationPlan(noSurface, ws);
    expect(outcome.ok).toBe(false);
    expect(outcome.results[0]).toMatchObject({ ok: false, cause: "no-surface" });
  });
});
