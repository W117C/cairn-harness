// P3-2 时间线判卷（计划稿 Task P3-2）：判卷先红——本文件先于实现落盘。
//   ① timelineItems 纯函数：user / assistant（首 delta 落步，后续 delta 并入）/ tool / usage 四类步；
//     worker 子流滤、error 不成步；「只取在场字段，不编时间」（at 缺席就不给）。
//   ② TimelinePane SSR：空态引导文案；行 = kind 词 + label + 跳转钮；有 at 显相对时间。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { timelineItems } from "../src/renderer/projections";
import { TimelinePane } from "../src/renderer/components/TimelinePane";

const events = [
  { type: "user_message", content: "帮我改一下", ts: 1000 },
  { type: "assistant_delta", callId: "c1", text: "好的，我先看看", ts: 1100 },
  { type: "assistant_delta", callId: "c1", text: "这份文件。", ts: 1150 },
  { type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" }, ts: 1300 },
  { type: "tool_result", callId: "t1", ok: true, ts: 1500 },
  { type: "usage", inputTokens: 1234, outputTokens: 340, ts: 1600 },
  { type: "assistant_message", content: "改完了。", ts: 1700 },
  { type: "error", message: "炸", ts: 1800 },
] as unknown as AgentEvent[];

describe("① timelineItems（事件日志步骤时间线投影）", () => {
  it("四类步齐全：user / assistant（首 delta 落步，后续 delta 不重复）/ tool / usage；error 不成步", () => {
    const items = timelineItems(events);
    expect(items.map((it) => [it.eventId, it.kind])).toEqual([
      [1, "user"],
      [2, "assistant"],
      [4, "tool"],
      [6, "usage"],
      [7, "assistant"],
    ]);
    expect(items[0]?.label).toBe("帮我改一下");
    expect(items[1]?.label).toBe("好的，我先看看");
    expect(items[2]?.label).toBe("read_file a.ts");
    expect(items[3]?.label).toBe("输入 1.2k · 输出 340");
    expect(items[4]?.label).toBe("改完了。");
  });

  it("at 只取在场 ts（编不出来的不给）", () => {
    const items = timelineItems(events);
    expect(items[0]?.at).toBe(1000);
    const noTs = [{ type: "user_message", content: "无戳" }] as unknown as AgentEvent[];
    expect(timelineItems(noTs)[0]?.at).toBeUndefined();
  });

  it("worker 子流不进时间线；eventId 仍是事件全序的 1-based 行号", () => {
    const withWorker = [
      { type: "user_message", content: "A", ts: 1 },
      { type: "assistant_delta", callId: "w", text: "worker 悄悄话", agent_id: "w1", ts: 2 },
      { type: "assistant_delta", callId: "c2", text: "主会话话", ts: 3 },
    ] as unknown as AgentEvent[];
    const items = timelineItems(withWorker);
    expect(items.map((it) => [it.eventId, it.kind])).toEqual([[1, "user"], [3, "assistant"]]);
    expect(items[1]?.label).toBe("主会话话");
  });

  it("空流 → 空表（不摆占位步）", () => {
    expect(timelineItems([])).toEqual([]);
  });
});

describe("② TimelinePane SSR", () => {
  it("空态：引导文案在场（不放占位假数据）", () => {
    const html = renderToStaticMarkup(<TimelinePane items={[]} />);
    expect(html).toContain("还没有");
  });

  it("有数据：kind 词 + label + 跳转钮 + 相对时间位（at 在场的行）", () => {
    const up = timelineItems(events);
    const html = renderToStaticMarkup(<TimelinePane items={up} onJump={() => undefined} />);
    expect(html).toContain('tl-kind user">你');
    expect(html).toContain('tl-kind assistant">回复');
    expect(html).toContain('tl-kind tool">工具');
    expect(html).toContain('tl-kind usage">用量');
    expect(html).toContain("read_file a.ts");
    expect(html).toContain("跳到对话中的对应位置");
    expect(html.match(/class="tl-at"/g)?.length).toBe(5);
  });
});
