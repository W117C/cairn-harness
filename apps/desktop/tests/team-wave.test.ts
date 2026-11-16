// 波次判卷：顺序执行、每人开跑前重读、后面的人看得见前面刚说的、失败即停。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../src/events";
import { runWave } from "../src/main/team-wave";

const userMsg = (content: string) => ({ type: "user_message", content } as unknown as AgentEvent);
const agentMsg = (content: string, agent: string) =>
  ({ type: "assistant_message", content, agent_id: agent } as unknown as AgentEvent);

describe("一轮的波次", () => {
  it("顺序跑；每人开跑前重读；第二个人看得见第一个人刚说的", async () => {
    const events: AgentEvent[] = [userMsg("一起看下")];
    const tasks: { member: string; task: string }[] = [];
    const out = await runWave({
      speakers: ["m1", "m2"],
      task: "一起看下",
      read: async () => [...events],
      start: async (member, task) => {
        tasks.push({ member, task });
        events.push(agentMsg(`${member} 的结论`, `member:${member}`)); // 模拟真跑完写回事件
        return { ok: true, sessionId: `s-${member}` };
      },
    });
    expect(out.ok).toBe(true);
    expect(out.ran.map((r) => r.memberId)).toEqual(["m1", "m2"]);
    expect(out.ran[0]!.sawPrior).toBe(false); // 第一个人开跑前还没人说过
    expect(out.ran[1]!.sawPrior).toBe(true);  // 第二个人看得见 m1
    expect(tasks[1]!.task).toContain("member:m1：m1 的结论");
  });

  it("失败即停（后面的人不跑），错误如实交回", async () => {
    const seen: string[] = [];
    const out = await runWave({
      speakers: ["m1", "m2", "m3"],
      task: "t",
      read: async () => [userMsg("t")],
      start: async (member) => {
        seen.push(member);
        return member === "m2" ? { ok: false, error: "炸了" } : { ok: true };
      },
    });
    expect(seen).toEqual(["m1", "m2"]);
    expect(out.ok).toBe(false);
    expect(out.failed).toEqual({ memberId: "m2", error: "炸了" });
    expect(out.ran.map((r) => r.memberId)).toEqual(["m1"]);
  });

  it("空波次 ⇒ ok，没人跑", async () => {
    const out = await runWave({ speakers: [], task: "t", read: async () => [], start: async () => ({ ok: true }) });
    expect(out).toEqual({ ok: true, ran: [] });
  });
});
