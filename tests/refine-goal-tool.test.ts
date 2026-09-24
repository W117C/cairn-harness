// 判卷 · 模型自己改设目标措辞，但**改不动自己的钱闸与轮次帽**（能力 4 长程 + 能力 7 最小权限的交点）。
//
// 方向校正（2026-09-24）：目标不是"用户先写好子智能体定义"，而是 agent 自己安排。goal 模式此前
// 只有一个写入口（IPC「人设」），模型既不能把自己的目标写进锚点、也不能改措辞 ⇒ 长任务里它每轮
// 读到的还是三小时前那句人话，而它已经知道自己真正要交付什么。这一笔给它"改措辞"这一半，
// **不给**它"改预算"那一半，并且这条界线不是靠工具自觉，而是靠投影层机械守住：
//   `set_by:"model"` 的 goal_set 不移动窗口锚点 ⇒ 就算有人绕过工具直接造事件，也拿不到新的轮次额度。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { goalReminder, projectGoal } from "../src/agent/goal";
import { REFINE_GOAL_TOOL, createRefineGoalTool, type GoalViewLike } from "../src/tools/refine_goal";
import { gateToolSpecs } from "../src/agent/glm-session";
import { WORKER_FORBIDDEN_TOOLS } from "../src/agent/orchestrator-config";

const armed: GoalViewLike = { objective: "修好 completedCount", maxTurns: 8, maxUsd: 0.5, turn: 3, stopped: null };

function toolFor(view: GoalViewLike | null) {
  return { tool: createRefineGoalTool(async () => view) };
}

describe("refine_goal 工具的边界", () => {
  it("没武装 goal ⇒ 模型不能自己武装（轮次/美元闸归人）", async () => {
    const { tool } = toolFor(null);
    const r = await tool.run({ objective: "改成只看 diff" }, { workspace: "/tmp", callId: "c1", emit: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("归人");
  });

  it("目标已停 ⇒ 不许借改措辞复活它", async () => {
    const { tool } = toolFor({ ...armed, stopped: "轮次用尽" });
    const r = await tool.run({ objective: "再试一次" }, { workspace: "/tmp", callId: "c2", emit: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("已停");
  });

  it("改措辞成功：落的 goal_set 继承**人设**的两条闸并标 set_by=model", async () => {
    const emitted: AgentEvent[] = [];
    const { tool } = toolFor(armed);
    const r = await tool.run({ objective: "让 completedCount 只数未完成的" }, {
      workspace: "/tmp", callId: "c3", emit: async (e: AgentEvent) => { emitted.push(e); },
    });
    expect(r.ok, r.output).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "goal_set", objective: "让 completedCount 只数未完成的",
      max_turns: 8, max_usd: 0.5, set_by: "model",
    });
    // 回执要说清闸没动 + 现在第几轮：模型据此知道自己还剩几轮，而不是再问一次才知道
    expect(r.output).toContain("轮次上限 8");
    expect(r.output).toContain("第 3 轮");
  });

  it("想顺带改 max_turns / max_usd ⇒ 拒，并说清这两条归谁（不静默忽略）", async () => {
    const { tool } = toolFor(armed);
    const ctx = { workspace: "/tmp", callId: "c4", emit: async () => {} };
    await expect(tool.run({ objective: "x", max_turns: 99 }, ctx)).rejects.toThrow(/由人设定/);
    await expect(tool.run({ objective: "x", max_usd: 50 }, ctx)).rejects.toThrow(/由人设定/);
  });

  it("空 objective 拒（给了空目标等于让 agent 自己猜要干什么）", async () => {
    const { tool } = toolFor(armed);
    await expect(tool.run({ objective: "   " }, { workspace: "/tmp", callId: "c5", emit: async () => {} }))
      .rejects.toThrow(/objective/);
  });

  it("没有落流通道 ⇒ fail-closed（不假装改设成功）", async () => {
    const { tool } = toolFor(armed);
    const r = await tool.run({ objective: "x" }, { workspace: "/tmp", callId: "c6" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("无落流通道");
  });

  it("规格与实例同名同串；worker 面上禁入（目标锚点是会话级的，子代理改不了）", () => {
    const spec = gateToolSpecs("auto").find((s) => s.function.name === REFINE_GOAL_TOOL);
    if (!spec) throw new Error("模型可见面里没有 refine_goal");
    expect(spec.function.description).toContain("措辞");
    expect(Object.keys((spec.function.parameters as { properties?: Record<string, unknown> }).properties ?? {}))
      .toEqual(["objective"]);
    expect(gateToolSpecs("read-only").some((s) => s.function.name === REFINE_GOAL_TOOL)).toBe(true);
    expect(WORKER_FORBIDDEN_TOOLS).toContain(REFINE_GOAL_TOOL);
  });
});

describe("投影层机械守住「改措辞≠加额度」（工具之外的那道兜底）", () => {
  const userSet = (objective: string, maxTurns = 8): AgentEvent =>
    ({ type: "goal_set", objective, max_turns: maxTurns, max_usd: 0 });
  const modelSet = (objective: string, maxTurns = 25): AgentEvent =>
    ({ type: "goal_set", objective, max_turns: maxTurns, max_usd: 0, set_by: "model" });
  const goalTurn = (turn: number): AgentEvent =>
    ({ type: "user_message", content: "续跑", origin: { kind: "goal", turn, max_turns: 8 } });

  it("模型改设不重置轮次计数：帽仍按人设那次算（绕开工具直接造事件也拿不到额度）", () => {
    const before = projectGoal([userSet("旧"), goalTurn(2)])!;
    const after = projectGoal([userSet("旧"), goalTurn(2), modelSet("新")])!;
    expect(after.turn).toBe(before.turn);
    expect(after.spec.maxTurns).toBe(8);
    expect(after.spec.objective).toBe("新"); // 措辞确实生效（提醒块下一轮就读到新句）
  });

  it("模型改设不重开证据窗口：上一段的绿证据仍然作数（否则改一次措辞就白丢一轮验证）", () => {
    const verifyOk: AgentEvent = {
      type: "verify_result", ok: true, results: [{ command: "t", ok: true, output: "" }],
      callId: "v1", attempt: 1, maxAttempts: 3,
    };
    const v = projectGoal([userSet("旧"), verifyOk, modelSet("同一件事换个说法")])!;
    expect(v.evidence).toBe("verified");
    // 反控：人改设仍须作废窗口（这条不许被"顺手"放宽）
    expect(projectGoal([userSet("旧"), verifyOk, userSet("新目标")])!.evidence).toBe("absent");
  });

  it("模型改设不清掉已停状态（停过的目标不许被复活）", () => {
    const stopped: AgentEvent = { type: "goal_stopped", reason: "轮次用尽", turn: 8, evidence: "absent" };
    const v = projectGoal([userSet("旧"), stopped, modelSet("再来")])!;
    expect(v.stopped).toBe("轮次用尽");
  });

  it("一条模型自设的 goal_set 不能凭空武装一个没有目标的会话", () => {
    expect(projectGoal([modelSet("我自己给自己派活")])).toBeNull();
  });

  it("提醒块读的就是改后的那句（与判据同一份 spec，不留两份目标）", () => {
    const v = projectGoal([userSet("旧"), modelSet("新措辞")])!;
    const text = goalReminder(v.spec, v.turn, 0.01, v.evidence);
    expect(text).toContain("新措辞");
    expect(text, "帽不许被措辞改动带跑——那仍是「改措辞 = 加额度」的另一条路").toContain("轮次上限 8");
  });
});
