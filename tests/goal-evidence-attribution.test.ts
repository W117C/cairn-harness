// #93 关联的一格（第 382 页并行取证挖出来的「假完成」）：worker 的绿拍不许替父会话宣布 verified。
//
// 形状：worker 子流的 verify_result 带 `agent_id` 落进**同一份**会话 JSONL。四处消费者
// （context 投影／tool-choice 销账／prune／compaction）都过 `hasWorkerAttribution` 这一道闸，
// 而 `projectGoal` 是唯一没滤的那一支 ⇒ 父会话一个字没验、只要有个 worker 验绿过，goal 判据就
// 直接 `done` 收场（能力 5 最忌的假绿：说了＝验了）。
//
// 判卷写三向，缺一向都会让修法退化：
//   ① 正向：只滤父流（本笔的缺陷格）；② 零回归：父流自己验过照旧 verified／stale；
//   ③ **反向半边**：worker 自己那份流直接进共用判据仍要出 verified——否则会有人把过滤塞进
//      `workerVerificationEvidence` 内部，那样 worker 四态全塌成 absent，supervisor 跟着说谎。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { goalStopDecision, projectGoal } from "../src/agent/goal";
import { workerVerificationEvidence } from "../src/agent/worker-report";

const G = (objective = "把测试跑绿"): AgentEvent =>
  ({ type: "goal_set", objective, max_turns: 6, max_usd: 0 });

/** 一次成功的工具落盘（write_file 的 tool_call↔tool_result 成对，判据靠 callId 链接）。 */
const writePair = (id: string, agentId?: string): AgentEvent[] => [
  { type: "tool_call", id, name: "write_file", args: { path: "a.ts", content: "x" }, ...(agentId ? { agent_id: agentId } : {}) },
  { type: "tool_result", callId: id, ok: true, output: "written", ...(agentId ? { agent_id: agentId } : {}) },
];
const verifyBeat = (id: string, ok: boolean, agentId?: string): AgentEvent =>
  ({ type: "verify_result", callId: id, auto: true, ok, results: [], ...(agentId ? { agent_id: agentId } : {}) });

const decision = (evidence: string, wrote: boolean) => goalStopDecision({
  turn: 2,
  spec: { objective: "把测试跑绿", maxTurns: 6, maxUsd: 0 },
  spentUsd: 0.01,
  evidence: evidence as never,
  wrote,
  truncated: false,
});

describe("projectGoal 的证据取料：只认父流那一拍", () => {
  it("只有 worker 验绿过 ⇒ 父会话证据是 absent，判据不许收 done（这就是假完成那一格）", () => {
    const view = projectGoal([
      G(),
      ...writePair("w1"),
      verifyBeat("v1", true, "agent-7"), // worker 子流的自动拍
    ]);
    expect(view?.evidence).toBe("absent");
    expect(view?.wrote).toBe(true); // 写过盘这件事仍算（worker 真改了东西）
    expect(decision(String(view?.evidence), Boolean(view?.wrote)).kind).not.toBe("done");
  });

  it("父流自己验绿 ⇒ verified 且判据收 done（零回归：这条改动不许把真绿也滤掉）", () => {
    const view = projectGoal([G(), ...writePair("w1"), verifyBeat("v1", true)]);
    expect(view?.evidence).toBe("verified");
    expect(decision(String(view?.evidence), true).kind).toBe("done");
  });

  it("父验之后父又写盘 ⇒ stale（次序判据不在这次改动范围内，不许被顺手洗成 verified）", () => {
    const view = projectGoal([G(), verifyBeat("v1", true), ...writePair("w2")]);
    expect(view?.evidence).toBe("stale");
  });

  it("worker 红拍也不许替父会话判 failed（同一道闸的另一极性）", () => {
    const view = projectGoal([G(), ...writePair("w1"), verifyBeat("v1", false, "agent-7")]);
    expect(view?.evidence).toBe("absent");
  });

  it("反向半边：worker 自己那份流（每条都带 agent_id）进共用判据仍出 verified", () => {
    // 这一格钉的是「修法住在调用点」：把过滤塞进 workerVerificationEvidence 里面，
    // 下面这条立刻红，而 supervisor／orchestrator 那两处会集体读成 absent——那才是更大的谎。
    expect(workerVerificationEvidence([...writePair("w1", "agent-7"), verifyBeat("v1", true, "agent-7")])).toBe("verified");
  });
});
