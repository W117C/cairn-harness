// 上下文容量分解（2026-11-04 业主截图形制）判卷：纯函数面 + UsageMeter 面板形状。
//
// 钉四件事：
//   ① 桶合计恒 = 总桶（残差归消息）——截图里 71.7+14.7+11.4+1.2+0.7+0.3 = 100.0 的那种读法；
//   ② 无 surface_account（没跑过/老会话）⇒ 消息吃满，不给假分解；
//   ③ 面板形状：标题行（容量 + used/window）→ 分段条 → 图例 → 缓存命中率 → 会话累计 → 压缩入口；
//   ④ 桶名文案出自 strings.ts（ctxBucket*），模块不带第二份文案。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { contextBreakdown, transcriptCharsOf } from "../src/renderer/context-breakdown";
import { UsageMeter, contextBudget } from "../src/renderer/components/UsageMeter";
import { STR } from "../src/renderer/strings";

const noop = (): void => undefined;
const SURFACE = {
  type: "surface_account" as const, attemptSeq: 1,
  declaredToolCount: 2, declaredToolSpecChars: 800, sentToolCount: 2, sentToolSpecChars: 800,
  baseSystemChars: 680, volatileChars: 1280, memoryChars: 200, skillsBlockChars: 400,
  mapChars: 60, attachmentContextChars: 0, limitChars: 48000, overChars: 0,
  shortened: [], dropped: [], unresolvable: false, prefixStableChars: 0, faceChanged: false,
};
const EVENTS = [
  { type: "user_message", content: "x".repeat(4000) },
  { type: "assistant_delta", text: "yy" },
  { type: "tool_result", callId: "t1", ok: true, output: "zz" },
  SURFACE,
  { type: "usage", inputTokens: 800, outputTokens: 100, lastInputTokens: 1000 },
] as unknown as AgentEvent[];
// transcript = 4004；all = 4004 + 800 + 400 + 200 + 680 + 60 = 6144；K = 1000/6144。
// tools=130.2→130、skills=65.1→65、memory=32.55→33、system=110.67→111、other=9.77→10、
// messages=1000−130−65−33−111−10=651（残差归消息）。六桶全非零 ⇒ 分段条/图例全在场。

describe("contextBreakdown（纯函数）", () => {
  it("六桶齐全、合计恒 = 总桶；固定桶按字符占比、残差归消息", () => {
    const b = contextBreakdown(EVENTS, 1000)!;
    expect(b).not.toBeNull();
    expect(b.shares.map((s) => s.key)).toEqual(["messages", "tools", "skills", "memory", "system", "other"]);
    const sum = b.shares.reduce((n, s) => n + s.tokens, 0);
    expect(sum).toBe(1000);
    expect(b.shares[0]!.tokens).toBe(651);
    expect(b.shares[1]!.tokens).toBe(130);
    expect(b.shares[2]!.tokens).toBe(65);
    expect(b.shares[3]!.tokens).toBe(33);
    expect(b.shares[4]!.tokens).toBe(111);
    expect(b.shares[5]!.tokens).toBe(10);
  });

  it("无 surface_account ⇒ 消息吃满（不给假分解）；零输入 ⇒ null", () => {
    const noSurface = contextBreakdown([{ type: "user_message", content: "hi" }] as unknown as AgentEvent[], 500)!;
    expect(noSurface.shares).toEqual([{ key: "messages", tokens: 500, pct: 100 }]);
    expect(contextBreakdown(EVENTS, 0)).toBeNull();
  });

  it("transcriptCharsOf：user + assistant_delta + tool_result；不含 thinking/usage", () => {
    expect(transcriptCharsOf(EVENTS)).toBe(4004);
  });

  it("落盘事件缺字段（tool_result 无 output 等）⇒ 不计、不抛（曾把整个会话面炸进错误边界）", () => {
    const sparse = [
      { type: "user_message", content: "abc" },
      { type: "tool_result", callId: "t1", ok: true },
      { type: "assistant_delta" },
      SURFACE,
    ] as unknown as AgentEvent[];
    expect(transcriptCharsOf(sparse)).toBe(3);
    expect(() => contextBreakdown(sparse, 1000)).not.toThrow();
  });
});

describe("UsageMeter 面板形状（截图形制）", () => {
  const usage = { inputTokens: 500, outputTokens: 100, usageCount: 2, cacheReadTokens: 400, lastInputTokens: 1000 };

  it("浮层关闭时，用量环显示占比且不读取会话事件", () => {
    let eventReads = 0;
    const events = new Proxy(EVENTS, {
      get(target, key, receiver) {
        eventReads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const h = renderToStaticMarkup(
      <UsageMeter usage={usage} steps={3} ctxWindow={8000} events={events} open={false} onOpenChange={noop} onCompact={noop} />,
    );
    expect(h).toContain(STR.composer.ringAriaPct.replace("{pct}", "13"));
    expect(eventReads).toBe(0);
    expect(h).not.toContain("ctx-bar");
  });

  it("标题行 + 分段条 + 图例 + 缓存命中率 + 会话累计 + 压缩入口，全在场", () => {
    const h = renderToStaticMarkup(
      <UsageMeter usage={usage} steps={3} ctxWindow={8000} events={EVENTS} open onOpenChange={noop} onCompact={noop} />,
    );
    expect(h).toContain(STR.composer.ctxCapacityTitle);
    expect(h).toContain("ctx-bar");
    for (const key of ["messages", "tools", "skills", "memory", "system", "other"]) {
      expect(h).toContain(`ctx-seg-${key}`);
    }
    expect(h).toContain(STR.composer.ctxCacheHitRate);
    expect(h).toContain(STR.composer.meterTitle);
    expect(h).toContain(STR.composer.meterCompact);
    // 缓存命中率：cacheRead 400 / (400+500) ≈ 44%
    expect(h).toContain("44%");
    // 让布局说话（2026-11-04）：估算口径与「—」口径进 tooltip，不再常驻成两行小字。
    expect(h).not.toContain('class="menu-note"');
    expect(h).toContain(`title="${STR.composer.ctxEstimateNote}"`);
    expect(h).toContain(`title="${STR.composer.meterNote}"`);
  });

  it("零数据会话：无分段条无图例（不摆假仪表），容量行给「暂无数据」", () => {
    const h = renderToStaticMarkup(
      <UsageMeter usage={{ inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 }} steps={0} ctxWindow={8000} events={[]} open onOpenChange={noop} onCompact={noop} />,
    );
    expect(h).not.toContain("ctx-bar");
    expect(h).not.toContain("ctx-legend");
    expect(h).toContain(STR.composer.meterCtxNoData);
  });

  it("contextBudget 口径不变（回归钉）：窗口/已用/低水位", () => {
    expect(contextBudget(1000, 950)).toMatchObject({ pct: 95, low: true });
    expect(contextBudget(1000, 100)).toMatchObject({ pct: 10, low: false });
  });
});
