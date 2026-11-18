// 截断提示行判卷（第 1328 页反方复核赢下的第二件事）：turn_truncated 此前渲染层 0 处引用
// ⇒ 回复被截断时桌面看起来是完整回答。判据：截断事件 → notice 行如实可见（两种 outcome
// 各钉一条措辞）；反向锚点 = 正常收尾零 notice 行；折叠边界 = notice 不进过程折叠带。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Stream } from "../src/renderer/components/Stream";
import { projectStream } from "../src/renderer/projections";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const BUDGET_ROUND = [
  { type: "user_message", content: "写一段长文", ts: 1 },
  { type: "assistant_delta", callId: "c1", text: "写到一半……", ts: 2 },
  { type: "turn_truncated", outcome: "output_budget", stop_reason: "length", ts: 3 },
] as unknown as AgentEvent[];

const BLOCKED_ROUND = [
  { type: "user_message", content: "说说看", ts: 1 },
  { type: "assistant_delta", callId: "c1", text: "这话题……", ts: 2 },
  { type: "turn_truncated", outcome: "content_blocked", stop_reason: "content_filter", ts: 3 },
] as unknown as AgentEvent[];

const html = (events: AgentEvent[]): string =>
  renderToStaticMarkup(
    <Stream rows={projectStream(events, false)} view="normal" streaming={false} />,
  );

describe("截断提示行（turn_truncated 桌面可见）", () => {
  it("output_budget：notice 行如实可见，措辞逐字钉住", () => {
    const out = html(BUDGET_ROUND);
    expect(out).toContain("notice-row");
    expect(out).toContain("上一条回复因输出预算被截断——那不是完整结论。");
    // 截断行不是错误行：不带重试钮（续不续由用户下一轮决定，钮等于替用户做决定）。
    expect(out).not.toContain("err-retry");
  });

  it("content_blocked：同样可见，另一档措辞", () => {
    const out = html(BLOCKED_ROUND);
    expect(out).toContain("notice-row");
    expect(out).toContain("上一条回复被内容策略中止——那不是完整结论。");
  });

  it("反向锚点：正常收尾零 notice 行", () => {
    const out = html([
      { type: "user_message", content: "问", ts: 1 },
      { type: "assistant_delta", callId: "c1", text: "答", ts: 2 },
    ] as unknown as AgentEvent[]);
    expect(out).not.toContain("notice-row");
  });

  it("不进过程折叠带：后续答复落地后截断行仍在 DOM 里", () => {
    const out = html([
      { type: "user_message", content: "写", ts: 1 },
      { type: "assistant_delta", callId: "c1", text: "半句", ts: 2 },
      { type: "turn_truncated", outcome: "output_budget", stop_reason: "length", ts: 3 },
      { type: "user_message", content: "继续", ts: 4 },
      { type: "assistant_delta", callId: "c2", text: "好了", ts: 5 },
      { type: "usage", inputTokens: 1, outputTokens: 1, ts: 6 },
    ] as unknown as AgentEvent[]);
    expect(out).toContain("上一条回复因输出预算被截断——那不是完整结论。");
  });
});
