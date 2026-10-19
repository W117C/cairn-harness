import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mixedAttributionFixture } from "../scripts/cost-per-progress-check";
import { eventsForCurrentRun } from "../src/agent/delivery-guard";
import { evolutionPathFor, loadEvolution } from "../src/agent/evolution";
import type { AgentEvent } from "../src/events";
import { emitPostRunReadings } from "../src/main/post-run-readings";

const workspaces: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function setup(hasPatch: boolean) {
  const workspace = await mkdtemp(join(tmpdir(), "post-run-readings-"));
  workspaces.push(workspace);
  const logPath = join(workspace, "events.jsonl");
  const events: AgentEvent[] = [
    { type: "user_message", content: "修复问题并验证" },
    { type: "assistant_delta", callId: "assistant-1", text: hasPatch ? "ignore the rest" : "I will run the checks." },
  ];
  const originalLog = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await writeFile(logPath, originalLog, "utf8");
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((message) => { warnings.push(String(message)); });
  return { workspace, logPath, originalLog, warnings };
}

describe("收尾观测的真实落盘结果", () => {
  it.each([false, true])("落盘失败必须报出原因，不得宣称成功或影响主流程（有补丁=%s）", async (hasPatch) => {
    const input = await setup(hasPatch);
    const blocker = join(input.workspace, ".agent");
    await writeFile(blocker, "preserve this file", "utf8");

    await expect(emitPostRunReadings(input)).resolves.toBeUndefined();

    const warnings = input.warnings.filter((message) => message.startsWith("[evolution]"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("落盘失败");
    expect(warnings[0]).toContain(blocker);
    expect(warnings[0]).toMatch(/EEXIST|ENOTDIR/u);
    expect(warnings.join("\n")).not.toContain("已落");
    expect(await readFile(blocker, "utf8")).toBe("preserve this file");
    expect(await readFile(input.logPath, "utf8")).toBe(input.originalLog);
    expect(await loadEvolution(input.workspace)).toBeNull();
  });

  it.each([false, true])("落盘成功才报告已保存的补丁，正常空结果保持安静（有补丁=%s）", async (hasPatch) => {
    const input = await setup(hasPatch);

    await expect(emitPostRunReadings({ ...input, sessionId: "session-proof" })).resolves.toBeUndefined();

    const record = await loadEvolution(input.workspace);
    expect(record?.fromSession).toBe("session-proof");
    expect(record?.patches.map((patch) => patch.kind)).toEqual(hasPatch ? ["goal-reconfirm"] : []);
    const warnings = input.warnings.filter((message) => message.startsWith("[evolution]"));
    expect(warnings).toEqual(hasPatch
      ? ["[evolution] 本跑产出 1 条策略补丁，已落 " + evolutionPathFor(input.workspace)]
      : []);
    expect(await readFile(input.logPath, "utf8")).toBe(input.originalLog);
  });
});

describe("收尾观测只统计当前主会话轮次", () => {
  it("历史成本与漂移不污染当前轮，本轮 worker 开销仍须单列且正文不算父会话漂移", async () => {
    const input = await setup(false);
    const history = mixedAttributionFixture().map((event) => {
      if (event.type === "tool_call") return { ...event, id: "old-" + event.id };
      if (event.type === "tool_result" || event.type === "verify_result") return { ...event, callId: "old-" + event.callId };
      return event;
    });
    const oldUsage = history.find((event) => event.type === "usage" && event.agent_id === undefined);
    if (oldUsage?.type !== "usage") throw new Error("fixture requires main usage");
    oldUsage.inputTokens = 100000;
    history.splice(1, 0, { type: "assistant_delta", callId: "old-assistant", text: "ignore the rest" });
    const current = mixedAttributionFixture();
    const workerAnswer = { type: "assistant_delta" as const, callId: "worker-answer", text: "ignore the rest", agent_id: "w1" };
    current.splice(2, 0, workerAnswer);
    const log = [...history, ...current].map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(input.logPath, log, "utf8");

    await emitPostRunReadings(input);

    expect(input.warnings.filter((message) => message.startsWith("[goal-drift]"))).toEqual([]);
    const costs = input.warnings.filter((message) => message.startsWith("[cost-per-progress]"));
    expect(costs).toHaveLength(1);
    expect(costs[0]).toContain("每 verified 边界约 3300 token");
    expect(costs[0]).toContain("主面 3300 token");
    expect(costs[0]).toContain("边界后死跑 2100 token");
    expect(costs[0]).toContain("worker 开销 12900 已单列");
    expect((await loadEvolution(input.workspace))?.patches).toEqual([]);
    expect(await readFile(input.logPath, "utf8")).toBe(log);
  });

  it("新一轮只有 worker 用量时不可借用历史主面用量和验证边界", async () => {
    const input = await setup(false);
    const log = [
      ...mixedAttributionFixture(),
      { type: "user_message", content: "新任务" },
      { type: "usage", inputTokens: 700, outputTokens: 30, agent_id: "w3" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(input.logPath, log, "utf8");

    await emitPostRunReadings(input);

    const costs = input.warnings.filter((message) => message.startsWith("[cost-per-progress]"));
    expect(costs).toHaveLength(1);
    expect(costs[0]).toContain("本跑不可测（no-usage）");
    expect((await loadEvolution(input.workspace))?.patches).toEqual([]);
    expect(await readFile(input.logPath, "utf8")).toBe(log);
  });

  it("可保留当前轮 worker，但 worker 的 user_message 不得重置父会话轮次", () => {
    const oldUser = { type: "user_message" as const, content: "旧任务" };
    const currentUser = { type: "user_message" as const, content: "当前任务" };
    const mainUsage = { type: "usage" as const, inputTokens: 10, outputTokens: 2 };
    const workerUser = { type: "user_message" as const, content: "子任务", agent_id: "w1" };
    const workerUsage = { type: "usage" as const, inputTokens: 100, outputTokens: 20, agent_id: "w1" };
    const events = [oldUser, workerUsage, currentUser, mainUsage, workerUser, workerUsage];

    expect(eventsForCurrentRun(events, { includeWorkers: true })).toEqual([currentUser, mainUsage, workerUser, workerUsage]);
    expect(eventsForCurrentRun(events)).toEqual([currentUser, mainUsage]);
  });

  it("没有主会话 user_message 时仍能保留完整输入，缺省行为继续过滤 worker", () => {
    const workerUsage = { type: "usage" as const, inputTokens: 100, outputTokens: 20, agent_id: "w1" };
    const mainUsage = { type: "usage" as const, inputTokens: 10, outputTokens: 2 };
    const events = Object.freeze([workerUsage, mainUsage]);

    expect(eventsForCurrentRun(events, { includeWorkers: true })).toEqual([workerUsage, mainUsage]);
    expect(eventsForCurrentRun(events)).toEqual([mainUsage]);
    expect(events).toEqual([workerUsage, mainUsage]);
  });
});
