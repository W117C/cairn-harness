import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { runLoop } from "../src/agent/loop";
import { HARNESS_VERIFY_CALL_ID } from "../src/agent/loop";
import { newExperience, type PlaybookOp } from "../src/agent/evolve/playbook";
import { projectEpisode } from "../src/agent/evolve/episode";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { createExperienceNudgeRunner, experienceSignalNudge } from "../src/main/evolve/experience-nudge";
import { evolveStopPathFor } from "../src/main/evolve/governance";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-nudge-"));
  workspaces.push(workspace);
  return workspace;
}

const ENTRY_ID = "exp_0123456789abcdef";

async function seed(workspace: string, status: "active" | "candidate" = "active"): Promise<void> {
  const entry = newExperience({
    id: ENTRY_ID, kind: "warning", scope: { workspace }, trigger: { when: "on-signal", signal: "verify:red" },
    body: "先复现再改", status, evidenceEpisodes: ["ep_seed"], now: 1_000, expiresAt: null,
  });
  const op: PlaybookOp = { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
  await appendPlaybookEvents(workspace, [op]);
}

describe("experienceSignalNudge", () => {
  it("verify:red 命中 active 经验；excludeIds 与未知信号返回空", async () => {
    const workspace = await tempWorkspace();
    await seed(workspace);
    const hit = await experienceSignalNudge(workspace, ["verify:red"], { taskContent: "修复 parser 的报错", now: 2_000 });
    expect(hit.ids).toEqual([ENTRY_ID]);
    expect(hit.note).toContain("[verify 相关经验");
    expect(hit.note).toContain("先复现再改");

    const excluded = await experienceSignalNudge(workspace, ["verify:red"], {
      taskContent: "修复 parser 的报错", excludeIds: [ENTRY_ID], now: 2_000,
    });
    expect(excluded).toEqual({ note: "", ids: [] });
    expect(await experienceSignalNudge(workspace, ["goal-drift"], { taskContent: "修", now: 2_000 }))
      .toEqual({ note: "", ids: [] });
  });

  it("非 active 不提醒；空信号不读账", async () => {
    const workspace = await tempWorkspace();
    await seed(workspace, "candidate");
    expect(await experienceSignalNudge(workspace, ["verify:red"], { taskContent: "修", now: 2_000 }))
      .toEqual({ note: "", ids: [] });
    expect(await experienceSignalNudge(workspace, [], { taskContent: "修", now: 2_000 }))
      .toEqual({ note: "", ids: [] });
  });

  it("STOP 冻结时中途提醒也不注入（与起点注记同一道门）", async () => {
    const workspace = await tempWorkspace();
    await seed(workspace);
    await mkdir(join(workspace, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveStopPathFor(workspace), "", "utf8");
    expect(await experienceSignalNudge(workspace, ["verify:red"], { taskContent: "修", now: 2_000 }))
      .toEqual({ note: "", ids: [] });
    const runner = createExperienceNudgeRunner(workspace, { taskContent: "修", now: 2_000 });
    expect((await runner.nudge(["verify:red"])).note).toBe("");
  });

  it("冻结可在一场中途生效：已缓存 runner 下一次提醒也停", async () => {
    const workspace = await tempWorkspace();
    await seed(workspace);
    const runner = createExperienceNudgeRunner(workspace, { taskContent: "修", now: 2_000 });
    expect((await runner.nudge(["verify:red"])).ids).toEqual([ENTRY_ID]);
    await mkdir(join(workspace, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveStopPathFor(workspace), "", "utf8");
    expect(await runner.nudge(["verify:red"])).toEqual({ note: "", ids: [] });
    expect(runner.loads()).toBe(1); // 冻结检查不重读账
  });

  it("runner 只读一次账：本场后加的条目本场不生效", async () => {
    const workspace = await tempWorkspace();
    await seed(workspace);
    const runner = createExperienceNudgeRunner(workspace, { taskContent: "修", now: 2_000 });
    expect((await runner.nudge(["verify:red"])).ids).toEqual([ENTRY_ID]);
    const later = newExperience({
      id: "exp_ffffffffffffffff", kind: "warning", scope: { workspace },
      trigger: { when: "on-signal", signal: "goal-drift" }, body: "后加的经验",
      status: "active", evidenceEpisodes: ["ep_late"], now: 3_000, expiresAt: null,
    });
    await appendPlaybookEvents(workspace, [{ v: 1, op: "add", ts: 3_000, entry: later, evidence: [], reason: "late" }]);
    expect((await runner.nudge(["goal-drift"])).ids).toEqual([]);
    expect(runner.loads()).toBe(1);
  });
});

describe("loop 接线", () => {
  it("verify 代码红时把提醒接进失败回执，信号含 verify:red 与 cause", async () => {
    const workspace = await tempWorkspace();
    const log: AgentEvent[] = [];
    const signals: string[][] = [];
    const requests: unknown[] = [];
    let calls = 0;
    await runLoop({
      workspace,
      userMessage: "修那个失败的测试",
      mode: "auto",
      interactive: true,
      events: { async append(event) { log.push(event); } },
      tools: {} as never,
      verify: {
        async run() {
          return {
            ok: false,
            results: [{ command: "pnpm test", ok: false, output: "FAIL: 1 failed", cause: "code" }],
          };
        },
      },
      experienceNudge: (got) => {
        signals.push([...got]);
        return { note: "\n[exp-nudge] 先看 tsconfig 的 paths", ids: ["exp_aaaaaaaaaaaaaaaa"] };
      },
      provider: {
        async *stream(messages: unknown[]) {
          requests.push(messages);
          calls += 1;
          yield calls === 1
            ? { type: "tool_call" as const, id: "v1", name: "verify", args: {} }
            : { type: "assistant_message" as const, content: "收工" };
        },
      } as never,
    });
    expect(signals).toEqual([["verify:red", "verify-cause:code"]]);
    expect(JSON.stringify(requests[1] ?? [])).toContain("[exp-nudge] 先看 tsconfig 的 paths");
    const result = log.find((event) => event.type === "tool_result" && event.callId === "v1");
    const output = result !== undefined && result.type === "tool_result" ? result.output : "";
    expect(output).toContain("[exp-nudge] 先看 tsconfig 的 paths");
    expect(result !== undefined && result.type === "tool_result" ? result.nudgeExperienceIds : undefined)
      .toEqual(["exp_aaaaaaaaaaaaaaaa"]);
    const projected = projectEpisode({
      events: log, workspace, sessionId: "s", logPath: join(workspace, "s.jsonl"), observedAt: 1,
    });
    expect(projected.evidence.nudgedExperienceIds).toEqual(["exp_aaaaaaaaaaaaaaaa"]);
  });

  it("auto-verify 返修轮的自动红也带经验提醒", async () => {
    const workspace = await tempWorkspace();
    const log: AgentEvent[] = [];
    const signals: string[][] = [];
    const requests: unknown[] = [];
    let calls = 0;
    await runLoop({
      workspace,
      userMessage: "修那个失败的测试",
      mode: "auto",
      interactive: true,
      events: { async append(event) { log.push(event); } },
      tools: {
        write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } },
      } as never,
      verify: {
        async run() {
          return { ok: false, results: [{ command: "pnpm test", ok: false, output: "FAIL: 1 failed", cause: "code" }] };
        },
      },
      autoVerify: true,
      autoVerifyRepair: true,
      experienceNudge: (got) => {
        signals.push([...got]);
        return { note: "\n[exp-nudge] 自动红经验", ids: ["exp_cccccccccccccccc"] };
      },
      provider: {
        async *stream(messages: unknown[]) {
          requests.push(messages);
          calls += 1;
          yield calls === 1
            ? { type: "tool_call" as const, id: "w1", name: "write_file", args: { path: "a.ts" } }
            : { type: "assistant_message" as const, content: "改完了。" };
        },
      } as never,
    });
    expect(signals[0]).toEqual(["verify:red", "verify-cause:code"]);
    expect(JSON.stringify(requests[2] ?? [])).toContain("[exp-nudge] 自动红经验");
    const auto = log.find((event) => event.type === "tool_result" && event.callId === HARNESS_VERIFY_CALL_ID);
    const output = auto !== undefined && auto.type === "tool_result" ? auto.output : "";
    expect(output).toContain("[exp-nudge] 自动红经验");
    expect(auto !== undefined && auto.type === "tool_result" ? auto.nudgeExperienceIds : undefined)
      .toEqual(["exp_cccccccccccccccc"]);
  });

  it("同一轮改口后继续调工具：goal-drift 提醒进下一条回执与下一轮请求", async () => {
    const workspace = await tempWorkspace();
    const log: AgentEvent[] = [];
    const signals: string[][] = [];
    const requests: unknown[] = [];
    let calls = 0;
    await runLoop({
      workspace,
      userMessage: "修那个失败的测试",
      mode: "auto",
      interactive: true,
      events: { async append(event) { log.push(event); } },
      tools: {
        read_file: { name: "read_file", async run() { return { ok: true, output: "file" }; } },
      } as never,
      experienceNudge: (got) => {
        signals.push([...got]);
        return { note: "\n[exp-nudge] 保持原目标", ids: ["exp_dddddddddddddddd"] };
      },
      provider: {
        async *stream(messages: unknown[]) {
          requests.push(messages);
          calls += 1;
          if (calls === 1) {
            yield { type: "assistant_message" as const, content: "范围收窄：只修解析器就够了。" };
            yield { type: "tool_call" as const, id: "r1", name: "read_file", args: { path: "a.ts" } };
          } else {
            yield { type: "assistant_message" as const, content: "收工" };
          }
        },
      } as never,
    });
    expect(signals).toEqual([["goal-drift"]]);
    expect(JSON.stringify(requests[1] ?? [])).toContain("[exp-nudge] 保持原目标");
    const result = log.find((event) => event.type === "tool_result" && event.callId === "r1");
    expect(result !== undefined && result.type === "tool_result" ? result.output : "").toContain("[exp-nudge] 保持原目标");
    expect(result !== undefined && result.type === "tool_result" ? result.nudgeExperienceIds : undefined)
      .toEqual(["exp_dddddddddddddddd"]);
  });

  it("同一动作连续失败三次时把 repeat-action 提醒接进回执", async () => {    const workspace = await tempWorkspace();
    const log: AgentEvent[] = [];
    const signals: string[][] = [];
    const requests: unknown[] = [];
    let calls = 0;
    await runLoop({
      workspace,
      userMessage: "修那个失败的测试",
      mode: "auto",
      interactive: true,
      events: { async append(event) { log.push(event); } },
      tools: {
        read_file: { name: "read_file", async run() { return { ok: false, output: "same error" }; } },
      } as never,
      stuckNudge: true,
      experienceNudge: (got) => {
        signals.push([...got]);
        return { note: "\n[exp-nudge] 换一个探针", ids: ["exp_bbbbbbbbbbbbbbbb"] };
      },
      provider: {
        async *stream(messages: unknown[]) {
          requests.push(messages);
          calls += 1;
          yield calls <= 3
            ? { type: "tool_call" as const, id: "f" + String(calls), name: "read_file", args: {} }
            : { type: "assistant_message" as const, content: "收工" };
        },
      } as never,
    });
    expect(signals).toEqual([["repeat-action"]]);
    expect(JSON.stringify(requests[3] ?? [])).toContain("[exp-nudge] 换一个探针");
    const result = log.find((event) => event.type === "tool_result" && event.callId === "f3");
    const output = result !== undefined && result.type === "tool_result" ? result.output : "";
    expect(output).toContain("[repeat]");
    expect(output).toContain("[exp-nudge] 换一个探针");
    expect(result !== undefined && result.type === "tool_result" ? result.nudgeExperienceIds : undefined)
      .toEqual(["exp_bbbbbbbbbbbbbbbb"]);
  });
});

describe("生产装配点", () => {  it("agent-runner 把提醒闭包交给 loop（行锚定，防同字面量冒领）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");
    expect(src).toContain('import { assembleRunEvolution } from "./evolve/session-assembly";');
    expect(src).toContain("const evolution = await assembleRunEvolution({");
    expect(src).toContain("experienceNudge: evolution.nudge,");
  });
});
