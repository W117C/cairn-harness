// 用量统计投影判卷（2026-10-20 批 130 · 头像菜单「用量统计」面板的数据面）。
//
// 纯函数 ⇒ 判卷可测。三个口径各自钉死：
//   · token 累计：与既有 usageAggregate 同源（同一条 usage 事件、同一套「缺字段当 0」），
//     所以面板里的数字与 composer 用量环、状态条**完全一致**（不另起一套账）。
//   · 工具步数：与 countToolSteps 同源（主会话 tool_call，**子 agent 子流不计**）。
//   · 对话轮数：user_message 条数。
// 「没有会话时面板说没有会话」这条不许靠数字全 0 来冒充——App 侧按 activeId 传 null。
import { describe, expect, it } from "vitest";
import { usageSummary } from "../src/renderer/projections";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const ev = (e: AgentEvent): AgentEvent => e;

describe("usageSummary（头像菜单「用量统计」）", () => {
  it("空会话：全 0（不是「没量到」，是没发生过）", () => {
    expect(usageSummary([])).toEqual({
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      usageCount: 0, toolSteps: 0, rounds: 0,
    });
  });

  it("token 累计与 usageAggregate 同源（输入/输出累加，缓存缺字段不计）", () => {
    const s = usageSummary([
      ev({ type: "usage", inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 300 } as AgentEvent),
      ev({ type: "usage", inputTokens: 500, outputTokens: 50 } as AgentEvent),
    ]);
    expect(s.inputTokens).toBe(1500);
    expect(s.outputTokens).toBe(250);
    // 第二条没报缓存 ⇒ 缓存读只算第一条的 300（**没量到 ≠ 量到 0**）
    expect(s.cacheReadTokens).toBe(300);
    expect(s.usageCount).toBe(2);
  });

  it("工具步数只数主会话（子 agent 子流不计，与 countToolSteps 同谓词）", () => {
    const s = usageSummary([
      ev({ type: "tool_call", id: "t1", name: "read_file", args: {} } as AgentEvent),
      ev({ type: "tool_call", id: "t2", name: "read_file", args: {}, agent_id: "w1" } as AgentEvent),
      ev({ type: "tool_call", id: "t3", name: "edit_file", args: {} } as AgentEvent),
    ]);
    expect(s.toolSteps).toBe(2);
  });

  it("对话轮数 = user_message 条数（worker 的 user_message 不算主会话轮）", () => {
    const s = usageSummary([
      ev({ type: "user_message", content: "一" } as AgentEvent),
      ev({ type: "assistant_message", content: "回" } as AgentEvent),
      ev({ type: "user_message", content: "二" } as AgentEvent),
    ]);
    expect(s.rounds).toBe(2);
  });
});
