// 子流归因面（withAgentId）与「谁算子流」那份唯一判定的回归测。
// 为什么单独一支：verify_result 此前不在归因面里，而**三处**下游已经按"带 agent_id 即子流"写死：
//   ① context.ts 的 autoVerifyFailureIdx —— worker 的自动验证红会被当成主会话的红注回模型上下文；
//   ② agent-runner 的父验证计量守卫（注释明写「worker 子流不进父验证计量」，但那时字段不存在）；
//   ③ tool-choice 的假完成率分母。
// 三处都只能等归因补上才成立，所以归因本身必须有测，而不是等下一个读数出错再回头找。
import { describe, expect, it } from "vitest";
import { WORKER_STREAM_TYPES, withAgentId } from "../src/agent/worker-projection";
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

describe("子流归因面必须覆盖 worker 能发的每一型（2026-09-22 实测补的三类）", () => {
  // 动手前的探针读数：withAgentId 只认 5 型 ⇒ worker 的 assistant_message/assistant_delta
  // 落进主转录时 agent_id 是 undefined，父投影于是产出
  //   {"role":"assistant","content":"worker 内部正文"}
  // ——父会话以为那句话是它自己说的；worker 的 error 同理会以父会话的错误上卡。
  // 旧注释「其余事件类型本体已带」是 agent_* 的经验，被当成了整条通道的经验。
  const prose: AgentEvent[] = [
    { type: "assistant_message", content: "worker 内部正文" },
    { type: "assistant_delta", callId: "m1", text: "半句正文" },
    { type: "error", message: "worker 自己炸了", step: 1 },
  ];

  it("正文与错误三类都进归因面（漏一型 = 它以父会话的形态落进主转录）", () => {
    for (const e of prose) {
      expect(withAgentId(e, "w1"), e.type).toHaveProperty("agent_id", "w1");
      expect(hasWorkerAttribution(withAgentId(e, "w1")), e.type).toBe(true);
    }
  });

  it("父投影不再把 worker 的正文当成父会话自己说的（探针的那份读数，反过来钉住）", () => {
    const msgs = projectContext([
      { type: "user_message", content: "主会话任务" } as AgentEvent,
      ...prose.map((e) => withAgentId(e, "w1") as AgentEvent),
    ]);
    const joined = JSON.stringify(msgs);
    expect(joined).not.toContain("worker 内部正文");
    expect(joined).not.toContain("半句正文");
    expect(joined).not.toContain("worker 自己炸了");
    expect(joined).toContain("主会话任务"); // 主流那一头照旧在（不是一律清空）
  });

  it("归因面 ⊇ provider 增量全集（ModelOutput 五型；编译期由 Record 穷尽代劳，这里 runtime 再钉一次）", () => {
    for (const t of ["assistant_message", "assistant_delta", "tool_call", "usage", "turn_truncated"] as const) {
      expect(WORKER_STREAM_TYPES.has(t), t).toBe(true);
    }
    // loop 合成件
    for (const t of ["tool_result", "verify_result", "error"] as const) {
      expect(WORKER_STREAM_TYPES.has(t), t).toBe(true);
    }
  });

  it("负控：父会话自己的正文不被装饰，非子流类型也不进这张表", () => {
    // withAgentId 只在 worker 管线上调用；主会话侧的 assistant_message 永远不带 agent_id。
    expect(withAgentId({ type: "user_message", content: "用户说的" } as AgentEvent, "w1")).not.toHaveProperty("agent_id");
    expect(WORKER_STREAM_TYPES.has("user_message" as AgentEvent["type"])).toBe(false);
    expect(WORKER_STREAM_TYPES.has("session_meta" as AgentEvent["type"])).toBe(false);
    expect(WORKER_STREAM_TYPES.has("compaction" as AgentEvent["type"])).toBe(false);
  });
});
