import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
const historySource = readFileSync(new URL("../src/renderer/history-window.js", import.meta.url), "utf8");

function section(start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

type FakeNode = {
  tag: string;
  className: string;
  textContent: string;
  children: FakeNode[];
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, string>;
  open?: boolean;
  append: (...nodes: FakeNode[]) => void;
  appendChild: (node: FakeNode) => FakeNode;
  setAttribute: (name: string, value: string) => void;
};

function fakeEl(tag: string): FakeNode {
  const node: FakeNode = {
    tag, className: "", textContent: "", children: [], attrs: {}, dataset: {}, style: {},
    append(...nodes: FakeNode[]) { node.children.push(...nodes); },
    appendChild(child: FakeNode) { node.children.push(child); return child; },
    setAttribute(name: string, value: string) { node.attrs[name] = value; },
  };
  return node;
}

/** 把 createElement 建出来的子树摊平成 {tag, text, role} 序列——断言只认渲染结果，不认实现细节。 */
function flatten(node: FakeNode, out: FakeNode[] = []): FakeNode[] {
  out.push(node);
  node.children.forEach((child) => flatten(child, out));
  return out;
}

function textOf(nodes: FakeNode[]): string {
  return nodes.map((n) => n.textContent).filter(Boolean).join("\n");
}

/**
 * 抽出运行控制段 + 重放行渲染器，并追加真实块（window.agent 在场）里那两行接线的**等价复刻**。
 * 真实块是否真的这么接，由「真实块接线」那条源码断言负责——两层合起来才完整。
 */
function boot(options: { running?: boolean } = {}) {
  const classes: string[] = [];
  const button = {
    listeners: [] as (() => void)[],
    attrs: {} as Record<string, string>,
    title: "",
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); },
    classList: {
      toggle(name: string, on: boolean) {
        const at = classes.indexOf(name);
        if (on && at < 0) classes.push(name);
        if (!on && at >= 0) classes.splice(at, 1);
      },
    },
  };
  const calls: string[] = [];
  const context: Record<string, unknown> = {
    $: (sel: string) => (sel === "#sendBtn" ? button : null),
    document: { createElement: fakeEl },
    send: () => { calls.push("send-v1"); },
    esc: (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    requestAnimationFrame: (fn: () => void) => fn(),
    real: { running: options.running === true },
    calls,
  };
  const wiring = "\nrunControl.isRunning = () => real.running === true;" +
    "\nrunControl.cancel = () => { calls.push('cancel'); };";
  const replayRow = section("  function renderHistoryRow(row)", "  /* ---------- 会话列表 ---------- */");
  runInNewContext(
    section("const runControl = {", "promptInput.addEventListener('keydown'") + replayRow + wiring,
    context,
  );
  return {
    context,
    classes,
    calls,
    button,
    setRunning(on: boolean) { (context.real as { running: boolean }).running = on; },
    click() { button.listeners.forEach((fn) => fn()); },
    renderHistoryRow: context.renderHistoryRow as (row: unknown) => FakeNode,
    errorCardHTML: context.errorCardHTML as (message: string) => string,
    syncRunButton: context.syncRunButton as () => void,
  };
}

function projectHistory(events: unknown[]): { kind: string; text: string }[] {
  const context: Record<string, unknown> = {};
  runInNewContext(historySource.replace(/^export /gm, ""), context);
  return (context.projectHistory as (e: unknown[]) => { kind: string; text: string }[])(events);
}

describe("运行控制一键两用（P0：停止键 + 按值捕获的旧 send）", () => {
  it("空闲时点击走发送，不触发取消", () => {
    const { click, calls } = boot({ running: false });
    click();
    expect(calls).toEqual(["send-v1"]);
  });

  it("运行中点击走取消，不再发送", () => {
    const { click, calls } = boot({ running: true });
    click();
    expect(calls).toEqual(["cancel"]);
  });

  it("点击必须按调用时解析 send——重赋值后点到的是新实现（此前按值捕获演示版）", () => {
    const { context, click, calls } = boot({ running: false });
    context.send = () => { calls.push("send-v2"); };
    click();
    expect(calls).toEqual(["send-v2"]);
  });

  it("按钮形状标记与可访问名跟随运行态切换", () => {
    const { classes, setRunning, syncRunButton, button } = boot({ running: true });
    syncRunButton();
    expect(classes).toContain("stop");
    expect(button.attrs["aria-label"]).toBe("停止");

    setRunning(false);
    syncRunButton();
    expect(classes).not.toContain("stop");
    expect(button.attrs["aria-label"]).toBe("发送");
  });

  it("真实块把 isRunning/cancel 接到 real.running 与 runCancel，且整轮结束后复位运行态", () => {
    expect(source).toMatch(/runControl\.isRunning = \(\) => real\.running === true;/);
    expect(source).toMatch(/runControl\.cancel = [^\n]*runCancel[^\n]*;/);
    // api.run 在整轮跑完才 resolve：成功路径必须复位，否则发送/切会话/新建被永久挡死。
    const block = section("  send = async function ()", "  selectSession = async function");
    expect(block).toMatch(/finally\s*\{[\s\S]*?real\.running = false;[\s\S]*?syncRunButton\(\);/);
  });
});

describe("失败可见性（P0）· live 渲染器", () => {
  it("错误原因逐字呈现，且经转义——不得让模型/服务端文本注入 HTML", () => {
    const { errorCardHTML } = boot();
    const html = errorCardHTML('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).not.toContain("<img");
  });

  it("恰好一个恢复动作，并带 role=alert 让读屏播报", () => {
    const { errorCardHTML } = boot();
    const html = errorCardHTML("429 insufficient quota");
    expect(html).toContain('role="alert"');
    expect(html).toContain("429 insufficient quota");
    expect(html.match(/err-hint/g)).toHaveLength(1);
  });

  it("renderEvent 有 error 分支——事件不再被静默丢弃", () => {
    expect(source).toMatch(/case ['"]error['"]:/);
  });
});

describe("失败可见性（P0）· 重放渲染器（两套渲染器，只补 live 等于没修）", () => {
  it("projectHistory 把 error 投成 error 行，而不是通用「查看记录」桩", () => {
    const rows = projectHistory([{ type: "error", message: "429 insufficient quota", step: 2 }]);
    expect(rows).toEqual([{ kind: "error", text: "429 insufficient quota" }]);
  });

  it("重开行把原因与恢复动作渲染出来，且走 textContent 不经 innerHTML", () => {
    const { renderHistoryRow } = boot();
    const node = renderHistoryRow({ kind: "error", text: "connect ETIMEDOUT api.example.com" });
    const flat = flatten(node);
    expect(textOf(flat)).toContain("运行失败");
    expect(textOf(flat)).toContain("connect ETIMEDOUT api.example.com");
    expect(textOf(flat)).toContain("重新发送一次即可重试");
    expect(node.dataset.history).toBe("");
    // 桩的特征是 <details>/<summary>——错误行不得走那条路。
    expect(flat.some((n) => n.tag === "details")).toBe(false);
  });

  it("live 与重放共用同一句恢复动作（不产生第二事实源）", () => {
    const { errorCardHTML, renderHistoryRow } = boot();
    const hint = errorCardHTML("x").match(/err-hint">([^<]+)</)?.[1];
    expect(hint).toBeTruthy();
    expect(textOf(flatten(renderHistoryRow({ kind: "error", text: "x" })))).toContain(String(hint));
  });
});
