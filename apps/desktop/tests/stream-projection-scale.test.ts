// 流投影的规模判据（第 945 页）：长会话不许在投影这一步炸成平方。
// 现读（本机，2026-11-01）：300 轮/3 000 事件 ≈ 1.4ms；900 轮/9 000 ≈ 4.8ms；2 700 轮/27 000 ≈ 11.4ms
// （每事件 0.42–0.53µs，线性）。判据不看绝对毫秒（机器快慢不同），只看**规模比的斜率**：
// 事件 ×9 时耗时若超 ×25，说明出现了超线性路径（平方会是 ×81）。
import { describe, expect, it } from "vitest";
import { projectStream } from "../src/renderer/derived/stream";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

function fixture(rounds: number): AgentEvent[] {
  const events: AgentEvent[] = [];
  let seq = 0;
  for (let r = 1; r <= rounds; r++) {
    events.push({ type: "user_message", seq: ++seq, ts: seq, content: `第 ${String(r)} 轮` } as AgentEvent);
    for (let t = 0; t < 4; t++) {
      const id = `c${String(++seq)}`;
      events.push({ type: "tool_call", seq, ts: seq, id, tool: "read_file", args: "{}" } as unknown as AgentEvent);
      events.push({ type: "tool_result", seq: ++seq, ts: seq, callId: id, ok: true, output: "y".repeat(120) } as unknown as AgentEvent);
    }
    events.push({ type: "assistant_message", seq: ++seq, ts: seq, content: `回答 ${String(r)}` } as unknown as AgentEvent);
  }
  return events;
}

/** 最佳一次耗时（ms）——避开 GC/调度抖动。 */
function best(events: AgentEvent[], runs: number): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    void projectStream(events, false);
    fastest = Math.min(fastest, performance.now() - t0);
  }
  return fastest;
}

describe("流投影随事件数线性增长（第 945 页）", () => {
  it("事件 ×9 ⇒ 耗时不超过 ×25（平方会是 ×81）", () => {
    const small = fixture(300);   // 3 000 事件
    const large = fixture(2700);  // 27 000 事件
    expect(small.length).toBe(3000);
    expect(large.length).toBe(27000);
    best(small, 2); // 预热
    const tSmall = Math.max(best(small, 5), 0.2); // 下限 0.2ms：太快的机器上不让噪声做分母
    const tLarge = best(large, 5);
    const ratio = tLarge / tSmall;
    expect(ratio, `规模化后耗时比 ${ratio.toFixed(1)}（小 ${tSmall.toFixed(2)}ms / 大 ${tLarge.toFixed(2)}ms）`).toBeLessThan(25);
  });

  it("行数与该看的轮数一致（规模判据不能靠少产出换速度）", () => {
    expect(projectStream(fixture(300), false).length).toBe(300 * 6);
  });
});
