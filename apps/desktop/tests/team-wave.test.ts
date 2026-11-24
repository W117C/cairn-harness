// 波次判卷：顺序执行、每人开跑前重读、后面的人看得见前面刚说的、失败即停。
import { describe, expect, it, vi } from "vitest";
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
        return { ok: true, sessionId: `s-${member}`, reply: `${member} 的结论` };
      },
      writeBack: async (memberId, reply) => {
        events.push(agentMsg(reply, `member:${memberId}`)); // 模拟真跑完写回事件
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
        return member === "m2" ? { ok: false, error: "炸了" } : { ok: true, reply: `${member} 的结论` };
      },
      writeBack: async () => undefined,
    });
    expect(seen).toEqual(["m1", "m2"]);
    expect(out.ok).toBe(false);
    expect(out.failed).toEqual({ memberId: "m2", error: "炸了" });
    expect(out.ran.map((r) => r.memberId)).toEqual(["m1"]);
  });

  it("空波次 ⇒ ok，没人跑", async () => {
    const out = await runWave({
      speakers: [], task: "t", read: async () => [], start: async () => ({ ok: true }), writeBack: async () => undefined,
    });
    expect(out).toEqual({ ok: true, ran: [] });
  });

  it("生产波次在每位成员收束后写回最终回复，下一位真实看见前一位", async () => {
    const events: AgentEvent[] = [userMsg("一起看下")];
    const writeBack = vi.fn(async (memberId: string, reply: string) => {
      events.push(agentMsg(reply, `member:${memberId}`));
    });

    const out = await runWave({
      speakers: ["m1", "m2"],
      task: "一起看下",
      read: async () => [...events],
      start: async (memberId: string) => ({
        ok: true,
        sessionId: `s-${memberId}`,
        reply: `${memberId} 的结论`,
      }),
      writeBack,
    });

    expect(writeBack.mock.calls).toEqual([
      ["m1", "m1 的结论"],
      ["m2", "m2 的结论"],
    ]);
    expect(out.ran.map((r) => r.memberId)).toEqual(["m1", "m2"]);
    expect(out.ran[1]?.sawPrior).toBe(true);
  });

  it("群流写回失败立即停波次，后面的人不跑", async () => {
    const started: string[] = [];
    const out = await runWave({
      speakers: ["m1", "m2"],
      task: "一起看下",
      read: async () => [userMsg("一起看下")],
      start: async (memberId: string) => {
        started.push(memberId);
        return { ok: true, sessionId: `s-${memberId}`, reply: `${memberId} 的结论` };
      },
      writeBack: async () => {
        throw new Error("群流写不回");
      },
    });

    expect(out.ok).toBe(false);
    expect(out.failed?.error).toContain("群流写不回");
    expect(started).toEqual(["m1"]);
  });
});
