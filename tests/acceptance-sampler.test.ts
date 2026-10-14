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

  it("空串 agent_id 算主会话，不算 worker（与 splitStreams 同一口径）", () => {
    // 两处不一致时，同一个「agent_id 为空」的事件会被一把尺当 worker、另一把当主会话，
    // 两个读数就再也对不上。空串＝没有 id，所以它那盏绿灯算主会话的绿灯。
    const emptyIdGreen = ev({ type: "verify_result", callId: "ve", ok: true, attempt: 1, maxAttempts: 1, results: [], agent_id: "" });
    expect(reviewFailHealRate([user(), verify(false), emptyIdGreen])).toEqual({ hits: 1, total: 1, unmeasurable: false });
    // 反向格：真 worker id 的绿灯不许算主会话自愈
    const workerGreen = ev({ type: "verify_result", callId: "vw", ok: true, attempt: 1, maxAttempts: 1, results: [], agent_id: "w1" });
    expect(reviewFailHealRate([user(), verify(false), workerGreen])).toEqual({ hits: 0, total: 1, unmeasurable: false });
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

  it("空串 agent_id 不构成配对：空串不是 id（决策归在空串上 ⇒ 不配任何 spawn）", () => {
    // 第一版这条判据是**空的**：`spawn(false)` 的 agent_id 是随机串，永远不会是空串 ⇒
    // 无论实现把空串当不当 id，读数都一样。要真判这一格，spawn 自己也得带空串 id。
    const emptyIdSpawn = ev({ type: "agent_spawned", agent_id: "", mode: "read", task: "t" });
    expect(routingDecisionCoverage([emptyIdSpawn, decision("")])).toEqual({ hits: 0, total: 1, unmeasurable: false });
    // 反向格：换成一个真 id，决策就配上了（证明上一格不是「反正都配不上」）
    const realSpawn = ev({ type: "agent_spawned", agent_id: "w7", mode: "read", task: "t" });
    expect(routingDecisionCoverage([realSpawn, decision("w7")])).toEqual({ hits: 1, total: 1, unmeasurable: false });
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

  it("分母 0 但标志说「可测」⇒ 仍判不可测，不许印 Infinity%（不信任调用方给的标志）", () => {
    // 两个采样器都从 rate() 出来（total===0 ⇒ unmeasurable=true），但 formatRate 是导出面：
    // 别的构造路径可能给出 {hits:1,total:0,unmeasurable:false}，那时 1/0 会印成 Infinity%
    // ——cost-per-progress 第二条纪律点名的那一族（不可测不许悄悄变成 0 或 Infinity）。
    const bad = { hits: 1, total: 0, unmeasurable: false };
    expect(formatRate("自愈率", bad)).toContain("不可测");
    expect(formatRate("自愈率", bad)).not.toContain("Infinity");
    // 反向格：真读数 0/5 仍是 0%，别把「读到 0」一起扫掉
    expect(formatRate("自愈率", { hits: 0, total: 5, unmeasurable: false })).toBe("自愈率：0/5 = 0%");
  });
});
