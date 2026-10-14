// M5 效果面采样器：`docs/m5-acceptance.md` 那两格「未测量」第一次有会印数的尺。
// 钉的是三件事：①分母口径（不许把不该进的轮塞进来）②不可测与 0% 不同形
// ③判据只认机器灯序、不认散文。
import { describe, expect, it } from "vitest";
import {
  formatRate,
  reviewFailHealRate,
  routingDecisionCoverage,
} from "../src/agent/acceptance-sampler";
import type { AgentEvent } from "../src/events";

const ev = (p: Record<string, unknown>): AgentEvent => p as unknown as AgentEvent;
const user = (): AgentEvent => ev({ type: "user_message", content: "改" });
const verify = (ok: boolean): AgentEvent =>
  ev({ type: "verify_result", callId: "v" + String(Math.random()), ok, attempt: 1, maxAttempts: 3, results: [] });

describe("reviewFailHealRate（review-fail 自愈率）", () => {
  it("红后转绿 = 自愈；红到底 = 未自愈", () => {
    expect(reviewFailHealRate([user(), verify(false), verify(true)])).toEqual({
      hits: 1, total: 1, unmeasurable: false,
    });
    expect(reviewFailHealRate([user(), verify(false)])).toEqual({
      hits: 0, total: 1, unmeasurable: false,
    });
  });

  it("没红过的轮不进分母（否则读数随任务难度漂移，而不是反映修得有多好）", () => {
    expect(reviewFailHealRate([user(), verify(true)])).toEqual({ hits: 0, total: 0, unmeasurable: true });
    expect(reviewFailHealRate([])).toEqual({ hits: 0, total: 0, unmeasurable: true });
  });

  it("多轮分别计：一轮红后绿、一轮红到底 ⇒ 1/2", () => {
    const s = reviewFailHealRate([
      user(), verify(false), verify(true),
      user(), verify(false),
    ]);
    expect(s).toEqual({ hits: 1, total: 2, unmeasurable: false });
  });

  it("worker 子流的灯不算主会话的自愈（与 cost-per-progress 同口径）", () => {
    const workerRed = ev({ type: "verify_result", callId: "vw", ok: false, attempt: 1, maxAttempts: 1, results: [], agent_id: "w1" });
    const workerGreen = ev({ type: "verify_result", callId: "vw2", ok: true, attempt: 1, maxAttempts: 1, results: [], agent_id: "w1" });
    expect(reviewFailHealRate([user(), verify(false), workerGreen])).toEqual({ hits: 0, total: 1, unmeasurable: false });
    // 只有 worker 红灯 ⇒ 主会话这一格根本没样本
    expect(reviewFailHealRate([user(), workerRed, workerGreen])).toEqual({ hits: 0, total: 0, unmeasurable: true });
  });

  it("散文说修好了不算数：只有 verify_result 的灯序进判据", () => {
    const s = reviewFailHealRate([
      user(),
      verify(false),
      ev({ type: "assistant_message", content: "已修复，测试通过" }),
    ]);
    expect(s).toEqual({ hits: 0, total: 1, unmeasurable: false });
  });
});

describe("routingDecisionCoverage（生产 spawn 的路由决策覆盖率）", () => {
  const spawn = (withDecision: boolean): AgentEvent =>
    ev({
      type: "agent_spawned",
      agent_id: "w" + String(Math.random()),
      role: "implement",
    });
  // 决策是**独立事件**，按 agent_id 与 spawn 一对一（orchestrator.ts 先 emit 决策再 emit spawned）。
  // 早先这条判据把 routing_decision 当 spawn 上的字段读——与生产形状不符，读数恒为 0。
  const decision = (agentId: string): AgentEvent =>
    ev({ type: "routing_decision", agent_id: agentId, candidates: [], picked: "m1", reason: "tier-default" });

  it("带决策的 spawn / 全部 spawn", () => {
    const a = spawn(false);
    const b = spawn(false);
    expect(routingDecisionCoverage([decision((a as { agent_id: string }).agent_id), a, b])).toEqual({
      hits: 1, total: 2, unmeasurable: false,
    });
  });

  it("没有 spawn ⇒ 不可测（不是 0%：没派过 worker 就没有这一格的分母）", () => {
    expect(routingDecisionCoverage([user()])).toEqual({ hits: 0, total: 0, unmeasurable: true });
  });

  it("决策与 spawn 按 agent_id 对上，不是 spawn 上的字段（恒 0 那把尺就是这么来的）", () => {
    const s = spawn(false);
    // 只有一条决策、且它归在**另一条** spawn 上 ⇒ 这一格分母 1、分子 0：是可测的 0%，不是不可测。
    expect(routingDecisionCoverage([s, decision("someone-else")])).toEqual({ hits: 0, total: 1, unmeasurable: false });
  });

  it("同一 id 多条决策只算一次（分母是 spawn 数，不是事件数）", () => {
    const s = spawn(false);
    const id = (s as { agent_id: string }).agent_id;
    expect(routingDecisionCoverage([decision(id), decision(id), s])).toEqual({ hits: 1, total: 1, unmeasurable: false });
  });
});

describe("formatRate（人读面）", () => {
  it("可测出百分比；不可测明说不许折成 0%（与 0% 不同形）", () => {
    expect(formatRate("自愈率", { hits: 1, total: 2, unmeasurable: false })).toBe("自愈率：1/2 = 50%");
    expect(formatRate("自愈率", { hits: 0, total: 0, unmeasurable: true })).toContain("不可测");
    expect(formatRate("自愈率", { hits: 0, total: 0, unmeasurable: true })).not.toContain("0%");
  });
});
