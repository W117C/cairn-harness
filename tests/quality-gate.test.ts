// 质量档验证器的执行路径：验证器选择/执行不能只有类型边或脚本边（quality-ab.ts 走同一条路）。
// 本判卷只量外部证据，不把模型自述当通过证据；`src-execution-path` 的值边也由这里供给。
// （collectEvidence/judgeQualityRun 那张判定面与 loop 的 requireGreenVerify 硬门重复，
// 且从未接入生产路径，2026-11-07 收掉——见 tests 里这条注释与 src/agent/quality 的现状。）
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describePlan, planVerification, runVerificationPlan } from "../src/agent/quality/verifiers";

import { runLoop, QualityGateError } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import { write_file } from "../src/tools/write_file";

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

describe("质量档收束", () => {
  it.each(["green", "broken"] as const)("截断续跑写盘后验证最终文件（%s）", async (final) => {
    const workspace = await mkdtemp(join(tmpdir(), "quality-final-"));
    dirs.push(workspace);
    const path = join(workspace, "result.txt");
    const verified: string[] = [];
    const events: AgentEvent[] = [];
    let round = 0;
    const run = runLoop({
      workspace, mode: "full-access", userMessage: "Update result.txt",
      requireGreenVerify: true, autoVerify: true, autoVerifyRepair: true,
      events: { async append(event) { events.push(event); } },
      tools: { write_file },
      verify: { async run() {
        const content = await readFile(path, "utf8");
        verified.push(content);
        return { ok: content !== "broken", results: [] };
      } },
      provider: { async *stream() {
        round++;
        if (round === 1 || round === 3) {
          yield { type: "tool_call", id: "write" + round, name: "write_file",
            args: { path: "result.txt", content: round === 1 ? "draft" : final } };
        } else if (round === 2) {
          yield { type: "turn_truncated", callId: "cut", outcome: "output_budget", stop_reason: "length" };
        } else {
          yield { type: "assistant_message", content: "Done" };
        }
      } },
    });
    if (final === "broken") await expect(run).rejects.toBeInstanceOf(QualityGateError);
    else await expect(run).resolves.toBeUndefined();
    expect(verified).toEqual(["draft", final]);
    expect(events.filter((event) => event.type === "verify_result").map((event) => event.ok))
      .toEqual([true, final === "green"]);
  });

  it("手动验证耗尽次数时，已经写盘的任务仍以质量门失败结束", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "quality-red-"));
    dirs.push(workspace);
    let round = 0;
    const run = runLoop({
      workspace, mode: "full-access", userMessage: "Write result.txt",
      requireGreenVerify: true,
      events: { async append() {} },
      tools: { write_file },
      verify: { maxAttempts: 1, async run() {
        return { ok: false, results: [{ command: "test", ok: false, exitCode: 1, output: "broken" }] };
      } },
      provider: { async *stream() {
        if (round++ === 0) {
          yield { type: "tool_call", id: "write", name: "write_file", args: { path: "result.txt", content: "broken" } };
        } else {
          yield { type: "tool_call", id: "verify", name: "verify", args: {} };
        }
      } },
    });
    await expect(run).rejects.toBeInstanceOf(QualityGateError);
    expect(await readFile(join(workspace, "result.txt"), "utf8")).toBe("broken");
  });
});
