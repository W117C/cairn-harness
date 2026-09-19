// W1a 收队的纯数据面测：逐行帽 / 整批帽 / 超时钳制 / CJK 权重反向对照 / 取回通道真实存在。
// 纯函数零 I/O ⇒ 不依赖模型与真实 worker（判卷纪律：锚点必须落在有界纯函数面上）。
import { describe, expect, it } from "vitest";
import {
  WAIT_BATCH_TOKEN_CAP, WAIT_ROW_TOKEN_CAP, WAIT_TIMEOUT_DEFAULT_MS, WAIT_TIMEOUT_MAX_MS,
  clampWaitTimeout, renderJoinPayload, shapeJoinRows, type JoinInput,
} from "../src/agent/orchestrator-join";
import { estimateTextTokens } from "../src/agent/text-budget";

function row(agentId: string, report: string): JoinInput {
  return { agentId, status: "done", task: "t-" + agentId, report, usage: { inputTokens: 10, outputTokens: 20 } };
}
const rowsOf = (inputs: JoinInput[]) => shapeJoinRows(inputs).rows;

describe("wait_for_agents 纯数据面", () => {
  it("未超帽时逐字不变（零回归：收队不得改写 worker 的交付文本）", () => {
    const out = rowsOf([row("w1", "结论：改完了。\n证据：src/a.ts:3")]);
    expect(out[0]!.summary).toBe("结论：改完了。\n证据：src/a.ts:3");
    expect(out[0]!.truncated).toBe(false);
  });

  it("单行超帽 ⇒ 截断且提示计入预算（总长仍 ≤ 帽，不是「帽 + 提示」）", () => {
    const out = rowsOf([row("w1", "汉".repeat(WAIT_ROW_TOKEN_CAP * 3))]);
    expect(out[0]!.truncated).toBe(true);
    expect(estimateTextTokens(out[0]!.summary)).toBeLessThanOrEqual(WAIT_ROW_TOKEN_CAP);
  });

  it("整批超帽 ⇒ 后段降级为一行状态并登记 degraded（数量有界 ≠ 体积有界）", () => {
    const big = "字".repeat(WAIT_ROW_TOKEN_CAP);
    const many = Array.from({ length: 8 }, (_, i) => row("w" + String(i), big));
    const { rows, degraded } = shapeJoinRows(many);
    expect(rows).toHaveLength(8);                       // 行不丢：状态必须在，只丢摘要
    expect(degraded.length).toBeGreaterThan(0);
    const total = rows.reduce((n, r) => n + estimateTextTokens(r.summary), 0);
    expect(total).toBeLessThanOrEqual(WAIT_BATCH_TOKEN_CAP);
    for (const id of degraded) expect(rows.find((r) => r.agent_id === id)?.summary).toBe("");
  });

  it("CJK 权重反向对照：500 个汉字必须算 500 token 并被截（旧 chars/4 口径会判它 125 而放过）", () => {
    const out = rowsOf([row("w1", "中".repeat(500))]);
    expect(estimateTextTokens("中".repeat(500))).toBe(500);
    expect(out[0]!.truncated).toBe(true);
  });

  it("被降级的行仍带 status/usage，且 payload 给出真实可执行的取回通道", () => {
    const big = "字".repeat(WAIT_ROW_TOKEN_CAP);
    const { rows, degraded } = shapeJoinRows(Array.from({ length: 8 }, (_, i) => row("w" + String(i), big)));
    const text = renderJoinPayload({ rows, degraded, timedOut: [], cancelled: false });
    expect(text).toContain("[join]");
    expect(text).toContain("wait_for_agents");          // 取回路径 = 单个 agent_id 再调一次
    const parsed = JSON.parse(text.slice(text.indexOf("{"))) as { rows: { usage: unknown }[] };
    expect(parsed.rows[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("超时：缺省用默认值；过大钳到硬帽并如实报钳制；非数一律 fail-visible 拒绝", () => {
    expect(clampWaitTimeout(undefined)).toEqual({ ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false });
    expect(clampWaitTimeout(99_999_999)).toEqual({ ms: WAIT_TIMEOUT_MAX_MS, clamped: true });
    expect(clampWaitTimeout("120000").rejected).toBeTypeOf("string");
    expect(clampWaitTimeout(0).rejected).toBeTypeOf("string");
  });
});
