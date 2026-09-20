// 子流归因面（withAgentId）与「谁算子流」那份唯一判定的回归测。
// 为什么单独一支：verify_result 此前不在归因面里，而**三处**下游已经按"带 agent_id 即子流"写死：
//   ① context.ts 的 autoVerifyFailureIdx —— worker 的自动验证红会被当成主会话的红注回模型上下文；
//   ② agent-runner 的父验证计量守卫（注释明写「worker 子流不进父验证计量」，但那时字段不存在）；
//   ③ tool-choice 的假完成率分母。
// 三处都只能等归因补上才成立，所以归因本身必须有测，而不是等下一个读数出错再回头找。
import { describe, expect, it } from "vitest";
import { withAgentId } from "../src/agent/worker-projection";
import { hasWorkerAttribution, projectContext } from "../src/agent/context";
import type { AgentEvent, VerifyResultEvent } from "../src/events";

const vres = (over: Partial<VerifyResultEvent> = {}): AgentEvent =>
  ({ type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, results: [], ...over });

describe("子流归因面", () => {
  it("既有三类照旧（对照组：没有这条，下面的『verify_result 也带归因』可能只是恒真）", () => {
    for (const e of [
      { type: "tool_call", id: "c", name: "read_file", args: {} },
      { type: "tool_result", callId: "c", ok: true, output: "o" },
      { type: "usage", inputTokens: 1, outputTokens: 2 },
    ] as AgentEvent[]) {
      expect(withAgentId(e, "w1")).toHaveProperty("agent_id", "w1");
    }
  });

  it("verify_result 进归因面：worker 的验证证据必须能被认出不是父会话的", () => {
    const got = withAgentId(vres({ auto: true }), "w1") as { agent_id?: string };
    expect(got.agent_id).toBe("w1");
  });

  it("hasWorkerAttribution 是那份唯一判定：带归因的 verify_result 算子流", () => {
    expect(hasWorkerAttribution(withAgentId(vres(), "w1"))).toBe(true);
    expect(hasWorkerAttribution(vres())).toBe(false);          // 主会话侧无此字段
    expect(hasWorkerAttribution(vres({ agent_id: "" }))).toBe(false); // 空串不算（缺省≠子流）
  });

  it("投影面：worker 的「系统补拍红」不得冒充主会话的红注回模型", () => {
    const base: AgentEvent[] = [{ type: "user_message", content: "继续" }];
    const main = projectContext([...base, vres({ auto: true })]);
    expect(JSON.stringify(main)).toContain("[harness 自动验证]");   // 主会话的补拍红照常回流
    const worker = projectContext([...base, withAgentId(vres({ auto: true }), "w1")]);
    expect(JSON.stringify(worker)).not.toContain("[harness 自动验证]");
    expect(JSON.stringify(worker)).toContain("继续");               // 只是不注入那条红，不是把整个上下文弄坏
  });
});
