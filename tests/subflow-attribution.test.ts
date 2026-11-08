/** 第 946 页：worker 归属判据只有一份，且「空串 agent_id = 主会话」。
 *
 *  这条判据此前在六处各写一遍，其中两处漏了 `!== ""`：
 *   · `main/usage-ledger.ts#isWorkerSubflow`（空串被当 worker ⇒ 用量少算）
 *   · `renderer/derived/session.ts#isWorkerSubflowEvent`（空串事件从主流里消失）
 *  另外三处（`agent/context.ts`、`agent/acceptance-sampler.ts`、`scripts/replay/run-scorecard.ts`）
 *  写的是 `!== ""`。同一个事件被两把尺判成两种归属，两边的读数就再也对不上。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasWorkerId, isWorkerSubflowEvent } from "../src/agent/subflow";
import { usageTotals } from "../src/main/usage-ledger";
import type { AgentEvent } from "../src/events";

const ROOT = join(import.meta.dirname, "..");
const ev = (o: Record<string, unknown>): AgentEvent => o as unknown as AgentEvent;

describe("worker 归属判据（第 946 页）", () => {
  it("非空 agent_id 才算 worker；空串/缺省/非字符串都算主会话", () => {
    expect(isWorkerSubflowEvent(ev({ type: "tool_call", agent_id: "w1" }))).toBe(true);
    expect(isWorkerSubflowEvent(ev({ type: "tool_call", agent_id: "" }))).toBe(false);
    expect(isWorkerSubflowEvent(ev({ type: "tool_call" }))).toBe(false);
    expect(isWorkerSubflowEvent(ev({ type: "tool_call", agent_id: 42 }))).toBe(false);
    // agent_spawned 是父流事实：即使带 agent_id 也归主会话
    expect(isWorkerSubflowEvent(ev({ type: "agent_spawned", agent_id: "w1" }))).toBe(false);
    expect(hasWorkerId(ev({ agent_id: "w1" }))).toBe(true);
    expect(hasWorkerId(ev({ agent_id: "" }))).toBe(false);
  });

  it("用量账本把空串 agent_id 的事件算作主会话（第 946 页的行为修正）", () => {
    const totals = usageTotals([
      ev({ type: "tool_call", id: "t1", tool: "read_file", args: {} }),
      ev({ type: "tool_call", id: "t2", tool: "read_file", args: {}, agent_id: "" }), // 以前被当 worker 跳过
      ev({ type: "tool_call", id: "t3", tool: "read_file", args: {}, agent_id: "w1" }), // worker：不计
    ]);
    expect(totals.toolSteps).toBe(2);
  });

  it("空串 agent_id 的事件照样进主流行（渲染面同一条判据）", async () => {
    const { projectStream } = await import("../apps/desktop/src/renderer/derived/stream");
    const rows = projectStream([
      ev({ type: "user_message", seq: 1, ts: 1, content: "问" }),
      ev({ type: "tool_call", seq: 2, ts: 2, id: "t1", tool: "read_file", args: "{}", agent_id: "" }), // 以前被当 worker 藏掉
      ev({ type: "tool_result", seq: 3, ts: 3, callId: "t1", ok: true, output: "x", agent_id: "" }),
    ], false);
    expect(rows.some((r) => r.kind === "tool")).toBe(true);
  });

  it("五个消费面都读同一份，且都不再自己写一条", () => {
    const files = [
      "src/agent/context.ts",
      "src/agent/acceptance-sampler.ts",
      "src/main/usage-ledger.ts",
      "apps/desktop/src/renderer/derived/session.ts",
      "scripts/replay/run-scorecard.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} 没读共享判据`).toMatch(/from ".*subflow"/u);
      expect(src, `${f} 还留着自己那条`).not.toMatch(/typeof (?:e\.)?id === "string"\s*&&\s*(?:e\.)?id !== ""/u);
      expect(src, `${f} 还留着自己那条（agent_id 版）`).not.toMatch(/typeof e\.agent_id === "string"\s*&&\s*e\.agent_id !== ""/u);
    }
    const canonical = readFileSync(join(ROOT, "src/agent/subflow.ts"), "utf8");
    expect(canonical).toContain('id !== ""');
    expect(canonical).toContain('e.type !== "agent_spawned"');
  });
});
