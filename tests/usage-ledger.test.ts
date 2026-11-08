// 用量账本纯投影判卷（2026-10-21 批 131）。
// 这里是「当前会话」与「全部会话」共用的唯一口径：token 只此一份、步数/轮数的主子边界只此一份。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { addUsageTotals, emptyUsageTotals, usageTotals } from "../src/main/usage-ledger";

const ev = (e: AgentEvent): AgentEvent => e;

describe("usageTotals（跨会话账本的共享投影）", () => {
  it("空输入全 0", () => {
    expect(usageTotals([])).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 0, toolSteps: 0, rounds: 0 });
  });

  it("usage：token 累加；缓存缺字段不计（没量到 ≠ 量到 0）；worker 的 token 也算钱", () => {
    const s = usageTotals([
      ev({ type: "usage", inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 300 } as AgentEvent),
      ev({ type: "usage", inputTokens: 500, outputTokens: 50 } as AgentEvent),
      ev({ type: "usage", inputTokens: 20, outputTokens: 2, agent_id: "w1" } as AgentEvent),
    ]);
    expect(s.inputTokens).toBe(1520);
    expect(s.outputTokens).toBe(252);
    expect(s.cacheReadTokens).toBe(300);
    expect(s.usageCount).toBe(3);
  });

  it("工具步数与对话轮数只数主会话（worker 子流不计）", () => {
    const s = usageTotals([
      ev({ type: "user_message", content: "一" } as AgentEvent),
      ev({ type: "user_message", content: "子任务描述", agent_id: "w1" } as AgentEvent),
      ev({ type: "tool_call", id: "t1", name: "read_file", args: {} } as AgentEvent),
      ev({ type: "tool_call", id: "t2", name: "read_file", args: {}, agent_id: "w1" } as AgentEvent),
      ev({ type: "assistant_message", content: "回" } as AgentEvent),
    ]);
    expect(s.rounds).toBe(1);
    expect(s.toolSteps).toBe(1);
  });

  it("addUsageTotals 归并（不改 delta）", () => {
    const a = emptyUsageTotals();
    const b = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, usageCount: 4, toolSteps: 5, rounds: 6 };
    addUsageTotals(a, b);
    expect(a).toEqual(b);
    expect(b).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, usageCount: 4, toolSteps: 5, rounds: 6 });
  });
});
