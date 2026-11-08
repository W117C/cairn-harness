// 经验效果对账（2026-11-06 自进化调研批）判卷面：
//  ① 聚合纯函数：按注入 id 聚合 injected/success/failure/unknown；稳定排序；没注入的不进表；
//  ② assess 报告带表（帽 20 行）；缺省（纯函数直调）= 空，不编造；
//  ③ 端到端：assignment sidecar → recordEpisode（outcome 从事件推导）→ loadEpisodes → 对账表。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/events";
import { experienceEfficacy, loadEpisodes, recordEpisode } from "../src/main/evolve/episode-store";
import { writeAssignment } from "../src/main/evolve/assignment-store";
import { assess } from "../src/main/evolution/assess";

const workspaces: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(workspaces.splice(0).map((w) => rm(w, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const w = await mkdtemp(join(tmpdir(), "evolve-efficacy-"));
  workspaces.push(w);
  return w;
}

async function writeLog(workspace: string, sessionId: string, events: AgentEvent[]): Promise<string> {
  const logPath = join(workspace, sessionId + ".jsonl");
  await writeFile(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return logPath;
}

/** 绿尾（成功）与红尾（失败）两套事件：结局由 projectEpisode 从事件推导，不手工填。 */
function greenEvents(): AgentEvent[] {
  return [
    { type: "session_meta", ts: 1_000 } as unknown as AgentEvent,
    { type: "user_message", content: "修复 parser 的报错，并跑测试" },
    { type: "tool_call", id: "t1", name: "edit_file", args: { path: "src/parser.ts" } },
    { type: "tool_result", callId: "t1", ok: true, output: "patched" },
    {
      type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 2,
      results: [{ command: "pnpm test", ok: true, output: "ok" }],
    } as AgentEvent,
  ];
}
function redEvents(): AgentEvent[] {
  return [
    { type: "session_meta", ts: 1_000 } as unknown as AgentEvent,
    { type: "user_message", content: "修复 parser 的报错，并跑测试" },
    {
      type: "verify_result", callId: "v1", ok: false, attempt: 2, maxAttempts: 2,
      results: [{ command: "pnpm test", ok: false, output: "fail" }], cause: "code",
    } as AgentEvent,
  ];
}

describe("experienceEfficacy 聚合", () => {
  it("按注入 id 聚合结局；注入多的在前；同数按 id 字典序", async () => {
    const w = await tempWorkspace();
    const cases: readonly [string, AgentEvent[], readonly string[]][] = [
      ["s1", greenEvents(), ["exp_b", "exp_a"]],
      ["s2", redEvents(), ["exp_a"]],
      ["s3", greenEvents(), ["exp_a"]],
    ];
    for (const [sid, events, exps] of cases) {
      const logPath = await writeLog(w, sid, events);
      await writeAssignment(w, sid, {
        experimentId: null,
        arm: "none",
        propensity: null,
        policyVersion: "evolve-v1",
        injectedExperienceIds: [...exps],
        injectedChars: 100,
      }, 1_000);
      await recordEpisode({ events, workspace: w, sessionId: sid, logPath });
    }
    const rows = experienceEfficacy(await loadEpisodes(w));
    expect(rows.map((r) => r.id)).toEqual(["exp_a", "exp_b"]);
    expect(rows[0]).toEqual({ id: "exp_a", injected: 3, success: 2, failure: 1, unknown: 0 });
    expect(rows[1]).toEqual({ id: "exp_b", injected: 1, success: 1, failure: 0, unknown: 0 });
  });

  it("没注入经验的那场不进分母（分母 = 注入过的条目）", async () => {
    const w = await tempWorkspace();
    const logPath = await writeLog(w, "s1", greenEvents());
    await recordEpisode({ events: greenEvents(), workspace: w, sessionId: "s1", logPath });
    expect(experienceEfficacy(await loadEpisodes(w))).toEqual([]);
  });
});

describe("assess 报告带效果对账表", () => {
  it("报告带上现算的表（帽 20 行）；纯函数直调缺省 = 空数组不编造", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: "exp_" + String(i).padStart(2, "0"),
      injected: 25 - i,
      success: 1,
      failure: 0,
      unknown: 0,
    }));
    const report = assess({ index: { bundles: {} }, patchStats: {}, workflowHits: [], canaryFindings: [], registeredWorkflowIds: new Set(), experienceEfficacy: rows }, "manual", 1);
    expect(report.experienceEfficacy).toHaveLength(20);
    expect(report.experienceEfficacy[0]!.id).toBe("exp_00");
    const bare = assess({ index: { bundles: {} }, patchStats: {}, workflowHits: [], canaryFindings: [], registeredWorkflowIds: new Set() }, "manual", 1);
    expect(bare.experienceEfficacy).toEqual([]);
  });
});
