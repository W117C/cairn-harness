// 消息操作条判卷（§2.2：copy / fork / replay / read aloud；§7.3.1：**禁延迟构建**——DOM 首绘即在，
// hover 只控 CSS 显隐，不做「首次 hover 才挂载」的 JS 惰性）。
// 分叉/回放锚（P3-1 收口）：user 行带 round（分叉到该轮）；assistant 行带 eventId（回放经事件投影轮号）；
// 朗读锚：按钮与按钮态从第一帧就有。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import { Stream } from "../src/renderer/components/Stream";
import { projectStream } from "../src/renderer/projections";

const events = [
  { type: "user_message", content: "你好", ts: 1 },
  { type: "assistant_message", content: "收到。", ts: 2 },
  { type: "user_message", content: "再来", ts: 3 },
  { type: "assistant_message", content: "好的。", ts: 4 },
] as unknown as AgentEvent[];

describe("消息操作条（§2.2 / §7.3.1 禁延迟构建）", () => {
  it("actions 在场 ⇒ 复制/分叉/回放/朗读按钮从首帧就在 DOM（不是 hover 才构建）", () => {
    const rows = projectStream(events);
    const html = renderToStaticMarkup(
      <Stream rows={rows} actions={{ onCopyText: () => undefined, onBranch: () => undefined, onReplay: () => undefined, onSpeak: () => undefined }} />,
    );
    // 第一条回复（round 1）与第二条（round 2）都带全套按钮
    expect(html.match(/aria-label="复制这行输出"/g)?.length).toBe(2);
    expect(html).toContain('aria-label="回放到第 1 轮"');
    expect(html).toContain('aria-label="回放到第 2 轮"');
    // user 行「从此处分叉」（P3-1：分叉落 user 行，轮号自数据面）
    expect(html).toContain('aria-label="从这条消息分叉新会话（到第 1 轮）"');
    expect(html).toContain('aria-label="从这条消息分叉新会话（到第 2 轮）"');
    expect(html.match(/aria-label="朗读这条输出"/g)?.length).toBe(2);
    // 赞/踩仍在（旧锚不破）
    expect(html).toContain('aria-label="赞这条输出"');
  });

  it("speakingEventId 命中 ⇒ 该条按钮变「停止朗读」（其余保持「朗读」）", () => {
    const rows = projectStream(events);
    const first = rows.find((r) => r.kind === "assistant");
    const eventId = first !== undefined && first.kind === "assistant" ? first.eventId : -1;
    const html = renderToStaticMarkup(
      <Stream rows={rows} actions={{ onSpeak: () => undefined, speakingEventId: eventId }} />,
    );
    expect(html.match(/aria-label="停止朗读"/g)?.length).toBe(1);
    expect(html.match(/aria-label="朗读这条输出"/g)?.length).toBe(1);
  });

  it("不给 onBranch/onReplay/onSpeak ⇒ 分叉/回放/朗读不渲染（旧判卷夹具口径不受扰）", () => {
    const rows = projectStream(events);
    const html = renderToStaticMarkup(<Stream rows={rows} actions={{ onCopyText: () => undefined }} />);
    expect(html).not.toContain("分叉新会话");
    expect(html).not.toContain("回放到第");
    expect(html).not.toContain("朗读这条输出");
    expect(html).toContain('aria-label="复制这行输出"');
  });

  it("assistant 行的 round 与所属用户轮一致（分叉/回放轮号的数据面）", () => {
    const rows = projectStream(events).filter((r) => r.kind === "assistant");
    expect(rows.map((r) => (r.kind === "assistant" ? r.round : -1))).toEqual([1, 2]);
  });
});

