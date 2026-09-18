import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

function scrollSection() {
  const a = source.indexOf("let scrollPending = false;");
  const b = source.indexOf("/* ============ 消息滚动入场动效", a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

/** 真实滚动容器：只关心三个量，滚动的结果就是 scrollTop 被写成什么。 */
function bootStream(options: { scrollTop: number; scrollHeight?: number; clientHeight?: number }) {
  const stream = {
    scrollTop: options.scrollTop,
    scrollHeight: options.scrollHeight ?? 4000,
    clientHeight: options.clientHeight ?? 800,
  };
  const frameQueue: (() => void)[] = [];
  const context: Record<string, unknown> = {
    $: (sel: string) => (sel === ".stream" ? stream : null),
    requestAnimationFrame: (fn: () => void) => { frameQueue.push(fn); },
  };
  runInNewContext(scrollSection(), context);
  return {
    stream,
    frameCount: () => frameQueue.length,
    scrollStream: context.scrollStream as (force?: boolean) => void,
    /** 跑掉当前排队的帧（同一帧内的多次调用应已合流为一帧）。 */
    flush() { const pending = frameQueue.splice(0, frameQueue.length); pending.forEach((fn) => fn()); },
  };
}

describe("流式跟随策略（P0：用户上翻不得被拽回底部）", () => {
  it("本来就贴着底部时继续跟随，把新内容吸进视野", () => {
    // 距底 = 4000 - 3160 - 800 = 40px
    const { scrollStream, flush, stream } = bootStream({ scrollTop: 3160 });
    scrollStream();
    flush();
    expect(stream.scrollTop).toBe(4000);
  });

  it("用户已上翻（距底 400px）时保持其阅读位置，不吸底", () => {
    // 距底 = 4000 - 2800 - 800 = 400px
    const { scrollStream, flush, stream } = bootStream({ scrollTop: 2800 });
    scrollStream();
    flush();
    expect(stream.scrollTop).toBe(2800);
  });

  it("force 用于结构性重挂（打开会话 / 用户自己发言 / 拖完分隔条），无视上翻锁定", () => {
    const { scrollStream, flush, stream } = bootStream({ scrollTop: 200 });
    scrollStream(true);
    flush();
    expect(stream.scrollTop).toBe(4000);
  });

  it("同一帧内多次调用仍合帧为一次（PERF-02 语义不变）", () => {
    const { scrollStream, frameCount, flush } = bootStream({ scrollTop: 3160 });
    scrollStream();
    scrollStream();
    scrollStream();
    expect(frameCount()).toBe(1);
    flush();
    expect(frameCount()).toBe(0);
  });
});

describe("结构性重挂必须带 force", () => {
  it("历史重挂 / 用户发言 / 改宽后吸底三处走 force", () => {
    expect(source).toMatch(/function showHistory\(events\) \{[\s\S]*?scrollStream\(true\);[\s\S]*?\n  \}/);
    expect(source).toMatch(/function appendUser\(text\) \{[\s\S]*?scrollStream\(true\);/);
    expect(source).toMatch(/typeof scrollStream === 'function'\) scrollStream\(true\);/);
  });

  it("逐 token 的流式追加不得带 force（否则会持续拽回底部）", () => {
    const live = section("function ensureAi()", "const start = Date.now();");
    expect(live).toMatch(/scrollStream\(\);/);
    expect(live).not.toMatch(/scrollStream\(true\)/);
  });
});

function section(start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}
