// M5b 步骤 9 bandit 运行时接线验收：routeFor 此前从不收 bandit 上下文（reason 永远非 "bandit"）、
// worker 完成时 updatePriced 零调用者——学习环路两头都断。本测证明端到端闭合：
// spawn(bandit 启用) → routing_decision{reason:"bandit"} → worker done → 后验更新且持久化。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEventLog, replay, type AgentEvent } from "../src/events";
import {
  Orchestrator,
  scriptedWorkerModel,
  type SpawnArgs,
} from "../src/agent/orchestrator";
import { newBanditState, saveBanditState, loadBanditState } from "../src/routing/bandit";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import type { ModelOutput } from "../src/providers";

let work: string;
let logPath: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "m5b-bandit-rt-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

async function waitFor(pred: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

function makeOrch(over: { banditPath?: string; model?: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel> } = {}): {
  orch: Orchestrator;
  events: AgentEvent[];
} {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: work,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    // bandit 要求 routing 同时开启（无路由则无档位决策可学）
    ...(over.banditPath ? { routing: true, banditStatePath: over.banditPath } : {}),
    // 注入脚本模型：绕开 M0_API_KEY 的 fail-closed，routeDecision 仍正常计算与落流
    ...(over.model ? { modelFor: over.model } : {}),
  });
  return { orch, events };
}

const DONE_SCRIPT: ModelOutput[] = [
  { type: "assistant_message", content: "## 结论\n- 已完成调研。" },
];

describe("bandit 运行时接线（学习环路闭合）", () => {
  it("bandit 启用：routing_decision reason=bandit，done 后后验更新且持久化", async () => {
    const banditPath = join(work, "routing-bandit.json");
    // 固定种子播种（否则 Date.now() 播种让臂选择不可复现）
    await saveBanditState(banditPath, newBanditState(42));
    const { orch, events } = makeOrch({ banditPath, model: () => scriptedWorkerModel(DONE_SCRIPT) });

    const r = await orch.spawn({ mode: "read", task: "调研 map 模块" }, { callId: "s1" });
    expect(r.ok).toBe(true);
    expect(await waitFor(() => events.some((e) => e.type === "agent_result"))).toBe(true);
    await orch.waitAll(5_000); // 等 worker closed——奖励回灌在 agent_result 之后、closed 之前

    // ① 决策落流且 reason 是 bandit（此前 routeFor 从不收 bandit 上下文 → 永远 tier-default）
    const decision = events.find((e): e is Extract<AgentEvent, { type: "routing_decision" }> => e.type === "routing_decision");
    expect(decision).toBeDefined();
    expect(decision!.reason).toBe("bandit");
    expect(DEFAULT_MODEL_TABLE.some((s) => s.id === decision!.picked)).toBe(true);

    // ② 持久化文件已更新（reload 后后验在）
    const reloaded = await loadBanditState(banditPath);
    const pickedSpec = DEFAULT_MODEL_TABLE.find((s) => s.id === decision!.picked);
    const key = "default|" + pickedSpec!.tier;
    const post = reloaded.posteriors[key];
    expect(post, "后验键 " + key + " 应存在").toBeDefined();
    // 冷启动 α=β=2；reward=1 → α=3；代价按 usage 折算进 β
    expect(post!.alpha).toBe(3);
    expect(post!.beta).toBeGreaterThanOrEqual(2);

    // ③ 学习不污染主上下文（bandit 事件不进 projectContext——同 routing_decision 口径）
    const replayed = await replay(logPath);
    expect(replayed.filter((e) => e.type === "routing_decision")).toHaveLength(1);
  }, 15_000);

  it("worker 失败：reward=0 → β 增长而 α 不动（失败也学习）", async () => {
    const banditPath = join(work, "routing-bandit.json");
    await saveBanditState(banditPath, newBanditState(42));
    // 抛错的模型：worker 收束为 failed
    const failingModel = async function* (): AsyncGenerator<ModelOutput> {
      throw new Error("simulated model failure");
    };
    const { orch, events } = makeOrch({ banditPath, model: () => failingModel as unknown as ReturnType<typeof scriptedWorkerModel> });

    await orch.spawn({ mode: "read", task: "会失败的任务" }, { callId: "s1" });
    expect(await waitFor(() => events.some((e) => e.type === "agent_result"))).toBe(true);
    await orch.waitAll(5_000); // 同上：closed 之后回灌才落盘

    const decision = events.find((e): e is Extract<AgentEvent, { type: "routing_decision" }> => e.type === "routing_decision");
    expect(decision!.reason).toBe("bandit");
    const reloaded = await loadBanditState(banditPath);
    const spec2 = DEFAULT_MODEL_TABLE.find((s) => s.id === decision!.picked);
    const post = reloaded.posteriors["default|" + spec2!.tier];
    expect(post).toBeDefined();
    expect(post!.alpha).toBe(2); // reward=0 → α 不动
    expect(post!.beta).toBeGreaterThan(2); // 1-reward=1 + 代价 → β 增长
  }, 15_000);

  it("未启用 bandit：reason 仍是 tier-default，不写状态文件、不学习（零行为回归）", async () => {
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(DONE_SCRIPT) }); // 无 banditPath
    const r = await orch.spawn({ mode: "read", task: "普通任务" }, { callId: "s1" });
    expect(r.ok).toBe(true);
    expect(await waitFor(() => events.some((e) => e.type === "agent_result"))).toBe(true);

    // routing 关闭 = 零 routing_decision 事件（档位解析走 modelFor/defaultWorkerModel 原路径）
    expect(events.filter((e) => e.type === "routing_decision")).toHaveLength(0);
    // 且不写 bandit 状态文件
    expect(events.filter((e) => e.type === "agent_result")).toHaveLength(1);
  }, 15_000);
});