// 错误行「重试」（brief 六：「错误态：清晰原因 + 重试」）——2026-10-17 补落。
// 语义：重试 = 用最后一轮的输入再跑一轮（追加，不改写历史）；运行中不摆（此刻再排一轮语义含糊）。
describe("错误行重试", () => {
  const errEvents = [
    { type: "user_message", content: "跑一下测试", ts: 1 },
    { type: "assistant_message", content: "好。", ts: 2 },
    { type: "error", message: "连接中断：上游 502", ts: 3 },
  ] as unknown as AgentEvent[];

  it("给了 onRetryLast 且未运行 ⇒ 错误行常驻「重试」按钮（不靠 hover 才出现）", () => {
    const rows = projectStream(errEvents);
    const html = renderToStaticMarkup(<Stream rows={rows} actions={{ onRetryLast: () => undefined }} />);
    expect(html).toContain('class="row error-row"');
    expect(html).toContain('aria-label="重试上一轮"');
    expect(html).toContain("连接中断：上游 502");
  });

  it("运行中 ⇒ 不摆重试（running=true）", () => {
    const rows = projectStream(errEvents);
    const html = renderToStaticMarkup(
      <Stream rows={rows} actions={{ onRetryLast: () => undefined, running: true }} />,
    );
    expect(html).toContain('class="row error-row"');
    expect(html).not.toContain('aria-label="重试上一轮"');
  });

  it("不给 onRetryLast ⇒ 不摆重试（旧调用方与判卷夹具不受扰）", () => {
    const rows = projectStream(errEvents);
    const html = renderToStaticMarkup(<Stream rows={rows} actions={{ onCopyText: () => undefined }} />);
    expect(html).toContain('class="row error-row"');
    expect(html).not.toContain("重试上一轮");
  });
});


// 复制回执（2026-10-17）：此前复制静默，用户按了不知道成没成；Claude 形制是有一声「已复制」。
describe("复制回执", () => {
  const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
  const stringsSrc = readFileSync(fileURLToPath(new URL("../src/renderer/strings.ts", import.meta.url)), "utf8");
  it("成功路径给 toast.success，失败仍走错误条（不吞）", () => {
    const start = appSrc.indexOf("const handleCopyText");
    expect(start).toBeGreaterThan(-1);
    const block = appSrc.slice(start, start + 500);
    expect(block).toContain("toast.success(STR.toast.copied)");
    expect(block).toContain("setLastError");
  });
  it("文案键存在且非空", () => {
    expect(stringsSrc).toMatch(/copied:\s*"[^"]+"/);
  });
});

// 2026-10-17「重跑这一轮」（Claude 式重试）：用该轮输入原地再发一次（追加新轮），运行中不摆。
describe("重跑这一轮", () => {
  const rows = projectStream(events);
  it("给了 onRetryRound 且未运行 ⇒ 每条 assistant 行都有「重跑第 N 轮」", () => {
    const html = renderToStaticMarkup(<Stream rows={rows} actions={{ onRetryRound: () => undefined }} />);
    expect(html).toContain('aria-label="重跑第 1 轮"');
    expect(html).toContain('aria-label="重跑第 2 轮"');
    expect(html).toContain("再发一次");
  });
  it("运行中 ⇒ 不渲染（避免再排一轮的含糊语义）", () => {
    const html = renderToStaticMarkup(
      <Stream rows={rows} actions={{ onRetryRound: () => undefined, running: true }} />,
    );
    expect(html).not.toContain("重跑第");
  });
  it("缺 handler ⇒ 不渲染（旧调用方与判卷夹具不受扰）", () => {
    const html = renderToStaticMarkup(<Stream rows={rows} actions={{ onCopyText: () => undefined }} />);
    expect(html).not.toContain("重跑第");
  });
  it("App 接线：取该轮输入 + runningSet 兜底", () => {
    const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
    const start = appSrc.indexOf("const handleRetryRound");
    expect(start).toBeGreaterThan(-1);
    const block = appSrc.slice(start, start + 420);
    expect(block).toContain("userTextOfRound(events, round)");
    expect(block).toContain("runningSet.current.has(sid)");
    expect(appSrc).toContain("onRetryRound: handleRetryRound");
  });
});
